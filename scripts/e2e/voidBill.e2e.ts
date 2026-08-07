/**
 * CANCEL (VOID) SUITE — the proof that cancelling a settled bill really does
 * take the sale back out of the day, and that nothing else can ride along on
 * that write.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/voidBill.e2e.ts
 *
 * The model under test:
 *   - A void is the exact INVERSE of the settle that preceded it. A charged
 *     bill unwinds from totalRevenue/orderCount/byPaymentMode/bySource/
 *     itemSales; a COMPED one was never in any of those and unwinds from
 *     ncCount/ncAmount/byNcReason instead.
 *   - Both then land in voidedBillCount/voidedRevenue, so a reversed sale is
 *     visible rather than a silent hole in the day.
 *   - Only a bill paid on the CURRENT IST business day can be cancelled. A day
 *     the owner has already read never moves.
 *   - 'void' is terminal: the prior status must be 'paid', so the summary can
 *     never be decremented twice for one bill.
 *
 * What it proves:
 *   1. Settling then cancelling returns the day's summary to exactly where it
 *      started — every bucket, including Top Items.
 *   2. The cancellation is still recorded (voidedBillCount / voidedRevenue).
 *   3. The bill carries a server-stamped voidedAt and the real actor's uid;
 *      the order goes to 'cancelled'.
 *   4. A comped bill cancels out of the NC buckets and leaves revenue alone.
 *   5. Cancelling twice is refused.
 *   6. A waiter cannot cancel.
 *   7. No money field, and no forged actor or timestamp, can ride along on the
 *      void write — each is rejected by the RULES, not just by the client.
 *   8. A bill paid on an earlier day cannot be cancelled at all.
 */
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  getDoc,
  serverTimestamp,
  Timestamp as ClientTimestamp,
  updateDoc,
} from "firebase/firestore";
import adminSdk from "firebase-admin";
import { auth } from "./firebase-shim";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff } from "@/features/staff/staffApi";
import { createOrderLocal, sendKot } from "@/features/order/orderApi";
import {
  generateBill,
  settleBill,
  voidBill,
  type Settlement,
} from "@/features/cashier/cashierApi";
import { dayKey } from "@/lib/date";
import type { Bill, DailySummary, Order } from "@/types/models";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite settles and cancels bills and must run " +
      "against the emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PROJECT_ID = "demo-sada-isolation";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
adminSdk.initializeApp({ projectId: PROJECT_ID });
const adminDb = adminSdk.firestore();

const PASSWORD = "Void@1234";
const stamp = Date.now().toString(36);
const OWNER = `void-owner-${stamp}@sada-pos.test`;
const WAITER = `void-waiter-${stamp}@sada-pos.test`;

const CHAI_ID = "masala-chai";
const CHAI_PRICE = 4000; // paise

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✔ [${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

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

/** For the client-side guards in voidBill, which throw plain Errors. */
async function expectThrows(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch {
    return;
  }
  throw new Error(`${what}: unexpectedly SUCCEEDED`);
}

let rid = "";

async function signIn(email: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
  setActiveRestaurantId(rid);
  return cred.user.uid;
}

/** The day's summary as the reports read it (absent = a day with no sales). */
async function summary(): Promise<Partial<DailySummary>> {
  const snap = await adminDb.doc(`restaurants/${rid}/dailySummaries/${dayKey()}`).get();
  return (snap.data() ?? {}) as Partial<DailySummary>;
}

/**
 * A takeaway order settled through the real app path. Takeaway is pay-first,
 * so it is billable as soon as its KOT exists — no kitchen wait to simulate.
 */
async function settledBill(
  cashierUid: string,
  settlement: Settlement,
): Promise<Bill> {
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: cashierUid,
    menuItemId: CHAI_ID,
    name: "Masala Chai",
    price: CHAI_PRICE,
  });
  await created.commit;
  await sendKot(created.orderId, "Takeaway");

  const orderSnap = await getDoc(paths.order(created.orderId));
  const order = { ...orderSnap.data()!, id: created.orderId } as Order;
  const billId = await generateBill(order, cashierUid, "Takeaway", false);

  const billSnap = await getDoc(paths.bill(billId));
  const bill = { ...billSnap.data()!, id: billId } as Bill;
  const billedOrder = {
    ...(await getDoc(paths.order(created.orderId))).data()!,
    id: created.orderId,
  } as Order;
  await settleBill(bill, billedOrder, settlement);
  return bill;
}

