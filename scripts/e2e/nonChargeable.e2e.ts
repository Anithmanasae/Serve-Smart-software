/**
 * NON-CHARGEABLE ("NC") SUITE — the proof that a comped bill leaves the
 * building for free WITHOUT leaving the sales figures wrong, and that nobody
 * can quietly widen the hole. Drives the REAL app modules (signupApi, staffApi,
 * orderApi, cashierApi, reportsData) against the security rules.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/nonChargeable.e2e.ts
 *
 * What it proves:
 *   1. A cash sale rolls into the daily summary exactly as before (baseline).
 *   2. An NC settlement closes the order and frees the table like any other,
 *      but adds NOTHING to revenue, order count, payment split, source split
 *      or item sales — it lands only in ncCount / ncAmount / byNcReason.
 *   3. The bill keeps its REAL total, so the cost of the comp is recorded.
 *   4. The rules reject every way of abusing it: born-NC bills, comps with no
 *      reason or a made-up one, comps that rewrite the totals to hide their
 *      value, un-comping a settled bill, and a waiter comping anything.
 *   5. A reprint of an NC bill still works (the one permitted mutation).
 *   6. The reports layer aggregates all of the above back out correctly.
 */
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth } from "./firebase-shim";
import {
  getActiveRestaurantIdOrNull,
  paths,
  setActiveRestaurantId,
} from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff } from "@/features/staff/staffApi";
import { createOrderLocal, sendKot } from "@/features/order/orderApi";
import { generateBill, settleBill } from "@/features/cashier/cashierApi";
import { ncReasonSummary, sumTotals } from "@/features/reports/reportsData";
import { dayKey } from "@/lib/date";
import type { Bill, DailySummary, Order } from "@/types/models";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite registers a throwaway restaurant and must " +
      "run against the emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PASSWORD = "Comped@1234";
const stamp = Date.now().toString(36);
const OWNER = `owner-nc-${stamp}@sada-pos.test`;
const WAITER = `waiter-nc-${stamp}@sada-pos.test`;

/** Two identical ₹40 chai orders: one sold, one comped. GST is on by default
 *  in generateBill, so each bill is 4000 + 5% = 4200 paise. */
const ITEM_PRICE = 4000;
const EXPECTED_TOTAL = 4200;

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✔ [${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** Run an op the rules must REJECT with permission-denied. */
async function expectDenied(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    assert(
      code === "permission-denied",
      `${what}: expected permission-denied, got "${code}": ${e}`,
    );
    return;
  }
  throw new Error(`${what}: unexpectedly SUCCEEDED`);
}

/** Open a takeaway order, fire its KOT, and finalize a bill — stopping just
 *  short of settlement so the caller decides how it gets closed out. */
async function openBill(
  cashierUid: string,
): Promise<{ bill: Bill; order: Order }> {
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: cashierUid,
    menuItemId: "chai",
    name: "Masala Chai",
    price: ITEM_PRICE,
  });
  await created.commit;
  await sendKot(created.orderId, "Takeaway");
  const openSnap = await getDoc(paths.order(created.orderId));
  const billId = await generateBill(
    { ...openSnap.data(), id: openSnap.id } as Order,
    cashierUid,
    "Takeaway",
  );
  const [billSnap, orderSnap] = await Promise.all([
    getDoc(paths.bill(billId)),
    getDoc(paths.order(created.orderId)),
  ]);
  return {
    bill: { ...billSnap.data(), id: billSnap.id } as Bill,
    order: { ...orderSnap.data(), id: orderSnap.id } as Order,
  };
}

async function todaySummary(): Promise<DailySummary> {
  const snap = await getDoc(paths.dailySummary(dayKey()));
  assert(snap.exists(), "today's summary exists");
  return { ...snap.data(), id: snap.id } as DailySummary;
}

