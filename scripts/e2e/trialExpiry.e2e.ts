/**
 * EXPIRY SUITE — the proof that the expiry rules do what they claim, and (far
 * more importantly) that they do NOTHING to an ordinary restaurant.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
 *
 * The model under test — THE APP RUNS NO TRIAL CLOCK OF ITS OWN:
 *   - A new restaurant is born one of two ways. PERMANENT, carrying neither
 *     `trialStartedAt` nor `expiresAt`; or AWAITING A SUBSCRIPTION, carrying
 *     `expiresAt` = epoch 0, which locks it until the Play Billing function
 *     writes a real date. Epoch 0 is the only value the create rule accepts,
 *     so no client build can hand itself a second of access.
 *   - `expiresAt` is the ONLY deadline, and every real date in it is Admin
 *     SDK only (the Play Billing functions, or scripts/activateTenant.js).
 *   - ACTIVATION = deleting it. No expiresAt = permanent.
 *   - `trialStartedAt` is a DEAD field. Old restaurants still carry it and it
 *     must have NO effect whatsoever.
 *
 * What it proves:
 *   1. A fresh registration is permanent, carries no expiry field, and works.
 *   2. Registration is rejected if it tries to carry EITHER field — including a
 *      server-stamped `trialStartedAt`, which used to be mandatory. (The same
 *      raw batch with neither field is accepted, so the denials are about the
 *      fields and not a malformed batch.)
 *   3. THE RETROACTIVE GUARANTEE: a restaurant carrying a wildly backdated
 *      `trialStartedAt` — i.e. every customer who registered under the old
 *      build — still works completely. If this ever fails, removing the trial
 *      silently locked out the existing customer base.
 *   4. No client can add, clear or change either field.
 *   5. Past an explicit `expiresAt` every app read/write dies server-side, for
 *      the owner AND for join-code staff who carry no expiry of their own.
 *   6. A locked-out account can still read its own profile, its userIndex and
 *      the restaurant root doc, so the app can explain itself rather than
 *      showing a wall of permission errors.
 *   7. A cashier cannot strip a staff member's expiry — but CAN still run the
 *      normal approve/restrict flow.
 *   8. CONTROL: after activation the restaurant is fully functional and carries
 *      no expiry fields at all. If this ever fails, reactivating a customer
 *      would not actually let them back in.
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
    "Refusing to run: this suite stamps expiry dates and must run against " +
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
const SUBSCRIBER = `paywall-owner-${stamp}@sada-pos.test`;

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

/** Plant (or clear) the DEAD `trialStartedAt` stamp, exactly as a restaurant
 *  registered under the old build carries it. Used to prove it does nothing. */
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

