/**
 * TRIAL EXPIRY SUITE — the proof that the expiry rules do what they claim, and
 * (far more importantly) that they do NOTHING to accounts without `expiresAt`.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
 *
 * What it proves:
 *   1. CONTROL — a restaurant with no expiresAt anywhere works exactly as
 *      before, start to finish. This is the check that matters: if it ever
 *      fails, the ruleset would lock out every paying customer on deploy.
 *   2. A trial workspace with a FUTURE deadline behaves like a normal one.
 *   3. Past the deadline, every app read/write dies server-side — via the
 *      TENANT field, and independently via the per-ACCOUNT field.
 *   4. An expired account can still read its own profile, its userIndex and the
 *      restaurant root doc, so the app can show "trial ended" rather than a
 *      wall of permission errors.
 *   5. A cashier cannot clear, change or add `expiresAt` on a staff member —
 *      but CAN still run the normal approve/restrict flow.
 *   6. A fresh join-code signup inside an expired workspace is still locked
 *      out, even though its own profile has no expiresAt.
 *
 * `expiresAt` is stamped through the ADMIN SDK here, exactly as
 * scripts/seedTrial.js does — the client SDK is never able to write it, which
 * is itself asserted below.
 */
import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  deleteField,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp as ClientTimestamp,
  updateDoc,
} from "firebase/firestore";
import adminSdk from "firebase-admin";
import { auth } from "./firebase-shim";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff, setStaffActive } from "@/features/staff/staffApi";
import { createMenuItem } from "@/features/menu/menuApi";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite stamps trial expiries and must run against " +
      "the emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PROJECT_ID = "demo-sada-isolation";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
adminSdk.initializeApp({ projectId: PROJECT_ID });
const adminDb = adminSdk.firestore();

const PASSWORD = "Expire@1234";
const stamp = Date.now().toString(36);
const PERM_OWNER = `perm-owner-${stamp}@sada-pos.test`;
const TRIAL_OWNER = `trial-owner-${stamp}@sada-pos.test`;
const TRIAL_WAITER = `trial-waiter-${stamp}@sada-pos.test`;
const LATE_JOINER = `late-joiner-${stamp}@sada-pos.test`;

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

async function expectAllowed(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (e) {
    throw new Error(`${what}: expected success, got ${e}`);
  }
}

const daysFromNow = (days: number) =>
  adminSdk.firestore.Timestamp.fromDate(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  );

/** Client-SDK Timestamp — the admin-SDK one is a different class and the client
 *  SDK rejects it locally before the request ever reaches the rules. */
const clientDaysFromNow = (days: number) =>
  ClientTimestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

/** Stamp/clear the workspace deadline (Admin SDK — bypasses rules, as the
 *  seed script does). Passing null removes the field entirely. */
async function setTenantExpiry(rid: string, value: unknown) {
  await adminDb
    .doc(`restaurants/${rid}`)
    .set(
      { expiresAt: value ?? adminSdk.firestore.FieldValue.delete() },
      { merge: true },
    );
}

async function setUserExpiry(rid: string, uid: string, value: unknown) {
  await adminDb
    .doc(`restaurants/${rid}/users/${uid}`)
    .set(
      { expiresAt: value ?? adminSdk.firestore.FieldValue.delete() },
      { merge: true },
    );
}

/** Every app surface a signed-in staff member normally touches. */
async function expectAppAccessDenied(who: string) {
  await expectDenied(`${who}: list menuItems`, () => getDocs(paths.menuItems()));
  await expectDenied(`${who}: list menuCategories`, () =>
    getDocs(paths.menuCategories()),
  );
  await expectDenied(`${who}: list tables`, () => getDocs(paths.tables()));
  await expectDenied(`${who}: list orders`, () => getDocs(paths.orders()));
  await expectDenied(`${who}: list kots`, () => getDocs(paths.kots()));
  await expectDenied(`${who}: list bills`, () => getDocs(paths.bills()));
  await expectDenied(`${who}: read counters`, () =>
    getDoc(paths.counter("billNumber")),
  );
  await expectDenied(`${who}: create a menu item`, () =>
    createMenuItem({
      name: "Should Not Exist",
      categoryId: "x",
      price: 100,
      enabled: true,
    }),
  );
}

