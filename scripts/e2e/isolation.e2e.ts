/**
 * MULTI-TENANT ISOLATION SUITE — the proof that one APK can serve unlimited
 * restaurants with zero data bleed. Drives the REAL app modules (signupApi,
 * staffApi, menuApi, orderApi, cashierApi, paths) against the security rules.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/isolation.e2e.ts
 *
 * What it proves:
 *   1. Owner path: registering a restaurant atomically creates root profile
 *      (+ join code), bootstrap claim, approved cashier, code lookup, index.
 *   2. Two restaurants, each with menu/orders/KOTs/bills of its own.
 *   3. A user of A can read/write NOTHING of B: menus, tables, orders, kots,
 *      bills, users, reports, counters, root profile — and vice versa.
 *   4. A join code adds staff to ITS restaurant only; hand-crafted writes into
 *      another restaurant (wrong/absent join code, forged userIndex) are
 *      rejected server-side, not just client-side.
 *   5. The owner (cashier) seat of an existing restaurant cannot be re-claimed
 *      by anyone, and none of the registration docs can be created alone.
 *   6. The staff approval lifecycle (pending → approved → restricted →
 *      removed) still holds, scoped inside each restaurant.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "./firebase-shim";
import {
  getActiveRestaurantIdOrNull,
  paths,
  setActiveRestaurantId,
} from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff, removeStaff, setStaffActive } from "@/features/staff/staffApi";
import { createMenuItem } from "@/features/menu/menuApi";
import { createOrderLocal, sendKot } from "@/features/order/orderApi";
import { generateBill, settleBill } from "@/features/cashier/cashierApi";
import type { Bill, Order } from "@/types/models";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite registers throwaway restaurants and must " +
      "run against the emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PASSWORD = "Isolate@1234";
const stamp = Date.now().toString(36);
const OWNER_A = `owner-a-${stamp}@sada-pos.test`;
const OWNER_B = `owner-b-${stamp}@sada-pos.test`;
const WAITER_A = `waiter-a-${stamp}@sada-pos.test`;
const INTRUDER = `intruder-${stamp}@sada-pos.test`;

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

async function signIn(email: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
  return cred.user.uid;
}

/** Full read/write sweep of `victim`'s data as whoever is signed in now. */
async function assertNoAccess(who: string, victim: string, victimMenuItemId: string) {
  const prev = getActiveRestaurantIdOrNull();
  setActiveRestaurantId(victim);
  try {
    await expectDenied(`${who}: read ${victim} root profile`, () =>
      getDoc(paths.restaurantProfile()),
    );
    await expectDenied(`${who}: list ${victim} menuItems`, () =>
      getDocs(paths.menuItems()),
    );
    await expectDenied(`${who}: list ${victim} menuCategories`, () =>
      getDocs(paths.menuCategories()),
    );
    await expectDenied(`${who}: list ${victim} tables`, () =>
      getDocs(paths.tables()),
    );
    await expectDenied(`${who}: list ${victim} orders`, () =>
      getDocs(paths.orders()),
    );
    await expectDenied(`${who}: list ${victim} kots`, () => getDocs(paths.kots()));
    await expectDenied(`${who}: list ${victim} bills`, () =>
      getDocs(paths.bills()),
    );
    await expectDenied(`${who}: list ${victim} users`, () =>
      getDocs(paths.users()),
    );
    await expectDenied(`${who}: read ${victim} daily summary`, () =>
      getDoc(paths.dailySummary("2026-07-10")),
    );
    await expectDenied(`${who}: read ${victim} counters`, () =>
      getDoc(paths.counter("billNumber")),
    );
    await expectDenied(`${who}: read ${victim} menu item doc`, () =>
      getDoc(paths.menuItem(victimMenuItemId)),
    );
    await expectDenied(`${who}: write menu item into ${victim}`, () =>
      setDoc(paths.menuItem("intruded-item"), {
        id: "intruded-item",
        name: "Intruded",
        categoryId: "x",
        price: 100,
        enabled: true,
      }),
    );
    await expectDenied(`${who}: overwrite ${victim} menu item`, () =>
      updateDoc(paths.menuItem(victimMenuItemId), { price: 1 }),
    );
    await expectDenied(`${who}: write table into ${victim}`, () =>
      setDoc(paths.table("intruded-t1"), {
        id: "intruded-t1",
        number: 99,
        capacity: 2,
        status: "available",
        currentOrderId: null,
        mergedInto: null,
        updatedAt: null,
      }),
    );
    await expectDenied(`${who}: write order into ${victim}`, () =>
      setDoc(paths.order("intruded-order"), {
        id: "intruded-order",
        tableId: null,
        orderType: "takeaway",
        waiterId: "x",
        status: "open",
        items: [],
        subtotal: 0,
        billId: null,
        createdAt: null,
        updatedAt: null,
      }),
    );
    await expectDenied(`${who}: write counter in ${victim}`, () =>
      setDoc(paths.counter("billNumber"), { value: 0 }),
    );
    await expectDenied(`${who}: update ${victim} root profile`, () =>
      updateDoc(paths.restaurantProfile(), { name: "Hacked" }),
    );
    // Own-uid profile doc in the victim restaurant may be *read* (rule allows
    // reading your own path) but must not exist.
    const self = await getDoc(paths.user(auth.currentUser!.uid));
    assert(!self.exists(), `${who} has no profile inside ${victim}`);
    ok(`${who}: zero read/write access to ${victim}`);
  } finally {
    setActiveRestaurantId(prev);
  }
}

