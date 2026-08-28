/**
 * TRIAL EXPIRY SUITE — the proof that the expiry rules do what they claim, and
 * (far more importantly) that they do NOTHING to a restaurant once it has been
 * activated.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
 *
 * The model under test:
 *   - EVERY new restaurant is born a 3-day trial. `trialStartedAt` is stamped
 *     by the SERVER (the rule demands it equal request.time), the deadline is
 *     COMPUTED as start + 3 days, and nothing is stored for a client to forge.
 *   - `expiresAt` OVERRIDES that computed deadline. Admin SDK only.
 *   - ACTIVATION = deleting both fields. No fields = permanent.
 *
 * What it proves:
 *   1. A fresh registration really is a trial, stamped with the server's clock.
 *   2. No client can clear, change or forge either field — including at
 *      registration, where a backdated or absent stamp is rejected outright.
 *      (The same raw batch WITH a serverTimestamp is accepted, so the denials
 *      are about the timestamp and not a malformed batch.)
 *   3. Past the computed deadline every app read/write dies server-side, for
 *      the owner AND for join-code staff who carry no expiry of their own.
 *   4. An expired account can still read its own profile, its userIndex and the
 *      restaurant root doc, so the app can show "trial ended" rather than a
 *      wall of permission errors.
 *   5. `expiresAt` overrides the computed deadline in BOTH directions.
 *   6. A cashier cannot strip a staff member's expiry — but CAN still run the
 *      normal approve/restrict flow.
 *   7. CONTROL: after activation the restaurant is fully functional and
 *      carries no trial fields at all. If this ever fails, activating a paying
 *      customer would not actually let them back in.
 */