/** WHAT THE ACTIVATION SCRIPT DOES: delete the deadline. Nothing else.
 *  (It clears the dead stamp too, purely so the doc reads honestly.) */
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
 * The owner-registration batch, built by hand so the expiry fields can be
 * varied. Mirrors signupApi.registerRestaurant exactly — the rules tie all five
 * docs together with getAfter, so anything less than the full batch is denied
 * for reasons that have nothing to do with expiry.
 *
 * `trialStartedAt: undefined` / `expiresAt: undefined` omit the field entirely,
 * which is what a real registration now sends.
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
  // ── 1. A fresh registration is PERMANENT, with no expiry field at all ─────
  await signOut(auth).catch(() => {});
  await registerRestaurant("Trial Tavern", "Trial Owner", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  const rid = (await getDoc(paths.userIndex(ownerUid))).data()!.restaurantId;
  setActiveRestaurantId(rid);

  const root = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    !("trialStartedAt" in root),
    "a new restaurant carries NO trialStartedAt — there is no free trial",
  );
  assert(
    !("expiresAt" in root),
    "a new restaurant carries NO expiresAt (that deadline is Admin-SDK only)",
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
  await expectAppAccessWorks("new owner");
  ok("a new restaurant is born PERMANENT, with neither expiry field, and works");

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
  await expectAppAccessWorks("new waiter");
  ok("join-code staff work immediately, carrying no expiry themselves");

  // ── 3. No client can add or change an expiry field ────────────────────────
  // THE ATTACK, INVERTED. It used to be "a trial cashier activating itself for
  // free". With no trial there is nothing to escape, so what matters now is
  // that a client cannot INVENT a deadline — locking a rival device out, or
  // handing itself a paid-through date the server never sold.
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectDenied("cashier granting itself an expiresAt", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: clientDaysFromNow(3650) }),
  );
  await expectDenied("cashier planting a trialStartedAt stamp", () =>
    updateDoc(paths.restaurantProfile(), {
      trialStartedAt: clientDaysFromNow(0),
    }),
  );
  ok("a cashier cannot invent a deadline, nor plant a trial stamp");

  // ...but the ordinary Account → Receipt details save must STILL work. This is
  // the regression that would bite a real customer: expiryUnchanged() sits on
  // the same rule.
  await expectAllowed("owner saving the receipt header (normal flow)", () =>
    updateDoc(paths.restaurantProfile(), {
      name: "Trial Tavern Renamed",
      addressLine: "Demo Street",
      updatedAt: serverTimestamp(),
    }),
  );
  ok("normal receipt-header save still works, with no expiry fields in play");

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
  // Clear it again so step 7 proves the TENANT field alone locks the waiter.
  await setUserExpiry(rid, waiterUid, null);
  ok("cashier cannot clear or extend a staff expiry; normal flow unaffected");

  // ── 5. NEITHER field may be forged AT REGISTRATION ────────────────────────
  await signOut(auth);
  const forger = await createUserWithEmailAndPassword(auth, FORGER, PASSWORD);
  const forgerUid = forger.user.uid;

  // The one that used to be MANDATORY is now refused. This is what stops a
  // stale client build — or a copy-pasted old signup batch — from quietly
  // reviving the trial for everyone who installs it.
  await expectDenied("registering WITH a server-stamped trialStartedAt", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-stamp-${stamp}`,
      joinCode: `FS${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: serverTimestamp(),
    }),
  );
  await expectDenied("registering with a BACKDATED trialStartedAt", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-back-${stamp}`,
      joinCode: `FB${stamp.slice(-4).toUpperCase()}`,
      trialStartedAt: clientDaysFromNow(-3650),
    }),
  );
  await expectDenied("registering with a client-chosen expiresAt", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-exp-${stamp}`,
      joinCode: `FE${stamp.slice(-4).toUpperCase()}`,
      expiresAt: clientDaysFromNow(3650),
    }),
  );
  // The ONE value a client may put in `expiresAt` is the epoch-0 sentinel, so
  // everything near it must still be refused: the server's own clock (the old
  // trial, by another name) and any other date in the past (a client choosing
  // its own lockout date is a client writing dates).
  await expectDenied("registering with expiresAt = the server clock", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-now-${stamp}`,
      joinCode: `FN${stamp.slice(-4).toUpperCase()}`,
      expiresAt: serverTimestamp(),
    }),
  );
  await expectDenied("registering with a past expiresAt that is not epoch 0", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: `forged-past-${stamp}`,
      joinCode: `FP${stamp.slice(-4).toUpperCase()}`,
      expiresAt: clientDaysFromNow(-1),
    }),
  );
  // POSITIVE CONTROL: the identical batch with NEITHER field is accepted, so
  // the five denials above are about the fields — not a malformed batch.
  const forgedRid = `forged-ok-${stamp}`;
  await expectAllowed("the same batch with NEITHER expiry field", () =>
    attemptRegistration({
      uid: forgerUid,
      email: FORGER,
      rid: forgedRid,
      joinCode: `FO${stamp.slice(-4).toUpperCase()}`,
    }),
  );
  ok("registration rejects trialStartedAt and every client-chosen expiresAt; a clean batch passes");

  // ── 5b. BORN AWAITING A SUBSCRIPTION — the paywall's whole mechanism ─────
  // Through the REAL signup path, with the option a billing-capable build
  // passes. The restaurant must come out locked from its first second, stay
  // readable enough to draw the paywall, be impossible for its owner to
  // open by hand, and open the moment the billing function writes a date.
  await signOut(auth);
  await registerRestaurant(
    "Paywall Parlour",
    "Paywall Owner",
    SUBSCRIBER,
    PASSWORD,
    undefined,
    { awaitSubscription: true },
  );
  const subscriberUid = auth.currentUser!.uid;
  const subscriberRid = (
    await adminDb.doc(`userIndex/${subscriberUid}`).get()
  ).data()!.restaurantId as string;
  setActiveRestaurantId(subscriberRid);
  const born = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    (born.expiresAt as unknown as ClientTimestamp | undefined)?.toMillis() === 0,
    "a restaurant born awaiting a subscription carries expiresAt = epoch 0",
  );
  await expectAppAccessDenied("owner who has not subscribed yet");
  ok("AWAITING SUBSCRIPTION: born locked — no app access before paying");

  await expectAllowed("unsubscribed owner reading the restaurant root doc", () =>
    getDoc(paths.restaurantProfile()),
  );
  await expectAllowed("unsubscribed owner reading own profile", () =>
    getDoc(paths.user(subscriberUid)),
  );
  await expectDenied("unsubscribed owner deleting the sentinel", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: deleteField() }),
  );
  await expectDenied("unsubscribed owner granting itself a date", () =>
    updateDoc(paths.restaurantProfile(), { expiresAt: clientDaysFromNow(3650) }),
  );
  ok("the paywall can render, and the owner cannot open the door by hand");

  // What verifyPurchase does when Google confirms the trial has started.
  await setTenantExpiry(subscriberRid, daysFromNow(3));
  await expectAppAccessWorks("owner, three days into Google's free trial");
  await expectAllowed("subscribed owner creates a menu item", () =>
    createMenuItem({
      name: "First Dish",
      categoryId: "mains",
      price: 9000,
      enabled: true,
    }),
  );
  ok("SUBSCRIBED: the billing function's date opens the restaurant");

  // ── 6. THE RETROACTIVE GUARANTEE ─────────────────────────────────────────
  // Every restaurant registered under the old build carries a trialStartedAt,
  // most of them stamped long ago. Nothing may read it. If this checkpoint ever
  // fails, deploying the trial removal locked out the existing customer base —
  // which is the single worst outcome available in this file.
  await signOut(auth);
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await setTrialStart(rid, daysFromNow(-3650));
  await expectAppAccessWorks("owner of a 10-year-old trial stamp");
  await expectAllowed("that owner still creating menu items", () =>
    createMenuItem({
      name: "Legacy Stamp Dosa",
      categoryId: "mains",
      price: 12000,
      enabled: true,
    }),
  );
  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessWorks("their waiter too");
  ok("RETROACTIVE: a decade-old trialStartedAt has NO effect — nothing reads it");

  // ── 7. An explicit expiresAt DOES lock the whole tenant ──────────────────
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await setTenantExpiry(rid, daysFromNow(-1));
  await expectAppAccessDenied("owner, past expiresAt");
  ok("a past expiresAt locks the owner out — the one deadline that still bites");

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessDenied("waiter, past expiresAt");
  ok("join-code staff lock out with the workspace, via the TENANT field alone");

  // ── 8. ...and a locked-out account still sees enough for a friendly screen
  await expectAllowed("locked-out waiter reading own profile", () =>
    getDoc(paths.user(waiterUid)),
  );
  await expectAllowed("locked-out waiter reading own userIndex", () =>
    getDoc(paths.userIndex(waiterUid)),
  );
  await expectAllowed("locked-out waiter reading restaurant root doc", () =>
    getDoc(paths.restaurantProfile()),
  );
  ok("locked-out accounts still read profile + root doc — the notice can render");

  // ── 9. A FUTURE expiresAt is a paid-through date, and works ──────────────
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await setTenantExpiry(rid, daysFromNow(30));
  await expectAppAccessWorks("owner, paid through +30d");
  ok("a future expiresAt is a paid-through date — the workspace works");

  // ── 10. ACTIVATION — delete the deadline. This is the whole product. ─────
  await activate(rid);
  const activated = (await getDoc(paths.restaurantProfile())).data()!;
  assert(
    !("trialStartedAt" in activated) && !("expiresAt" in activated),
    "an activated restaurant carries NEITHER expiry field",
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
  ok("ACTIVATION: deleting expiresAt makes the restaurant permanent again");

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAppAccessWorks("activated waiter");
  ok("activation unblocks EVERY member at once — no per-account step");

  // ── 11. CONTROL: the permanent restaurant is untouched by the expiry rules
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await expectAllowed("permanent owner saving the receipt header", () =>
    updateDoc(paths.restaurantProfile(), {
      name: "Paid Palace",
      updatedAt: serverTimestamp(),
    }),
  );
  await expectAppAccessWorks("permanent owner (final check)");
  ok("CONTROL: no expiresAt = never expires, proven against the real ruleset");

  console.log(
    `\nEXPIRY E2E PASS — ${step} checkpoints.\n` +
      `No trial clock: born permanent or awaiting a subscription (epoch 0),\n` +
      `every other client-written date refused, a legacy trialStartedAt\n` +
      `inert, and expiresAt the only deadline left.\n` +
      `(forged tenant left behind for inspection: ${forgedRid})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nEXPIRY E2E FAIL:", e);
    process.exit(1);
  });
