/**
 * End-to-end test of the "food first, pay after" billing flow against the
 * live dev Firebase project, driving the REAL app modules:
 *
 *   waiter: createOrderLocal / writeOrderItems → sendKot (orderApi)
 *   kitchen: startKot → markReady → completeKot (kdsApi)
 *   cashier: billable derivation (isKitchenDone) + generateBill/settleBill
 *
 * Asserts at every stage that the cashier CANNOT bill until every KOT ticket
 * is completed, including the "added items later" round-trip.
 *
 * Run: npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/e2e.ts
 */
import { signInWithEmailAndPassword } from "firebase/auth";
import { getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, RESTAURANT_ID } from "./firebase-shim";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";

// Node has no __DEV__ fallback — pin the tenant this suite runs against.
setActiveRestaurantId(RESTAURANT_ID);
import {
  createOrderLocal,
  mergeItemIntoLines,
  sendKot,
  writeOrderItems,
} from "@/features/order/orderApi";
import { completeKot, markReady, startKot } from "@/features/kitchen/kdsApi";
import { generateBill, settleBill } from "@/features/cashier/cashierApi";
import {
  ACTIVE_KOT_STATUSES,
  isKitchenDone,
} from "@/features/cashier/useCashierData";
import type { Bill, Order } from "@/types/models";