import {
  createUserWithEmailAndPassword,
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
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import adminSdk from "firebase-admin";
import { auth, db } from "./firebase-shim";
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
const OWNER = `trial-owner-${stamp}@sada-pos.test`;
const WAITER = `trial-waiter-${stamp}@sada-pos.test`;
const FORGER = `forger-${stamp}@sada-pos.test`;

/** The trial length in firestore.rules `trialLength()`. Keep in sync. */
const TRIAL_DAYS = 3;

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

// ── Admin-SDK helpers (bypass rules, exactly as the real tooling does) ────────

/** Move the trial's START. Backdating past `trialLength` is how this suite
 *  simulates "two days later" without waiting two days. */
async function setTrialStart(rid: string, value: unknown) {
  await adminDb
    .doc(`restaurants/${rid}`)
    .set(
      { trialStartedAt: value ?? adminSdk.firestore.FieldValue.delete() },
      { merge: true },
    );
}

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

/** WHAT THE ACTIVATION SCRIPT DOES: delete both fields. Nothing else. */
async function activate(rid: string) {
  await adminDb.doc(`restaurants/${rid}`).set(
    {
      trialStartedAt: adminSdk.firestore.FieldValue.delete(),
      expiresAt: adminSdk.firestore.FieldValue.delete(),
    },
    { merge: true },
  );
}

// ── app-surface probes ───────────────────────────────────────────────────────

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

/**
 * The owner-registration batch, built by hand so the trial stamp can be varied.
 * Mirrors signupApi.registerRestaurant exactly — the rules tie all five docs
 * together with getAfter, so anything less than the full batch is denied for
 * reasons that have nothing to do with the trial.
 *
 * `trialStartedAt: undefined` omits the field entirely.
 */
async function attemptRegistration(opts: {
  uid: string;
  email: string;
  rid: string;
  joinCode: string;
  trialStartedAt?: unknown;
  expiresAt?: unknown;
}) {
  setActiveRestaurantId(opts.rid);
  const root: Record<string, unknown> = {
    name: "Forged Restaurant",
    gstEnabled: true,
    joinCode: opts.joinCode,
    updatedAt: serverTimestamp(),
  };
  if (opts.trialStartedAt !== undefined) {
    root.trialStartedAt = opts.trialStartedAt;
  }
  if (opts.expiresAt !== undefined) root.expiresAt = opts.expiresAt;

  const batch = writeBatch(db);
  batch.set(
    paths.restaurantProfile() as unknown as DocumentReference<
      Record<string, unknown>
    >,
    root,
  );
  batch.set(paths.bootstrap(), { cashierClaimed: true });
  batch.set(
    paths.user(opts.uid) as unknown as DocumentReference<
      Record<string, unknown>
    >,
    {
      uid: opts.uid,
      name: "Forger",
      email: opts.email,
      role: "cashier",
      status: "approved",
      active: true,
      createdAt: serverTimestamp(),
    },
  );
  batch.set(paths.restaurantCode(opts.joinCode), { restaurantId: opts.rid });
  batch.set(paths.userIndex(opts.uid), { restaurantId: opts.rid });
  await batch.commit();
}

async function main() {
  // ── 1. A fresh registration IS a trial, stamped with the server's clock ────
  await signOut(auth).catch(() => {});
  const before = Date.now();
  await registerRestaurant("Trial Tavern", "Trial Owner", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  const rid = (await getDoc(paths.userIndex(ownerUid))).data()!.restaurantId;
  setActiveRestaurantId(rid);

  const root = (await getDoc(paths.restaurantProfile())).data()!;
  assert("trialStartedAt" in root, "a new restaurant carries trialStartedAt");
  assert(
    !("expiresAt" in root),
    "a new restaurant carries NO expiresAt (that override is Admin-SDK only)",
  );
  const startedMs = root.trialStartedAt!.toMillis();
  assert(
    startedMs >= before - 60_000 && startedMs <= Date.now() + 60_000,
    `trialStartedAt is the SERVER's now, not an arbitrary value (got ${new Date(startedMs).toISOString()})`,
  );
  const ownerDoc = (await getDoc(paths.user(ownerUid))).data()!;
  assert(
    !("expiresAt" in ownerDoc),
    "the owner's ACCOUNT carries no expiry — the tenant field gates everyone",
  );

  await createMenuItem({
    name: "Trial Biryani",
    categoryId: "mains",
    price: 22000,
    enabled: true,
  });
  await expectAppAccessWorks("trial owner (day 1)");
  ok("a new restaurant is born a trial, stamped by the SERVER clock, and works");

  // ── 2. Join-code staff inherit the workspace — no clock of their own ───────
  const joinCode = root.joinCode!;
  await signOut(auth);
  await joinRestaurant(joinCode, "Trial Waiter", WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await approveStaff(waiterUid);

  const waiterDoc = await adminDb.doc(`restaurants/${rid}/users/${waiterUid}`).get();
  assert(
    waiterDoc.data()!.expiresAt === undefined,
    "a join-code waiter has NO expiry of its own — nothing to inherit",
  );
  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessWorks("trial waiter (day 1)");
  ok("join-code staff work inside a live trial, carrying no expiry themselves");

  // ── 3. No client can clear or change the trial fields ─────────────────────
  // THE ATTACK: a trial cashier activating their own restaurant for free.
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectDenied("cashier DELETING trialStartedAt (self-activation)", () =>
    updateDoc(paths.restaurantProfile(), { trialStartedAt: deleteField() }),
  );
  await expectDenied("cashier backdating trialStartedAt", () =>
    updateDoc(paths.restaurantProfile(), {
      trialStartedAt: clientDaysFromNow(3650),
    }),
  );
  await expectDenied("cashier granting itself an expiresAt override", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: clientDaysFromNow(3650) }),
  );
  ok("a cashier cannot activate, extend or re-time its own trial");

  // ...but the ordinary Account → Receipt details save must STILL work. This is
  // the regression that would bite a real demo: expiryUnchanged() sits on the
  // same rule.
  await expectAllowed("trial owner saving the receipt header (normal flow)", () =>
    updateDoc(paths.restaurantProfile(), {
      name: "Trial Tavern Renamed",
      addressLine: "Demo Street",
      updatedAt: serverTimestamp(),
    }),
  );
  const afterSave = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    afterSave.trialStartedAt !== undefined,
    "workspace still carries trialStartedAt after a normal profile save",
  );
  ok("normal receipt-header save still works on a trial tenant, stamp intact");

  // ── 4. A cashier cannot strip a staff member's expiry ─────────────────────
  await setUserExpiry(rid, waiterUid, daysFromNow(2));
  await expectDenied("cashier clearing the waiter's expiry", () =>
    updateDoc(paths.user(waiterUid), { expiresAt: deleteField() }),
  );
  await expectDenied("cashier extending the waiter's expiry", () =>
    updateDoc(paths.user(waiterUid), { expiresAt: clientDaysFromNow(3650) }),
  );
  await expectAllowed("cashier restricting the waiter (normal flow)", () =>
    setStaffActive(waiterUid, false),
  );
  await expectAllowed("cashier re-enabling the waiter", () =>
    setStaffActive(waiterUid, true),
  );
  const waiterAfter = await adminDb
    .doc(`restaurants/${rid}/users/${waiterUid}`)
    .get();
  assert(
    waiterAfter.data()!.expiresAt !== undefined,
    "waiter still carries expiresAt after the approve/restrict flow",
  );
  // Clear it again so step 6 proves the TENANT field alone locks the waiter.
  await setUserExpiry(rid, waiterUid, null);
  ok("cashier cannot clear or extend a staff expiry; normal flow unaffected");

  // ── 5. The stamp cannot be forged AT REGISTRATION ─────────────────────────
  await signOut(auth);
  const forger = await createUserWithEmailAndPassword(auth, FORGER, PASSWORD);
  const forgerUid = forger.user.uid;

  await expectDenied("registering with a BACKDATED trialStartedAt", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-back-${stamp}`,
      joinCode: `FB${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: clientDaysFromNow(-3650),
    }),
  );
  await expectDenied("registering with a FUTURE trialStartedAt", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-fwd-${stamp}`,
      joinCode: `FF${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: clientDaysFromNow(3650),
    }),
  );
  await expectDenied("registering with NO trialStartedAt at all", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-none-${stamp}`,
      joinCode: `FN${stamp.slice(-4).toUpperCase()}`,
    }),
  );
  await expectDenied("registering with a client-chosen expiresAt override", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-exp-${stamp}`,
      joinCode: `FE${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: serverTimestamp(),
      expiresAt: clientDaysFromNow(3650),
    }),
  );
  // POSITIVE CONTROL: the identical batch with a serverTimestamp is accepted,
  // so the four denials above are about the stamp — not a malformed batch.
  const forgedRid = `forged-ok-${stamp}`;
  await expectAllowed("the same batch WITH a serverTimestamp stamp", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: forgedRid,
      joinCode: `FO${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: serverTimestamp(),
    }),
  );
  ok("registration rejects a backdated, future, absent or overridden stamp");

  // ── 6. Past the computed deadline, the whole tenant dies ──────────────────
  await signOut(auth);
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await setTrialStart(rid, daysFromNow(-(TRIAL_DAYS + 1)));
  await expectAppAccessDenied("owner, trial elapsed");
  ok(`computed deadline: ${TRIAL_DAYS} days after the stamp, the owner is locked out`);

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessDenied("waiter, trial elapsed");
  ok("join-code staff lock out with the workspace, via the TENANT field alone");

  // ── 7. ...and an expired account can still see enough for a friendly screen
  await expectAllowed("expired waiter reading own profile", () =>
    getDoc(paths.user(waiterUid)),
  );
  await expectAllowed("expired waiter reading own userIndex", () =>
    getDoc(paths.userIndex(waiterUid)),
  );
  await expectAllowed("expired waiter reading restaurant root doc", () =>
    getDoc(paths.restaurantProfile()),
  );
  ok("expired accounts still read profile + root doc — 'trial ended' screen works");

  // ── 8. expiresAt OVERRIDES the computed deadline, both directions ─────────
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await setTenantExpiry(rid, daysFromNow(30)); // trial still backdated
  await expectAppAccessWorks("owner, elapsed trial but future expiresAt");
  ok("a future expiresAt overrides an elapsed trial (paid-through date)");

  await setTrialStart(rid, daysFromNow(0)); // fresh trial…
  await setTenantExpiry(rid, daysFromNow(-1)); // …but an expired override
  await expectAppAccessDenied("owner, fresh trial but past expiresAt");
  ok("a past expiresAt overrides a healthy trial (instant lockout)");

  // ── 9. ACTIVATION — delete both fields. This is the whole product. ────────
  await activate(rid);
  const activated = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    !("trialStartedAt" in activated) && !("expiresAt" in activated),
    "an activated restaurant carries NEITHER trial field",
  );
  await expectAppAccessWorks("activated owner");
  await expectAllowed("activated owner creates menu items", () =>
    createMenuItem({
      name: "Paid Customer Dosa",
      categoryId: "mains",
      price: 12000,
      enabled: true,
    }),
  );
  ok("ACTIVATION: deleting both fields makes the restaurant permanent");

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessWorks("activated waiter");
  ok("activation unblocks EVERY member at once — no per-account step");

  // ── 10. CONTROL: the permanent restaurant is untouched by the expiry rules
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  const finalRoot = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    !("trialStartedAt" in finalRoot) && !("expiresAt" in finalRoot),
    "permanent workspace STILL has no trial fields",
  );
  await expectAllowed("permanent owner saving the receipt header", () =>
    updateDoc(paths.restaurantProfile(), {
      name: "Paid Palace",
      updatedAt: serverTimestamp(),
    }),
  );
  await expectAppAccessWorks("permanent owner (final check)");
  ok("CONTROL: no trial fields = never expires, proven against the real ruleset");

  console.log(
    `\nTRIAL EXPIRY E2E PASS — ${step} checkpoints.\n` +
      `Server-stamped start, computed deadline, activation by deletion.\n` +
      `(forged tenant left behind for inspection: ${forgedRid})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nTRIAL EXPIRY E2E FAIL:", e);
    process.exit(1);
  });
