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
  NcReason,
  Order,
  PaymentMode,
  VoidReason,
} from "@/types/models";

/**
 * Non-voided order lines as bill inputs.
 *
 * The offer discount is carried through from the line, not recomputed here.
 * It was stamped when the waiter added the item and is a SNAPSHOT in exactly
 * the way `price` is: what matters is the deal the guest was quoted at the
 * table, not whether the promo is still running by the time they ask for the
 * bill. A party that ordered inside happy hour keeps happy-hour pricing.
 */
function linesOf(order: Order): BillLine[] {
  return order.items
    .filter((i) => !i.voided)
    .map((i) => ({
      price: i.price,
      qty: i.qty,
      voided: false,
      offerDiscount: i.offerDiscount ?? 0,
    }));
}

/** What each offer contributed to an order, for the day's `byOffer` report. */
function offerTallyOf(order: Order): Map<string, { name: string; amount: number }> {
  const tally = new Map<string, { name: string; amount: number }>();
  for (const line of order.items) {
    if (line.voided) continue;
    const amount = line.offerDiscount ?? 0;
    if (!line.offerId || amount <= 0) continue;
    const entry = tally.get(line.offerId) ?? {
      name: line.offerName ?? "Offer",
      amount: 0,
    };
    entry.amount += amount;
    tally.set(line.offerId, entry);
  }
  return tally;
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
 * How a bill was closed out: money was collected, or the meal was comped.
 *
 * NON-CHARGEABLE is a settlement, not a payment mode — it deliberately does
 * NOT live inside `PaymentMode`, because everything that consumes a payment
 * mode (the payment split, the receipt's "Payment :" line, the day's takings)
 * is asking about money that changed hands, and for a comp none did.
 */
export type Settlement =
  | { kind: "paid"; mode: PaymentMode }
  | { kind: "nc"; reason: NcReason; note?: string };

/** Empty-day bases, spread under the previous summary so a doc written before
 *  a bucket existed still lands on a complete record. */
const EMPTY_MODES = { cash: 0, upi: 0, card: 0 };
const EMPTY_SOURCES = { "dine-in": 0, takeaway: 0, delivery: 0 };
const EMPTY_NC_REASONS = { owner: 0, staff: 0, complaint: 0, pr: 0, other: 0 };

/**
 * Settle a bill: mark it paid, close the order, free the table, and roll the
 * result into today's summary — atomically. After this the bill is immutable
 * (rules), so this is the ONLY moment a bill can be marked non-chargeable.
 *
 * A NON-CHARGEABLE settlement takes the same path — same transaction, same
 * order/table close-out — and differs in exactly one respect: the money never
 * enters the sales figures. It is kept out of `totalRevenue`, `orderCount`,
 * `byPaymentMode`, `bySource` and `itemSales`, and tallied under `ncCount` /
 * `ncAmount` / `byNcReason` instead. Keeping it out of `orderCount` matters as
 * much as keeping it out of revenue: counted there, every comp would silently
 * drag down the average order value.
 *
 * The bill doc keeps its REAL totals either way. What the comp was worth is
 * the whole point of recording it.
 */
export async function settleBill(
  bill: Bill,
  order: Order,
  settlement: Settlement
): Promise<void> {
  const summaryRef = paths.dailySummary(dayKey());
  const isNc = settlement.kind === "nc";

  await runTransaction(db, async (tx) => {
    // ---- reads first (transaction requirement) ----
    const summarySnap = await tx.get(summaryRef);
    const prev = summarySnap.exists()
      ? (summarySnap.data() as DailySummary)
      : null;

    // ---- derive updated summary from the order lines ----
    const byPaymentMode = { ...EMPTY_MODES, ...(prev?.byPaymentMode ?? {}) };
    const bySource = { ...EMPTY_SOURCES, ...(prev?.bySource ?? {}) };
    const byNcReason = { ...EMPTY_NC_REASONS, ...(prev?.byNcReason ?? {}) };
    const itemSales: DailySummary["itemSales"] = { ...(prev?.itemSales ?? {}) };
    const byOffer: DailySummary["byOffer"] = { ...(prev?.byOffer ?? {}) };

    if (settlement.kind === "nc") {
      byNcReason[settlement.reason] += bill.grandTotal;
    } else {
      byPaymentMode[settlement.mode] += bill.grandTotal;
      bySource[order.orderType] += bill.grandTotal;
    }

    // A comped bill collected nothing, so its offers cost the restaurant
    // nothing on top of the comp — the whole meal is already tallied under
    // ncAmount. Counting the discount again would double-charge the giveaway.
    const billOfferDiscount = isNc ? 0 : (bill.offerDiscount ?? 0);
    if (!isNc) {
      for (const [offerId, { name, amount }] of offerTallyOf(order)) {
        const entry = byOffer[offerId] ?? { name, count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += amount;
        // Refresh the label: a renamed offer should read under its current
        // name, and the snapshot on the line is the most recent one seen.
        entry.name = name;
        byOffer[offerId] = entry;
      }
    }

    let voidedItemCount = prev?.voidedItemCount ?? 0;
    for (const line of order.items) {
      if (line.voided) {
        // A void is a void whoever settles the bill — always counted.
        voidedItemCount += 1;
        continue;
      }
      // Comped food never enters Top Items: "best selling" has to mean sold.
      if (isNc) continue;
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
      totalRevenue: (prev?.totalRevenue ?? 0) + (isNc ? 0 : bill.grandTotal),
      orderCount: (prev?.orderCount ?? 0) + (isNc ? 0 : 1),
      voidedItemCount,
      byPaymentMode,
      bySource,
      itemSales,
      ncCount: (prev?.ncCount ?? 0) + (isNc ? 1 : 0),
      ncAmount: (prev?.ncAmount ?? 0) + (isNc ? bill.grandTotal : 0),
      byNcReason,
      // Carried forward untouched — settling never cancels anything.
      voidedBillCount: prev?.voidedBillCount ?? 0,
      voidedRevenue: prev?.voidedRevenue ?? 0,
      // `totalRevenue` is already net of offers, so this is the cost of having
      // earned it — the figure that answers "is the promo worth running?".
      offerDiscount: (prev?.offerDiscount ?? 0) + billOfferDiscount,
      byOffer,
      updatedAt: serverTimestamp() as unknown as DailySummary["updatedAt"],
    };

    // ---- writes ----
    tx.set(summaryRef, nextSummary);
    // Totals are deliberately NOT in this update: the rules pin them to their
    // stored values on an NC write, and re-sending them is how that breaks.
    tx.update(
      paths.bill(bill.id),
      settlement.kind === "nc"
        ? {
            status: "paid",
            paymentMode: null,
            nonChargeable: true,
            ncReason: settlement.reason,
            ...(settlement.note ? { ncNote: settlement.note } : {}),
            paidAt: serverTimestamp(),
          }
        : {
            status: "paid",
            paymentMode: settlement.mode,
            paidAt: serverTimestamp(),
          }
    );
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

/** Reprint: allowed on a paid bill, and on a cancelled one (rules permit it). */
export async function reprintBill(billId: string, current: number): Promise<void> {
  await updateDoc(paths.bill(billId), { printedCount: current + 1 });
}

/**
 * CANCEL (void) a settled bill — the restaurant served badly, is refunding the
 * customer, and the sale must come back out of the day's figures.
 *
 * This is the exact inverse of `settleBill`, and it has to stay that way: it
 * reverses whichever path the settle took. A CHARGED bill comes out of
 * `totalRevenue`, `orderCount`, `byPaymentMode`, `bySource` and `itemSales`; a
 * COMPED one was never in any of those, so only `ncCount`/`ncAmount`/
 * `byNcReason` unwind. Getting that backwards would leave the day's revenue
 * short by a bill that never contributed to it.
 *
 * Both then land in `voidedBillCount`/`voidedRevenue`, so the reversal is
 * visible rather than a silent hole in the day.
 *
 * ONLY a bill paid on the current IST business day can be cancelled — enforced
 * here AND in the rules. A day the owner has already read never moves.
 *
 * The refund itself happens outside the app: this records that it is owed and
 * un-books the sale. The table is deliberately untouched — settling freed it,
 * and by now it may be seating the next party.
 */
export async function voidBill(
  bill: Bill,
  actorUid: string,
  reason: VoidReason,
  note?: string
): Promise<void> {
  const trimmedNote = note?.trim().slice(0, 140);

  await runTransaction(db, async (tx) => {
    // ---- reads first (transaction requirement) ----
    // Re-read rather than trust the snapshot the sheet is holding: a double
    // tap, or a stale listener, must not decrement the day's summary twice.
    const billSnap = await tx.get(paths.bill(bill.id));
    if (!billSnap.exists()) throw new Error(`Bill ${bill.id} not found`);
    const fresh = billSnap.data();

    if (fresh.status === "void") {
      throw new Error("This bill has already been cancelled.");
    }
    if (fresh.status !== "paid") {
      throw new Error("Only a settled bill can be cancelled.");
    }
    if (!fresh.paidAt) {
      throw new Error("This bill has no payment time and cannot be cancelled.");
    }

    // The day the bill was PAID — not today. A bill settled at 11:50pm and
    // cancelled at 12:10am must come out of the day it went into.
    const paidDay = dayKey(fresh.paidAt.toDate());
    if (paidDay !== dayKey()) {
      throw new Error(
        "Only today's bills can be cancelled. This one was settled on an earlier day."
      );
    }

    const orderSnap = await tx.get(paths.order(fresh.orderId));
    if (!orderSnap.exists()) throw new Error(`Order ${fresh.orderId} not found`);
    const order = orderSnap.data();

    const summaryRef = paths.dailySummary(paidDay);
    const summarySnap = await tx.get(summaryRef);
    const prev = summarySnap.exists()
      ? (summarySnap.data() as DailySummary)
      : null;

    // ---- derive the reversed summary ----
    const wasNc = fresh.nonChargeable === true;
    const byPaymentMode = { ...EMPTY_MODES, ...(prev?.byPaymentMode ?? {}) };
    const bySource = { ...EMPTY_SOURCES, ...(prev?.bySource ?? {}) };
    const byNcReason = { ...EMPTY_NC_REASONS, ...(prev?.byNcReason ?? {}) };
    const itemSales: DailySummary["itemSales"] = { ...(prev?.itemSales ?? {}) };
    const byOffer: DailySummary["byOffer"] = { ...(prev?.byOffer ?? {}) };

    // Every subtraction is clamped at zero. A bill settled before its summary
    // bucket existed contributed nothing to reverse, and a negative total on
    // the owner's report would be worse than an under-count.
    const sub = (a: number, b: number) => Math.max(0, a - b);

    if (wasNc) {
      if (fresh.ncReason) {
        byNcReason[fresh.ncReason] = sub(
          byNcReason[fresh.ncReason],
          fresh.grandTotal
        );
      }
    } else {
      if (fresh.paymentMode) {
        byPaymentMode[fresh.paymentMode] = sub(
          byPaymentMode[fresh.paymentMode],
          fresh.grandTotal
        );
      }
      bySource[order.orderType] = sub(
        bySource[order.orderType],
        fresh.grandTotal
      );
      // Top Items must lose the sale too, or a cancelled dish keeps its place
      // in the best-sellers. Comped lines were never added, so skip them.
      for (const line of order.items) {
        if (line.voided) continue;
        const entry = itemSales[line.menuItemId];
        if (!entry) continue;
        const qty = entry.qty - line.qty;
        const revenue = entry.revenue - line.price * line.qty;
        if (qty <= 0) delete itemSales[line.menuItemId];
        else itemSales[line.menuItemId] = { ...entry, qty, revenue };
      }
      // Offers unwind with the sale that carried them. Leaving them behind
      // would show a promo that cost money on a day where the matching revenue
      // no longer exists — the exact asymmetry this function exists to avoid.
      // Comped bills never entered byOffer (settleBill skips them), so there
      // is nothing to reverse on that branch.
      for (const [offerId, { amount }] of offerTallyOf(order)) {
        const entry = byOffer[offerId];
        if (!entry) continue;
        const count = entry.count - 1;
        const nextAmount = sub(entry.amount, amount);
        if (count <= 0) delete byOffer[offerId];
        else byOffer[offerId] = { ...entry, count, amount: nextAmount };
      }
    }

    const nextSummary: DailySummary = {
      id: paidDay,
      date: paidDay,
      totalRevenue: wasNc
        ? (prev?.totalRevenue ?? 0)
        : sub(prev?.totalRevenue ?? 0, fresh.grandTotal),
      orderCount: wasNc ? (prev?.orderCount ?? 0) : sub(prev?.orderCount ?? 0, 1),
      // Left alone: those lines really were voided in the kitchen during
      // service, and cancelling the bill afterwards doesn't un-void them.
      voidedItemCount: prev?.voidedItemCount ?? 0,
      byPaymentMode,
      bySource,
      itemSales,
      ncCount: wasNc ? sub(prev?.ncCount ?? 0, 1) : (prev?.ncCount ?? 0),
      ncAmount: wasNc
        ? sub(prev?.ncAmount ?? 0, fresh.grandTotal)
        : (prev?.ncAmount ?? 0),
      byNcReason,
      voidedBillCount: (prev?.voidedBillCount ?? 0) + 1,
      voidedRevenue: (prev?.voidedRevenue ?? 0) + fresh.grandTotal,
      offerDiscount: wasNc
        ? (prev?.offerDiscount ?? 0)
        : sub(prev?.offerDiscount ?? 0, fresh.offerDiscount ?? 0),
      byOffer,
      updatedAt: serverTimestamp() as unknown as DailySummary["updatedAt"],
    };

    // ---- writes ----
    tx.set(summaryRef, nextSummary);
    // Totals are deliberately NOT in this update — the rules pin the bill to
    // the values it already holds, and re-sending them is how that breaks.
    tx.update(paths.bill(bill.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: actorUid,
      voidReason: reason,
      ...(trimmedNote ? { voidNote: trimmedNote } : {}),
    });
    tx.update(paths.order(fresh.orderId), {
      status: "cancelled",
      updatedAt: serverTimestamp(),
    });
  });
}
