/**
 * Cashier billing writes — the money path. All amounts are integer paise.
 *
 * Every total is derived from the ORDER's line items via `computeBill`; the
 * client never trusts a total it was handed. Firestore rules independently
 * re-validate ranges, GST consistency, immutability of paid bills, and that
 * only cashier/admin can settle.
 */
import {
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { paths } from "@/lib/firestore/paths";
import { computeBill, type BillLine } from "@/lib/money";
import { dayKey } from "@/lib/date";
import type {
  Bill,
  DailySummary,
  Order,
  PaymentMode,
} from "@/types/models";

/** Non-voided order lines as bill inputs. */
function linesOf(order: Order): BillLine[] {
  return order.items
    .filter((i) => !i.voided)
    .map((i) => ({ price: i.price, qty: i.qty, voided: false }));
}

/**
 * Billing guard. Dine-in is "food first, pay after": refuse to bill unless
 * every line was sent to the kitchen and every KOT ticket for the order is
 * `completed`. Takeaway/delivery is pay-first at the counter, so the ticket
 * only has to EXIST (kitchen has the order) — it may still be preparing.
 * The cashier UI already hides unbillable orders; this guard catches anything
 * that slips past it (stale snapshot, other call sites).
 */
async function assertKitchenDone(order: Order): Promise<void> {
  const unsent = order.items.some(
    (i) => !i.voided && i.qty > 0 && i.kotStatus === "pending"
  );
  if (unsent) {
    throw new Error(
      "Some items haven't been sent to the kitchen yet. Send the KOT first."
    );
  }
  const kotsSnap = await getDocs(
    query(paths.kots(), where("orderId", "==", order.id))
  );
  if (kotsSnap.empty) {
    throw new Error(
      "Nothing has been sent to the kitchen for this order yet."
    );
  }
  if (order.orderType !== "dine-in") return; // pay-first: bill while preparing
  const unfinished = kotsSnap.docs.some((d) => d.data().status !== "completed");
  if (unfinished) {
    throw new Error(
      "The kitchen is still preparing this order. Bill it once all tickets are completed."
    );
  }
}

/** counters/billNumber starts here, so the first printed bill is 000101. */
const BILL_NUMBER_SEED = 100;

/**
 * Create a finalized bill for an open order (cashier-initiated), or return the
 * existing bill id if the order already has one. Marks the order `billed` and
 * the table `billed` so the floor view reflects it live.
 *
 * Runs as a single transaction that also mints the sequential human-facing
 * bill number from `counters/billNumber` (same pattern as sendKot's ticket
 * counter). The order is re-read inside the transaction so a concurrent
 * generate can't create two bills — or burn two numbers — for one order.
 *
 * Only runs for kitchen-done orders — see `assertKitchenDone`.
 */
export async function generateBill(
  order: Order,
  cashierUid: string,
  tableLabel: string,
  gstEnabled = true
): Promise<string> {
  if (order.billId) return order.billId;

  await assertKitchenDone(order);

  const billRef = doc(paths.bills());
  const counterRef = paths.counter("billNumber");

  return runTransaction(db, async (tx) => {
    // ---- reads first (transaction requirement) ----
    const orderSnap = await tx.get(paths.order(order.id));
    if (!orderSnap.exists()) throw new Error(`Order ${order.id} not found`);
    const fresh = orderSnap.data();
    if (fresh.billId) return fresh.billId;

    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists()
      ? counterSnap.data().value
      : BILL_NUMBER_SEED;
    const billNumber = current + 1;

    const totals = computeBill(linesOf(fresh), 0, gstEnabled);

    // ---- writes ----
    tx.set(counterRef, { value: billNumber });
    tx.set(billRef, {
      billNumber,
      orderId: order.id,
      tableId: fresh.tableId,
      tableLabel,
      ...totals,
      status: "finalized",
      paymentMode: null,
      requestedBy: fresh.waiterId,
      cashierId: cashierUid,
      printedCount: 0,
      createdAt: serverTimestamp(),
      paidAt: null,
    } as unknown as Bill);
    tx.update(paths.order(order.id), {
      billId: billRef.id,
      status: "billed",
      updatedAt: serverTimestamp(),
    });
    if (fresh.tableId) {
      tx.update(paths.table(fresh.tableId), {
        status: "billed",
        updatedAt: serverTimestamp(),
      });
    }
    return billRef.id;
  });
}

/**
 * Settle a bill: mark paid, close the order, free the table, and roll the sale
 * into today's summary — atomically. After this the bill is immutable (rules).
 */
export async function settleBill(
  bill: Bill,
  order: Order,
  paymentMode: PaymentMode
): Promise<void> {
  const summaryRef = paths.dailySummary(dayKey());

  await runTransaction(db, async (tx) => {
    // ---- reads first (transaction requirement) ----
    const summarySnap = await tx.get(summaryRef);
    const prev = summarySnap.exists()
      ? (summarySnap.data() as DailySummary)
      : null;

    // ---- derive updated summary from the order lines ----
    const emptyModes = { cash: 0, upi: 0, card: 0 };
    const emptySources = { "dine-in": 0, takeaway: 0, delivery: 0 };
    const byPaymentMode = { ...emptyModes, ...(prev?.byPaymentMode ?? {}) };
    const bySource = { ...emptySources, ...(prev?.bySource ?? {}) };
    const itemSales: DailySummary["itemSales"] = { ...(prev?.itemSales ?? {}) };

    byPaymentMode[paymentMode] += bill.grandTotal;
    bySource[order.orderType] += bill.grandTotal;

    let voidedItemCount = prev?.voidedItemCount ?? 0;
    for (const line of order.items) {
      if (line.voided) {
        voidedItemCount += 1;
        continue;
      }
      const entry = itemSales[line.menuItemId] ?? {
        name: line.name,
        qty: 0,
        revenue: 0,
      };
      entry.qty += line.qty;
      entry.revenue += line.price * line.qty;
      itemSales[line.menuItemId] = entry;
    }

    const nextSummary: DailySummary = {
      id: dayKey(),
      date: dayKey(),
      totalRevenue: (prev?.totalRevenue ?? 0) + bill.grandTotal,
      orderCount: (prev?.orderCount ?? 0) + 1,
      voidedItemCount,
      byPaymentMode,
      bySource,
      itemSales,
      updatedAt: serverTimestamp() as unknown as DailySummary["updatedAt"],
    };

    // ---- writes ----
    tx.set(summaryRef, nextSummary);
    tx.update(paths.bill(bill.id), {
      status: "paid",
      paymentMode,
      paidAt: serverTimestamp(),
    });
    tx.update(paths.order(order.id), {
      status: "closed",
      updatedAt: serverTimestamp(),
    });
    if (order.tableId) {
      tx.update(paths.table(order.tableId), {
        status: "available",
        currentOrderId: null,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** Reprint: the only mutation allowed on a paid bill (rules permit it). */
export async function reprintBill(billId: string, current: number): Promise<void> {
  await updateDoc(paths.bill(billId), { printedCount: current + 1 });
}