async function expectAppAccessWorks(who: string) {
  await expectAllowed(`${who}: list menuItems`, () => getDocs(paths.menuItems()));
  await expectAllowed(`${who}: list tables`, () => getDocs(paths.tables()));
  await expectAllowed(`${who}: list bills`, () => getDocs(paths.bills()));
}

async function main() {
  // ── 1. CONTROL: a permanent restaurant, no expiresAt anywhere ─────────────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Permanent Palace", "Perm Owner", PERM_OWNER, PASSWORD);
  const permUid = auth.currentUser!.uid;
  const permRid = (await getDoc(paths.userIndex(permUid))).data()!.restaurantId;
  setActiveRestaurantId(permRid);

  const permRoot = await getDoc(paths.restaurantProfile());
  const permUser = await getDoc(paths.user(permUid));
  assert(
    !("expiresAt" in permRoot.data()!),
    "permanent workspace has NO expiresAt field",
  );
  assert(
    !("expiresAt" in permUser.data()!),
    "permanent account has NO expiresAt field",
  );
  await createMenuItem({
    name: "Permanent Dosa",
    categoryId: "mains",
    price: 12000,
    enabled: true,
  });
  await expectAppAccessWorks("permanent owner");
  ok("CONTROL: permanent restaurant fully functional, no expiresAt anywhere");

  // ── 2. A trial workspace with a FUTURE deadline behaves normally ──────────
  await signOut(auth);
  await registerRestaurant("Trial Tavern", "Trial Owner", TRIAL_OWNER, PASSWORD);
  const trialUid = auth.currentUser!.uid;
  const trialRid = (await getDoc(paths.userIndex(trialUid))).data()!.restaurantId;
  setActiveRestaurantId(trialRid);
  const trialCode = (await getDoc(paths.restaurantProfile())).data()!.joinCode!;
  await createMenuItem({
    name: "Trial Biryani",
    categoryId: "mains",
    price: 22000,
    enabled: true,
  });

  await setTenantExpiry(trialRid, daysFromNow(2));
  await setUserExpiry(trialRid, trialUid, daysFromNow(2));
  await expectAppAccessWorks("trial owner (2 days left)");
  ok("trial workspace with a future deadline works normally");

  // ── 3. Client can never write the field ───────────────────────────────────
  await expectDenied("trial owner clearing own workspace expiry", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: deleteField() }),
  );
  await expectDenied("trial owner extending own workspace expiry", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: clientDaysFromNow(3650) }),
  );
  ok("workspace expiresAt cannot be cleared or extended from a client");

  // ...but the ordinary Account → Receipt details save must STILL work on a
  // trial tenant. This is the regression that would bite a real demo: the new
  // expiryUnchanged() guard sits on the same rule.
  await expectAllowed("trial owner saving the receipt header (normal flow)", () =>
    updateDoc(paths.restaurantProfile(), {
      name: "Trial Tavern Renamed",
      addressLine: "Demo Street",
      updatedAt: serverTimestamp(),
    }),
  );
  const rootAfterSave = await getDoc(paths.restaurantProfile());
  assert(
    rootAfterSave.data()!.expiresAt !== undefined,
    "workspace still carries expiresAt after a normal profile save",
  );
  ok("normal receipt-header save still works on a trial tenant, expiry intact");

  // ── 4. Cashier cannot strip a staff member's expiry ───────────────────────
  await signOut(auth);
  await joinRestaurant(trialCode, "Trial Waiter", TRIAL_WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;
  await signInWithEmailAndPassword(auth, TRIAL_OWNER, PASSWORD);
  setActiveRestaurantId(trialRid);
  await approveStaff(waiterUid);
  await setUserExpiry(trialRid, waiterUid, daysFromNow(2));

  // THE SCENARIO: a trial cashier keeping one seat past the deadline.
  await expectDenied("cashier clearing the waiter's expiry", () =>
    updateDoc(paths.user(waiterUid), { expiresAt: deleteField() }),
  );
  await expectDenied("cashier extending the waiter's expiry", () =>
    updateDoc(paths.user(waiterUid), { expiresAt: clientDaysFromNow(3650) }),
  );
  // ...but the ordinary staff flow must still work, expiry untouched.
  await expectAllowed("cashier restricting the waiter (normal flow)", () =>
    setStaffActive(waiterUid, false),
  );
  await expectAllowed("cashier re-enabling the waiter", () =>
    setStaffActive(waiterUid, true),
  );
  const waiterAfter = await adminDb
    .doc(`restaurants/${trialRid}/users/${waiterUid}`)
    .get();
  assert(
    waiterAfter.data()!.expiresAt !== undefined,
    "waiter still carries expiresAt after the approve/restrict flow",
  );
  ok("cashier cannot clear or extend a staff expiry; normal flow unaffected");

  // ── 5. Past the deadline via the TENANT field ─────────────────────────────
  await setTenantExpiry(trialRid, daysFromNow(-1));
  await setUserExpiry(trialRid, trialUid, daysFromNow(30)); // account still fine
  await expectAppAccessDenied("expired workspace (owner)");
  ok("expired WORKSPACE locks the whole tenant out, account expiry aside");

  // ── 6. ...and the account can still see enough for a friendly screen ──────
  await expectAllowed("expired owner reading own profile", () =>
    getDoc(paths.user(trialUid)),
  );
  await expectAllowed("expired owner reading own userIndex", () =>
    getDoc(paths.userIndex(trialUid)),
  );
  await expectAllowed("expired owner reading restaurant root doc", () =>
    getDoc(paths.restaurantProfile()),
  );
  ok("expired account still reads its own profile — 'trial ended' screen works");

  // ── 7. Past the deadline via the per-ACCOUNT field, independently ─────────
  await setTenantExpiry(trialRid, daysFromNow(30)); // workspace fine again
  await setUserExpiry(trialRid, trialUid, daysFromNow(-1));
  await expectAppAccessDenied("expired account (healthy workspace)");
  await expectAllowed("expired account still reads own profile", () =>
    getDoc(paths.user(trialUid)),
  );
  ok("expired ACCOUNT is locked out independently of the workspace");

  // ── 8. A fresh signup inside an expired workspace is still locked ─────────
  await setTenantExpiry(trialRid, daysFromNow(-1));
  await signOut(auth);
  await joinRestaurant(trialCode, "Late Joiner", LATE_JOINER, PASSWORD, "waiter");
  const lateUid = auth.currentUser!.uid;
  const lateDoc = await adminDb
    .doc(`restaurants/${trialRid}/users/${lateUid}`)
    .get();
  assert(
    lateDoc.data()!.expiresAt === undefined,
    "late joiner's own profile has no expiresAt (nothing to inherit)",
  );
  setActiveRestaurantId(trialRid);
  await expectAppAccessDenied("late joiner in an expired workspace");
  ok("new signup in an expired workspace is blocked by the TENANT field alone");

  // ── 9. CONTROL, re-checked: the permanent restaurant never moved ──────────
  await signOut(auth);
  await signInWithEmailAndPassword(auth, PERM_OWNER, PASSWORD);
  setActiveRestaurantId(permRid);
  const permRootAfter = await getDoc(paths.restaurantProfile());
  const permUserAfter = await getDoc(paths.user(permUid));
  assert(
    !("expiresAt" in permRootAfter.data()!),
    "permanent workspace STILL has no expiresAt",
  );
  assert(
    !("expiresAt" in permUserAfter.data()!),
    "permanent account STILL has no expiresAt",
  );
  await expectAppAccessWorks("permanent owner (final check)");
  await expectAllowed("permanent owner still creates menu items", () =>
    createMenuItem({
      name: "Still Working",
      categoryId: "mains",
      price: 9900,
      enabled: true,
    }),
  );
  ok("CONTROL re-verified: permanent restaurant untouched by the whole suite");

  console.log(
    `\nTRIAL EXPIRY E2E PASS — ${step} checkpoints.\n` +
      `Absent expiresAt = never expires, proven against the real ruleset.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nTRIAL EXPIRY E2E FAIL:", e);
    process.exit(1);
  });