async function main() {
  // ── 1. A restaurant, and one ordinary cash sale as the baseline ──────────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Comp Cafe", "Owner NC", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  const rid = getActiveRestaurantIdOrNull()!;
  ok(`restaurant registered (${rid})`);

  const sale = await openBill(ownerUid);
  assert(
    sale.bill.grandTotal === EXPECTED_TOTAL,
    `sale bill ${EXPECTED_TOTAL}, got ${sale.bill.grandTotal}`,
  );
  await settleBill(sale.bill, sale.order, { kind: "paid", mode: "cash" });

  const afterSale = await todaySummary();
  assert(afterSale.totalRevenue === EXPECTED_TOTAL, "revenue counted the sale");
  assert(afterSale.orderCount === 1, "order count counted the sale");
  assert(afterSale.byPaymentMode.cash === EXPECTED_TOTAL, "cash bucket");
  assert(afterSale.bySource.takeaway === EXPECTED_TOTAL, "takeaway bucket");
  assert(afterSale.itemSales.chai?.qty === 1, "item sales counted the chai");
  assert((afterSale.ncCount ?? 0) === 0, "no comps yet");
  ok(`baseline cash sale settled and counted (${EXPECTED_TOTAL} paise)`);

  // ── 2. An identical bill, comped ─────────────────────────────────────────
  const comp = await openBill(ownerUid);
  const compBillId = comp.bill.id;
  await settleBill(comp.bill, comp.order, {
    kind: "nc",
    reason: "staff",
    note: "late shift meal",
  });

  const compBill = (await getDoc(paths.bill(compBillId))).data()!;
  assert(compBill.status === "paid", "comped bill is settled");
  assert(compBill.nonChargeable === true, "comped bill flagged non-chargeable");
  assert(compBill.ncReason === "staff", "reason recorded");
  assert(compBill.ncNote === "late shift meal", "note recorded");
  assert(compBill.paymentMode === null, "no payment mode on a comp");
  // The whole point of recording a comp is knowing what it cost.
  assert(
    compBill.grandTotal === EXPECTED_TOTAL,
    `comped bill KEPT its real total, got ${compBill.grandTotal}`,
  );
  const closedOrder = (await getDoc(paths.order(comp.order.id))).data()!;
  assert(closedOrder.status === "closed", "comped order still closes");
  ok("comped bill: settled, flagged, reason + real value preserved");

  // ── 3. ...and it changed NONE of the sales figures ───────────────────────
  const afterComp = await todaySummary();
  assert(
    afterComp.totalRevenue === EXPECTED_TOTAL,
    `revenue unchanged by the comp, got ${afterComp.totalRevenue}`,
  );
  assert(afterComp.orderCount === 1, "order count unchanged by the comp");
  assert(
    afterComp.byPaymentMode.cash === EXPECTED_TOTAL,
    "payment split unchanged by the comp",
  );
  assert(
    afterComp.bySource.takeaway === EXPECTED_TOTAL,
    "source split unchanged by the comp",
  );
  assert(
    afterComp.itemSales.chai?.qty === 1,
    "comped food stayed out of item sales",
  );
  assert(afterComp.ncCount === 1, "comp counted once under ncCount");
  assert(afterComp.ncAmount === EXPECTED_TOTAL, "comp value under ncAmount");
  assert(
    afterComp.byNcReason?.staff === EXPECTED_TOTAL,
    "comp value filed under its reason",
  );
  assert((afterComp.byNcReason?.owner ?? 0) === 0, "other reasons untouched");
  ok("comp is invisible to revenue/orders/payments/sources/items — NC only");

  // ── 4. Reports read it all back correctly ────────────────────────────────
  const totals = sumTotals([afterComp]);
  assert(totals.totalRevenue === EXPECTED_TOTAL, "reports: revenue");
  assert(totals.orderCount === 1, "reports: order count");
  // The comp must not dilute AOV — that is why it stays out of orderCount.
  assert(
    totals.avgOrderValue === EXPECTED_TOTAL,
    `reports: AOV undiluted by the comp, got ${totals.avgOrderValue}`,
  );
  assert(totals.ncCount === 1 && totals.ncAmount === EXPECTED_TOTAL, "reports: nc");
  assert(
    ncReasonSummary([afterComp]).staff === EXPECTED_TOTAL,
    "reports: reason breakdown",
  );
  ok("reports aggregate revenue, AOV and comps consistently");

  // ── 5. A settled comp is frozen — except for a reprint ───────────────────
  await expectDenied("un-comping a settled bill", () =>
    updateDoc(paths.bill(compBillId), { nonChargeable: false }),
  );
  await expectDenied("changing a settled comp's reason", () =>
    updateDoc(paths.bill(compBillId), { ncReason: "complaint" }),
  );
  await expectDenied("zeroing a settled comp's value under a reprint", () =>
    updateDoc(paths.bill(compBillId), { printedCount: 1, grandTotal: 0 }),
  );
  await updateDoc(paths.bill(compBillId), { printedCount: 1 });
  assert(
    (await getDoc(paths.bill(compBillId))).data()!.printedCount === 1,
    "reprint of a comped bill still allowed",
  );
  ok("settled comp frozen; reprint still works");

  // ── 6. A bill can never be BORN comped ───────────────────────────────────
  await expectDenied("creating a bill already marked non-chargeable", () =>
    setDoc(paths.bill(`born-nc-${stamp}`), {
      id: `born-nc-${stamp}`,
      billNumber: 999,
      orderId: "x",
      tableId: null,
      tableLabel: "Takeaway",
      subtotal: ITEM_PRICE,
      discountPercent: 0,
      discountAmount: 0,
      cgst: 100,
      sgst: 100,
      gstTotal: 200,
      grandTotal: EXPECTED_TOTAL,
      status: "finalized",
      paymentMode: null,
      nonChargeable: true,
      ncReason: "owner",
      requestedBy: ownerUid,
      cashierId: ownerUid,
      printedCount: 0,
      createdAt: null,
      paidAt: null,
    }),
  );
  ok("a bill cannot be created already comped — NC only arrives at settle");

  // ── 7. The comp itself must be well-formed and honest ────────────────────
  const probe = await openBill(ownerUid);
  const probeId = probe.bill.id;
  await expectDenied("comping with no reason", () =>
    updateDoc(paths.bill(probeId), {
      status: "paid",
      paymentMode: null,
      nonChargeable: true,
    }),
  );
  await expectDenied("comping with a made-up reason", () =>
    updateDoc(paths.bill(probeId), {
      status: "paid",
      paymentMode: null,
      nonChargeable: true,
      ncReason: "because-i-said-so",
    }),
  );
  await expectDenied("comping while also claiming a payment was taken", () =>
    updateDoc(paths.bill(probeId), {
      status: "paid",
      paymentMode: "cash",
      nonChargeable: true,
      ncReason: "owner",
    }),
  );
  // The one that matters most: a comp may not rewrite what it was worth.
  await expectDenied("comping while zeroing the total to hide its cost", () =>
    updateDoc(paths.bill(probeId), {
      status: "paid",
      paymentMode: null,
      nonChargeable: true,
      ncReason: "owner",
      subtotal: 0,
      gstTotal: 0,
      grandTotal: 0,
    }),
  );
  ok("comps must carry a real reason, no payment, and their true value");

  // ── 8. A waiter cannot comp anything ─────────────────────────────────────
  // Still the owner here: read the join code before handing the session over.
  const joinCode = (await getDoc(paths.restaurantProfile())).data()!.joinCode!;

  await signOut(auth);
  await joinRestaurant(joinCode, "Waiter NC", WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;

  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await approveStaff(waiterUid);

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectDenied("waiter comping a bill", () =>
    updateDoc(paths.bill(probeId), {
      status: "paid",
      paymentMode: null,
      nonChargeable: true,
      ncReason: "owner",
    }),
  );
  ok("an approved waiter cannot comp a bill — cashier/admin only");

  console.log(
    `\nNON-CHARGEABLE E2E PASS — ${step} checkpoints, comps recorded and contained.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nNON-CHARGEABLE E2E FAIL:", e);
    process.exit(1);
  });