async function main() {
  // ── Setup: a fresh restaurant with an owner-cashier and a waiter ──────────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Void Villa", "Void Owner", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  rid = (await getDoc(paths.userIndex(ownerUid))).data()!.restaurantId;
  setActiveRestaurantId(rid);

  const joinCode = (await getDoc(paths.restaurantProfile())).data()!.joinCode!;
  await signOut(auth);
  await joinRestaurant(joinCode, "Void Waiter", WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;
  await signIn(OWNER);
  await approveStaff(waiterUid);
  ok("registered a restaurant with an owner-cashier and an approved waiter");

  // ── 1. Settle then cancel returns every bucket to where it started ────────
  const before = await summary();
  const bill = await settledBill(ownerUid, { kind: "paid", mode: "cash" });
  const afterSettle = await summary();

  assert(
    (afterSettle.totalRevenue ?? 0) ===
      (before.totalRevenue ?? 0) + bill.grandTotal,
    "settling added the sale to totalRevenue",
  );
  assert(
    (afterSettle.itemSales ?? {})[CHAI_ID]?.qty === 1,
    "settling put the item into Top Items",
  );
  ok(`settled ${bill.grandTotal}p — summary took the sale`);

  await voidBill(bill, ownerUid, "bad-food", "curry was cold");
  const afterVoid = await summary();

  assert(
    (afterVoid.totalRevenue ?? 0) === (before.totalRevenue ?? 0),
    `totalRevenue back to ${before.totalRevenue ?? 0}, got ${afterVoid.totalRevenue}`,
  );
  assert(
    (afterVoid.orderCount ?? 0) === (before.orderCount ?? 0),
    "orderCount back to its pre-settle value",
  );
  assert(
    (afterVoid.byPaymentMode?.cash ?? 0) === (before.byPaymentMode?.cash ?? 0),
    "byPaymentMode.cash reversed",
  );
  assert(
    (afterVoid.bySource?.takeaway ?? 0) === (before.bySource?.takeaway ?? 0),
    "bySource.takeaway reversed",
  );
  assert(
    (afterVoid.itemSales ?? {})[CHAI_ID] === undefined,
    "the item left Top Items entirely once its only sale was cancelled",
  );
  ok("cancelling reversed revenue, orders, payment mode, source AND Top Items");

  // ── 2. The reversal is still on the record ───────────────────────────────
  assert(
    (afterVoid.voidedBillCount ?? 0) === (before.voidedBillCount ?? 0) + 1,
    "voidedBillCount incremented",
  );
  assert(
    (afterVoid.voidedRevenue ?? 0) ===
      (before.voidedRevenue ?? 0) + bill.grandTotal,
    "voidedRevenue carries the refunded amount",
  );
  ok("the cancelled sale is tallied, not silently erased");

  // ── 3. Bill and order state ──────────────────────────────────────────────
  const voided = (await getDoc(paths.bill(bill.id))).data()!;
  assert(voided.status === "void", "bill status is 'void'");
  assert(voided.voidedBy === ownerUid, "voidedBy is the real actor");
  assert(voided.voidReason === "bad-food", "voidReason recorded");
  assert(voided.voidNote === "curry was cold", "voidNote recorded");
  assert(!!voided.voidedAt, "voidedAt was server-stamped");
  assert(
    voided.grandTotal === bill.grandTotal,
    "the bill KEEPS its real total — what the refund was worth is the point",
  );
  const cancelledOrder = (await getDoc(paths.order(bill.orderId))).data()!;
  assert(cancelledOrder.status === "cancelled", "order status is 'cancelled'");
  ok("bill frozen as cancelled with actor + server time; order cancelled");

  // ── 4. A COMPED bill unwinds from the NC buckets, not from revenue ───────
  const ncBefore = await summary();
  const ncBill = await settledBill(ownerUid, {
    kind: "nc",
    reason: "complaint",
  });
  const ncSettled = await summary();
  assert(
    (ncSettled.ncCount ?? 0) === (ncBefore.ncCount ?? 0) + 1,
    "comping incremented ncCount",
  );
  assert(
    (ncSettled.totalRevenue ?? 0) === (ncBefore.totalRevenue ?? 0),
    "comping left revenue alone (control)",
  );

  await voidBill(ncBill, ownerUid, "customer-complaint");
  const ncVoided = await summary();
  assert(
    (ncVoided.ncCount ?? 0) === (ncBefore.ncCount ?? 0),
    "cancelling the comp reversed ncCount",
  );
  assert(
    (ncVoided.ncAmount ?? 0) === (ncBefore.ncAmount ?? 0),
    "cancelling the comp reversed ncAmount",
  );
  assert(
    (ncVoided.byNcReason?.complaint ?? 0) ===
      (ncBefore.byNcReason?.complaint ?? 0),
    "cancelling the comp reversed byNcReason",
  );
  assert(
    (ncVoided.totalRevenue ?? 0) === (ncBefore.totalRevenue ?? 0),
    "cancelling a COMP never touches revenue — it was never in it",
  );
  assert(
    (ncVoided.voidedBillCount ?? 0) === (ncSettled.voidedBillCount ?? 0) + 1,
    "a cancelled comp still counts as a cancellation",
  );
  ok("a comped bill cancels out of the NC buckets, leaving revenue untouched");

  // ── 5. Cancelling twice is refused ───────────────────────────────────────
  await expectThrows("second void of the same bill", () =>
    voidBill(bill, ownerUid, "other"),
  );
  const stillOnce = await summary();
  assert(
    (stillOnce.voidedBillCount ?? 0) === (ncVoided.voidedBillCount ?? 0),
    "the refused second void changed nothing",
  );
  ok("a bill cannot be cancelled twice — the summary moves exactly once");

  // ── 6. A waiter cannot cancel ────────────────────────────────────────────
  const live = await settledBill(ownerUid, { kind: "paid", mode: "upi" });
  await signIn(WAITER);
  await expectDenied("waiter cancelling a bill", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: waiterUid,
      voidReason: "bad-food",
    }),
  );
  ok("a waiter cannot cancel a settled bill");

  // ── 7. Nothing may ride along on the void write ──────────────────────────
  await signIn(OWNER);
  await expectDenied("void that also rewrites grandTotal", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: ownerUid,
      voidReason: "bad-food",
      grandTotal: 1,
    }),
  );
  await expectDenied("void naming someone else as the actor", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: waiterUid,
      voidReason: "bad-food",
    }),
  );
  await expectDenied("void with a client-forged voidedAt", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: ClientTimestamp.fromDate(new Date(2020, 0, 1)),
      voidedBy: ownerUid,
      voidReason: "bad-food",
    }),
  );
  await expectDenied("void with a reason outside the fixed set", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: ownerUid,
      voidReason: "because-i-said-so",
    }),
  );
  const untouched = (await getDoc(paths.bill(live.id))).data()!;
  assert(untouched.status === "paid", "the bill survived every attempt intact");
  assert(untouched.grandTotal === live.grandTotal, "its total is unchanged");
  ok("rules rejected a rewritten total, a forged actor, a forged time, a bad reason");

  // ── 8. A bill from an earlier day cannot be cancelled ────────────────────
  // Backdate the payment with the Admin SDK (bypasses rules, as the real
  // tooling does) so "yesterday" needs no waiting.
  await adminDb.doc(`restaurants/${rid}/bills/${live.id}`).set(
    {
      paidAt: adminSdk.firestore.Timestamp.fromDate(
        new Date(Date.now() - 36 * 60 * 60 * 1000),
      ),
    },
    { merge: true },
  );
  const staleBill = {
    ...(await getDoc(paths.bill(live.id))).data()!,
    id: live.id,
  } as Bill;

  await expectThrows("voidBill on a bill paid yesterday (client guard)", () =>
    voidBill(staleBill, ownerUid, "bad-food"),
  );
  await expectDenied("raw void of a bill paid yesterday (the RULE)", () =>
    updateDoc(paths.bill(live.id), {
      status: "void",
      voidedAt: serverTimestamp(),
      voidedBy: ownerUid,
      voidReason: "bad-food",
    }),
  );
  assert(
    (await getDoc(paths.bill(live.id))).data()!.status === "paid",
    "yesterday's bill is still paid",
  );
  ok("a bill settled on an earlier day cannot be cancelled — closed days stay closed");

  console.log(`\nVOID E2E PASS — ${step} checkpoints.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nVOID E2E FAIL:", e);
    process.exit(1);
  });
