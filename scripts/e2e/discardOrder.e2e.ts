/**
 * DISCARD SUITE — the proof that an abandoned order can be thrown away, and
 * that nothing which is actually in flight can be thrown away with it.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/discardOrder.e2e.ts
 *
 * The model under test:
 *   - An order with NO kitchen ticket is a note somebody stopped writing. No
 *     food was cooked and no money was counted, so it can be cancelled
 *     outright. Before this existed such an order was permanent: the Bills
 *     screen filed it under "Preparing…" (not kitchen-done), that card is
 *     untappable, and nothing else in the app could reach the order — so the
 *     cashier's list only ever grew.
 *   - `cancelled`, never deleted — the same word `voidBill` writes for an
 *     order that ended without money changing hands.
 *   - The three refusals are the whole safety property: an order the kitchen
 *     HAS must not vanish from under the pass, a BILLED order belongs to the
 *     settle/void path (which has the day's takings to correct), and a
 *     finished order cannot be re-cancelled.
 *   - Discarding a dine-in order gives the TABLE back, exactly as settling
 *     would. A freed slot is the difference between a cleared order and a
 *     table nobody can seat.
 *
 * Note the deliberate asymmetry with the rest of the money path: these guards
 * live in `discardOrder`, not in firestore.rules. The rules cannot express
 * them — "no line carries a kotId" is a scan of an array, and the write itself
 * (an order going to `cancelled`) is one the rules already allow any of
 * admin/waiter/cashier to make, because that is what voiding a bill does. So
 * this suite IS the enforcement, which is why it checks each refusal against
 * the stored document rather than trusting the throw.
 */
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDoc } from "firebase/firestore";
import adminSdk from "firebase-admin";
import { auth } from "./firebase-shim";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff } from "@/features/staff/staffApi";
import { createOrderLocal, sendKot } from "@/features/order/orderApi";
import { openTable } from "@/features/tables/tablesApi";
import {
  discardOrder,
  generateBill,
  hasLiveKitchenLines,
} from "@/features/cashier/cashierApi";
import type { Order, Table } from "@/types/models";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite cancels orders and must run against the " +
      "emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PROJECT_ID = "demo-sada-isolation";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
adminSdk.initializeApp({ projectId: PROJECT_ID });

const PASSWORD = "Discard@1234";
const stamp = Date.now().toString(36);
const OWNER = `discard-owner-${stamp}@sada-pos.test`;
const WAITER = `discard-waiter-${stamp}@sada-pos.test`;

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

async function readOrder(orderId: string): Promise<Order> {
  const snap = await getDoc(paths.order(orderId));
  assert(snap.exists(), `order ${orderId} exists`);
  return { ...snap.data()!, id: orderId } as Order;
}

/** A takeaway order with one line, never sent to the kitchen. */
async function abandonedTakeaway(waiterUid: string): Promise<string> {
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: waiterUid,
    menuItemId: CHAI_ID,
    name: "Masala Chai",
    price: CHAI_PRICE,
  });
  await created.commit;
  return created.orderId;
}

async function main() {
  // ── Setup ────────────────────────────────────────────────────────────────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Discard Diner", "Discard Owner", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  rid = (await getDoc(paths.userIndex(ownerUid))).data()!.restaurantId;
  setActiveRestaurantId(rid);

  const joinCode = (await getDoc(paths.restaurantProfile())).data()!.joinCode!;
  await signOut(auth);
  await joinRestaurant(joinCode, "Discard Waiter", WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;
  await signIn(OWNER);
  await approveStaff(waiterUid);
  ok("registered a restaurant with an owner-cashier and an approved waiter");

  // ── 1. The whole point: an unsent order can be thrown away ────────────────
  const stale = await abandonedTakeaway(ownerUid);
  const staleOrder = await readOrder(stale);
  assert(
    !hasLiveKitchenLines(staleOrder),
    "the order carries no kitchen ticket",
  );
  assert(staleOrder.status === "open", "and it is open, i.e. on the Bills list");

  await discardOrder(stale);
  const discarded = await readOrder(stale);
  assert(
    discarded.status === "cancelled",
    `discarded order is cancelled, got "${discarded.status}"`,
  );
  assert(
    discarded.items.length === staleOrder.items.length,
    "its lines survive — cancelled is a state, not an erasure",
  );
  ok("an order the kitchen never saw is cancelled, lines intact");

  // ── 2. Cancelling is terminal — it cannot run twice ───────────────────────
  await expectThrows("discarding an already-cancelled order", () =>
    discardOrder(stale),
  );
  ok("a discarded order cannot be discarded again");

  // ── 3. The kitchen's food is not the cashier's to delete ─────────────────
  const cooking = await abandonedTakeaway(ownerUid);
  await sendKot(cooking, "Takeaway");
  const cookingOrder = await readOrder(cooking);
  assert(hasLiveKitchenLines(cookingOrder), "the ticket reached the kitchen");

  await expectThrows("discarding an order the kitchen is cooking", () =>
    discardOrder(cooking),
  );
  assert(
    (await readOrder(cooking)).status === "open",
    "the order the kitchen holds is untouched",
  );
  ok("an order already sent to the kitchen refuses to be discarded");

  // ── 4. A billed order belongs to the settle/void path ─────────────────────
  const billedOrderId = cooking;
  await generateBill(
    await readOrder(billedOrderId),
    ownerUid,
    "Takeaway",
    false,
  );
  await expectThrows("discarding a billed order", () =>
    discardOrder(billedOrderId),
  );
  const stillBilled = await readOrder(billedOrderId);
  assert(
    stillBilled.status === "billed" && !!stillBilled.billId,
    "the billed order keeps its bill and its status",
  );
  ok("a billed order refuses to be discarded — settle or void it instead");

  // ── 5. Discarding a dine-in order gives the table back ────────────────────
  const table1 = await firstTableId();
  const dineInOrderId = await openTable(table1, ownerUid);
  const occupied = (await getDoc(paths.table(table1))).data() as Table;
  assert(
    occupied.currentOrderId === dineInOrderId,
    "the table is holding the new order",
  );

  await discardOrder(dineInOrderId);
  const freed = (await getDoc(paths.table(table1))).data() as Table;
  assert(
    freed.status === "available" && freed.currentOrderId === null,
    `table freed, got status "${freed.status}" / order ${freed.currentOrderId}`,
  );
  assert(
    (await readOrder(dineInOrderId)).status === "cancelled",
    "and the dine-in order is cancelled",
  );
  ok("discarding a dine-in order releases the table it was holding");

  // ── 6. A waiter may discard too — they are who abandons orders ───────────
  await signIn(WAITER);
  const waiterStale = await abandonedTakeaway(waiterUid);
  await discardOrder(waiterStale);
  assert(
    (await readOrder(waiterStale)).status === "cancelled",
    "the waiter's own abandoned order is cancelled",
  );
  ok("a waiter can clear an order they abandoned — the rules already allow it");

  console.log(`\nDISCARD E2E PASS — ${step} checkpoints.`);
}

/** The first table the starter data created, whatever it was numbered. */
async function firstTableId(): Promise<string> {
  const snap = await adminSdk
    .firestore()
    .collection(`restaurants/${rid}/tables`)
    .limit(1)
    .get();
  assert(!snap.empty, "the restaurant has at least one table");
  return snap.docs[0].id;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nDISCARD E2E FAIL:", e);
    process.exit(1);
  });