const PASSWORD = "Sada@1234";
const TABLE_ID = "t10";
const TABLE_LABEL = "Patio 2";

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✔ [${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function signIn(role: "waiter" | "kitchen" | "cashier"): Promise<string> {
  const cred = await signInWithEmailAndPassword(
    auth,
    `${role}@sada-pos.test`,
    PASSWORD
  );
  return cred.user.uid;
}

async function fetchOrder(orderId: string): Promise<Order> {
  const snap = await getDoc(paths.order(orderId));
  assert(snap.exists(), `order ${orderId} exists`);
  return { ...snap.data(), id: snap.id } as Order;
}

/** Mirrors useBillableOrders' derivation with one-shot reads. */
async function billableSplit(): Promise<{ ready: string[]; preparing: string[] }> {
  const [ordersSnap, kotsSnap] = await Promise.all([
    getDocs(query(paths.orders(), where("status", "==", "open"))),
    getDocs(
      query(paths.kots(), where("status", "in", [...ACTIVE_KOT_STATUSES]))
    ),
  ]);
  const open = ordersSnap.docs
    .map((d) => ({ ...d.data(), id: d.id } as Order))
    .filter((o) => !o.billId && o.items.some((i) => !i.voided));
  const active = new Set(kotsSnap.docs.map((d) => d.data().orderId));
  return {
    ready: open.filter((o) => isKitchenDone(o, active)).map((o) => o.id),
    preparing: open.filter((o) => !isKitchenDone(o, active)).map((o) => o.id),
  };
}

async function expectBillRejected(orderId: string, cashierUid: string) {
  const order = await fetchOrder(orderId);
  try {
    await generateBill(order, cashierUid, TABLE_LABEL);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("generateBill unexpectedly SUCCEEDED before kitchen done");
}

async function main() {
  // ── Round 1: waiter opens an order ───────────────────────────────────────
  const waiterUid = await signIn("waiter");
  const tableSnap = await getDoc(paths.table(TABLE_ID));
  assert(tableSnap.exists(), `table ${TABLE_ID} exists`);
  assert(
    !tableSnap.data()!.currentOrderId,
    `table ${TABLE_ID} is free (run again after clearing it if not)`
  );

  const created = createOrderLocal({
    tableId: TABLE_ID,
    orderType: "dine-in",
    waiterId: waiterUid,
    menuItemId: "masala-chai",
    name: "Masala Chai",
    price: 4000,
  });
  await created.commit;
  const orderId = created.orderId;
  ok(`waiter opened order ${orderId} on ${TABLE_LABEL}`);

  // ── Cashier before anything is sent: NOT billable ────────────────────────
  const cashierUid = await signIn("cashier");
  let split = await billableSplit();
  assert(!split.ready.includes(orderId), "order not billable before send");
  assert(split.preparing.includes(orderId), "order listed under Preparing…");
  let msg = await expectBillRejected(orderId, cashierUid);
  ok(`generateBill rejected before KOT sent: "${msg}"`);

  // ── Waiter sends the KOT ─────────────────────────────────────────────────
  await signIn("waiter");
  const kot1 = await sendKot(orderId, TABLE_LABEL);
  assert(kot1, "sendKot returned a kot id");
  ok(`KOT #1 sent (${kot1})`);

  // ── Cashier while cooking: NOT billable ──────────────────────────────────
  await signIn("cashier");
  split = await billableSplit();
  assert(!split.ready.includes(orderId), "order not billable while KOT new");
  assert(split.preparing.includes(orderId), "order under Preparing… while cooking");
  msg = await expectBillRejected(orderId, cashierUid);
  ok(`generateBill rejected while cooking: "${msg}"`);

  // ── Kitchen works the ticket to completed ────────────────────────────────
  await signIn("kitchen");
  await startKot(kot1!);
  await markReady(kot1!);
  await completeKot(kot1!);
  ok("kitchen: KOT #1 new → preparing → ready → completed");

  // ── Cashier: now billable ────────────────────────────────────────────────
  await signIn("cashier");
  split = await billableSplit();
  assert(split.ready.includes(orderId), "order billable after all KOTs completed");
  ok('order moved to "Ready to bill"');

  // ── "Added items later": new round drops it out again ────────────────────
  await signIn("waiter");
  {
    const current = await fetchOrder(orderId);
    const items = mergeItemIntoLines(
      current.items,
      "gulab-jamun",
      "Gulab Jamun (2 pc)",
      8000
    );
    await writeOrderItems(orderId, items);
  }
  await signIn("cashier");
  split = await billableSplit();
  assert(!split.ready.includes(orderId), "un-sent second round blocks billing");
  msg = await expectBillRejected(orderId, cashierUid);
  ok(`second round added — dropped out of billable: "${msg}"`);

  await signIn("waiter");
  const kot2 = await sendKot(orderId, TABLE_LABEL);
  assert(kot2, "second sendKot returned a kot id");
  await signIn("cashier");
  split = await billableSplit();
  assert(!split.ready.includes(orderId), "active KOT #2 blocks billing");
  assert(split.preparing.includes(orderId), "back under Preparing…");
  msg = await expectBillRejected(orderId, cashierUid);
  ok(`KOT #2 active — still not billable: "${msg}"`);

  await signIn("kitchen");
  await startKot(kot2!);
  await completeKot(kot2!);
  await signIn("cashier");
  split = await billableSplit();
  assert(split.ready.includes(orderId), "billable again after KOT #2 completed");
  ok('KOT #2 completed — back in "Ready to bill"');

  // ── Generate + settle the bill ───────────────────────────────────────────
  let order = await fetchOrder(orderId);
  const billId = await generateBill(order, cashierUid, TABLE_LABEL);
  const billSnap = await getDoc(paths.bill(billId));
  assert(billSnap.exists(), "bill doc created");
  const bill = { ...billSnap.data(), id: billSnap.id } as Bill;
  assert(bill.status === "finalized", "bill is finalized");
  assert(bill.subtotal === 12000, `bill subtotal 12000, got ${bill.subtotal}`);
  ok(`bill ${billId} generated (₹${(bill.grandTotal / 100).toFixed(2)})`);

  order = await fetchOrder(orderId);
  assert(order.status === "billed", "order marked billed");
  await settleBill(bill, order, "cash");

  const [paidBill, closedOrder, freedTable] = await Promise.all([
    getDoc(paths.bill(billId)),
    getDoc(paths.order(orderId)),
    getDoc(paths.table(TABLE_ID)),
  ]);
  assert(paidBill.data()!.status === "paid", "bill paid");
  assert(closedOrder.data()!.status === "closed", "order closed");
  assert(freedTable.data()!.status === "available", "table freed");
  assert(freedTable.data()!.currentOrderId === null, "table pointer cleared");
  ok("settled: bill paid, order closed, table available");

  console.log(`\nE2E PASS — ${step} checkpoints, full food-first flow verified.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nE2E FAIL:", e);
    process.exit(1);
  });