/** Seed a takeaway order → KOT → bill → paid, all through the real APIs. */
async function seedSale(cashierUid: string): Promise<string> {
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: cashierUid,
    menuItemId: "chai",
    name: "Masala Chai",
    price: 4000,
  });
  await created.commit;
  await sendKot(created.orderId, "Takeaway");
  const orderSnap = await getDoc(paths.order(created.orderId));
  assert(orderSnap.exists(), "seed order exists");
  const order = { ...orderSnap.data(), id: orderSnap.id } as Order;
  const billId = await generateBill(order, cashierUid, "Takeaway");
  const billSnap = await getDoc(paths.bill(billId));
  const bill = { ...billSnap.data(), id: billSnap.id } as Bill;
  const billedOrder = {
    ...(await getDoc(paths.order(created.orderId))).data()!,
    id: created.orderId,
  } as Order;
  await settleBill(bill, billedOrder, "cash");
  return billId;
}

async function main() {
  // ── 1. Register restaurant A (owner path) ────────────────────────────────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Alpha Kitchen", "Owner A", OWNER_A, PASSWORD);
  const ownerAUid = auth.currentUser!.uid;
  const ridA = getActiveRestaurantIdOrNull()!;
  assert(ridA, "active restaurant set after registration");

  const profA = await getDoc(paths.restaurantProfile());
  assert(profA.exists(), "A root profile exists");
  assert(profA.data()!.name === "Alpha Kitchen", "A profile name");
  const codeA = profA.data()!.joinCode!;
  assert(typeof codeA === "string" && codeA.length === 6, "A join code minted");
  const ownerADoc = await getDoc(paths.user(ownerAUid));
  assert(ownerADoc.data()!.role === "cashier", "owner A is cashier");
  assert(ownerADoc.data()!.status === "approved", "owner A approved");
  assert(ownerADoc.data()!.active === true, "owner A active");
  const bootA = await getDoc(paths.bootstrap());
  assert(bootA.data()!.cashierClaimed === true, "A cashier seat claimed");
  const codeDocA = await getDoc(paths.restaurantCode(codeA));
  assert(codeDocA.data()!.restaurantId === ridA, "A code lookup points home");
  const idxA = await getDoc(paths.userIndex(ownerAUid));
  assert(idxA.data()!.restaurantId === ridA, "owner A userIndex points home");
  ok(`restaurant A registered atomically (${ridA}, code ${codeA})`);

  // A's data through the real app APIs
  const menuA = await createMenuItem({
    name: "Alpha Dosa",
    categoryId: "mains",
    price: 12000,
    enabled: true,
  });
  const billA = await seedSale(ownerAUid);
  ok(`A seeded: menu item ${menuA}, settled bill ${billA}`);

  // ── 2. Register restaurant B ─────────────────────────────────────────────
  await signOut(auth);
  await registerRestaurant("Beta Bistro", "Owner B", OWNER_B, PASSWORD);
  const ownerBUid = auth.currentUser!.uid;
  const ridB = getActiveRestaurantIdOrNull()!;
  assert(ridB !== ridA, "B got its own restaurant id");
  const profB = await getDoc(paths.restaurantProfile());
  const codeB = profB.data()!.joinCode!;
  assert(codeB !== codeA, "B got its own join code");
  const menuB = await createMenuItem({
    name: "Beta Biryani",
    categoryId: "mains",
    price: 22000,
    enabled: true,
  });
  const billB = await seedSale(ownerBUid);
  ok(`restaurant B registered (${ridB}, code ${codeB}); seeded menu ${menuB}, bill ${billB}`);

  // ── 3. Cross-tenant sweeps: B→A and A→B ──────────────────────────────────
  await assertNoAccess("owner B", ridA, menuA);
  await signIn(OWNER_A);
  setActiveRestaurantId(ridA);
  await assertNoAccess("owner A", ridB, menuB);

  // A can still read its own data (sanity that denials above weren't global)
  const ownMenu = await getDocs(paths.menuItems());
  assert(ownMenu.size === 1, "owner A still reads own menu");
  ok("owners retain full access to their own restaurant");

  // ── 4. Staff joins A by join code; approval lifecycle ────────────────────
  await signOut(auth);
  await joinRestaurant(codeA, "Waiter A", WAITER_A, PASSWORD, "waiter");
  const waiterAUid = auth.currentUser!.uid;
  assert(getActiveRestaurantIdOrNull() === ridA, "join resolved code → A");
  const wIdx = await getDoc(paths.userIndex(waiterAUid));
  assert(wIdx.data()!.restaurantId === ridA, "waiter index → A, not B");
  const wDoc = await getDoc(paths.user(waiterAUid));
  assert(wDoc.data()!.status === "pending", "waiter lands pending");
  assert(wDoc.data()!.active === false, "waiter lands inactive");
  ok("staff joined A via join code (pending + inactive)");

  await expectDenied("pending waiter reading A menu", () =>
    getDocs(paths.menuItems()),
  );
  await expectDenied("pending waiter self-approving", () =>
    updateDoc(paths.user(waiterAUid), { status: "approved", active: true }),
  );
  ok("pending waiter locked out until approval");

  await signIn(OWNER_A);
  await approveStaff(waiterAUid);
  await signIn(WAITER_A);
  const menuAsWaiter = await getDocs(paths.menuItems());
  assert(menuAsWaiter.size === 1, "approved waiter reads A menu");
  ok("cashier approved the waiter (existing flow intact)");

  // The approved waiter of A still gets nothing of B
  await assertNoAccess("waiter A", ridB, menuB);
  // ...and can't touch the owner's profile in their own restaurant
  await expectDenied("waiter restricting the cashier", () =>
    updateDoc(paths.user(ownerAUid), { active: false }),
  );
  ok("waiter cannot touch the cashier's profile");

  // ── 5. Join-code forgery: A's code cannot plant anyone in B ──────────────
  await signOut(auth);
  const intruder = await createUserWithEmailAndPassword(auth, INTRUDER, PASSWORD);
  const intruderUid = intruder.user.uid;

  setActiveRestaurantId(ridB);
  await expectDenied("crafted pending profile in B using A's code", () => {
    const batch = writeBatch(db);
    batch.set(paths.user(intruderUid), {
      uid: intruderUid,
      name: "Intruder",
      email: INTRUDER,
      role: "waiter",
      status: "pending",
      active: false,
      joinCode: codeA, // knows A's code, targets B
      createdAt: null,
    });
    batch.set(paths.userIndex(intruderUid), { restaurantId: ridB });
    return batch.commit();
  });
  await expectDenied("crafted pending profile in B with no code", () =>
    setDoc(paths.user(intruderUid), {
      uid: intruderUid,
      name: "Intruder",
      email: INTRUDER,
      role: "waiter",
      status: "pending",
      active: false,
      createdAt: null,
    }),
  );
  await expectDenied("forged userIndex → B without membership", () =>
    setDoc(paths.userIndex(intruderUid), { restaurantId: ridB }),
  );
  ok("A's join code is worthless outside A; userIndex can't be forged");

  // ── 6. Owner seat of an existing restaurant can't be re-claimed ──────────
  setActiveRestaurantId(ridA);
  await expectDenied("re-claiming A's cashier seat", () => {
    const batch = writeBatch(db);
    batch.set(paths.user(intruderUid), {
      uid: intruderUid,
      name: "Second Owner",
      email: INTRUDER,
      role: "cashier",
      status: "approved",
      active: true,
      createdAt: null,
    });
    batch.set(paths.bootstrap(), { cashierClaimed: true });
    batch.set(paths.userIndex(intruderUid), { restaurantId: ridA });
    return batch.commit();
  });
  await expectDenied("hijacking A's root profile", () =>
    setDoc(paths.restaurantProfile(), {
      name: "Taken Over",
      joinCode: codeA,
      updatedAt: null,
    }),
  );
  // Registration docs can't be created alone either: an approved cashier
  // users-doc without the bootstrap flip in the same batch.
  await expectDenied("cashier profile without bootstrap claim", () =>
    setDoc(paths.user(intruderUid), {
      uid: intruderUid,
      name: "Second Owner",
      email: INTRUDER,
      role: "cashier",
      status: "approved",
      active: true,
      createdAt: null,
    }),
  );
  ok("existing restaurant cannot be re-claimed or hijacked");
  await intruder.user.delete();

  // ── 7. userIndex is immutable: a login can't re-point itself ─────────────
  await signIn(WAITER_A);
  setActiveRestaurantId(ridA);
  await expectDenied("waiter re-pointing own userIndex at B", () =>
    setDoc(paths.userIndex(waiterAUid), { restaurantId: ridB }),
  );
  await expectDenied("waiter reading someone else's userIndex", () =>
    getDoc(paths.userIndex(ownerBUid)),
  );
  await expectDenied("waiter listing restaurantCodes", () =>
    getDocs(paths.restaurantCode(codeB).parent),
  );
  ok("userIndex immutable; codes and indexes can't be enumerated");

  // ── 8. Restrict + remove still work, scoped to A ─────────────────────────
  await signIn(OWNER_A);
  await setStaffActive(waiterAUid, false);
  await signIn(WAITER_A);
  await expectDenied("restricted waiter reading A menu", () =>
    getDocs(paths.menuItems()),
  );
  await signIn(OWNER_A);
  await removeStaff(waiterAUid);
  await signIn(WAITER_A);
  const gone = await getDoc(paths.user(waiterAUid));
  assert(!gone.exists(), "removed waiter's profile is gone");
  await expectDenied("removed waiter reading A menu", () =>
    getDocs(paths.menuItems()),
  );
  ok("restrict/remove lifecycle intact inside A");

  // ── 9. Unknown join code fails cleanly and rolls the login back ──────────
  await signOut(auth);
  try {
    await joinRestaurant("ZZZZZZ", "Nobody", `nobody-${stamp}@sada-pos.test`, PASSWORD, "waiter");
    throw new Error("join with unknown code unexpectedly SUCCEEDED");
  } catch (e) {
    assert(
      e instanceof Error && e.message.includes("join code"),
      `unknown code: expected friendly error, got ${e}`,
    );
  }
  try {
    await signInWithEmailAndPassword(auth, `nobody-${stamp}@sada-pos.test`, PASSWORD);
    throw new Error("rolled-back login still exists");
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    assert(code.startsWith("auth/"), `expected auth error, got ${e}`);
  }
  ok("unknown join code: clear error, login rolled back");

  console.log(
    `\nISOLATION E2E PASS — ${step} checkpoints, two tenants fully isolated.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nISOLATION E2E FAIL:", e);
    process.exit(1);
  });
