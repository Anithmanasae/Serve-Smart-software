/**
 * Self-service onboarding (see AuthContext for the surrounding state).
 *
 * Two paths, both ATOMIC batches so the security rules can tie the writes
 * together with getAfter — none of the docs can be created alone:
 *
 *  A) registerRestaurant — a brand-new owner. One batch creates the
 *     restaurant root profile (+ join code), meta/bootstrap (cashier seat
 *     claimed), the owner's approved+active CASHIER profile, the
 *     restaurantCodes/{code} lookup, and userIndex/{uid}.
 *
 *     `registerRestaurantWithGoogle` is the SAME path with a different front
 *     door: Google supplies the account instead of an email and a password,
 *     and `commitOwnerRegistration` — the batch itself — is shared verbatim.
 *     That sharing is the point. The batch is what the security rules verify
 *     with getAfter, and a second copy of it would be a second thing to keep
 *     in step with `isOwnerRegistrationBatch`. Firestore has no opinion about
 *     how the auth user was minted, so nothing in `firestore.rules` changed
 *     for Google at all.
 *
 *     The batch also stamps `needsSetup: true`, which is what sends the new
 *     owner into the first-run wizard; the wizard seeds their starter menu
 *     and floor from the answers and clears the marker.
 *
 *     A new restaurant is born ONE OF TWO WAYS (`RegistrationOptions`):
 *     permanent, with no expiry field at all, or AWAITING ITS FIRST
 *     SUBSCRIPTION, carrying the epoch-0 sentinel that locks it until the
 *     owner starts Google's free trial at the paywall. The caller decides
 *     which — a build that cannot sell must not lock anyone behind a paywall
 *     with nothing on it. The app runs no trial clock of its own either way:
 *     the old server-stamped `trialStartedAt` is gone and the rules reject it.
 *     Staff joining via path B inherit the workspace's deadline; they never
 *     carry one of their own.
 *
 *  B) joinRestaurant — staff with a join code. Resolves
 *     restaurantCodes/{code} → restaurantId, then one batch creates the
 *     pending+inactive waiter/kitchen profile (carrying the entered join code
 *     so the rules can verify it) and userIndex/{uid}. The restaurant's
 *     cashier approves them afterwards (existing flow, unchanged).
 *
 * While a signup batch is in flight the brand-new Firebase Auth user has no
 * userIndex doc yet; AuthContext checks isSignupInProgress() so it waits for
 * the batch instead of bouncing the half-created account.
 */
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  signInWithCredential,
  signOut as fbSignOut,
} from "firebase/auth";
import {
  getDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { getRandomBytes } from "expo-crypto";
import { auth, db } from "@/lib/firebase";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import { AuthMessageError } from "@/features/auth/authErrors";
import type { AppUser, RestaurantProfile } from "@/types/models";

/**
 * What a completed Google account pick hands down to `registerRestaurant-
 * WithGoogle`. Structurally identical to `GoogleAccount` in
 * `src/lib/googleAuth.ts` and deliberately re-declared rather than imported:
 * that module reaches `react-native` and this one must stay runnable in plain
 * Node for the e2e suites. See the note on the function below.
 */
export interface GoogleSignup {
  idToken: string;
  email: string;
  /** Google's display name. May be empty — handled at the call below. */
  name: string;
}

/**
 * `expiresAt` on a restaurant that has NEVER had a subscription.
 *
 * Epoch 0 — a sentinel, not a deadline. It is the only value `firestore.rules`
 * lets a client write into that field, and only at registration: the one date
 * that grants nothing. The billing function replaces it with a real
 * paid-through date the moment a purchase verifies. Reading it back is how the
 * app tells "has not subscribed yet" from "subscription lapsed" without a
 * second field to drift out of step with the first.
 */
export const AWAITING_SUBSCRIPTION_MS = 0;

export interface RegistrationOptions {
  /**
   * Born locked, to be opened by a Google Play subscription.
   *
   * Pass true ONLY from a build that can actually sell one
   * (`isBillingAvailable()`); the paywall is the only way out of this state,
   * so a restaurant put into it by a build without billing is stranded.
   * Omitted — which is what every e2e suite does — the restaurant is
   * permanent, exactly as before the paywall existed.
   */
  awaitSubscription?: boolean;
}

/** Roles a person may pick when JOINING an existing restaurant. The cashier
 *  (owner) seat is only created through registerRestaurant. */
export type SignupRole = "waiter" | "kitchen";

// ── signup-in-progress flag (read by AuthContext) ────────────────────────────

let signupInProgress = false;

/** True while a signup batch is between auth-user creation and Firestore
 *  commit — the window where userIndex/{uid} legitimately doesn't exist. */
export function isSignupInProgress(): boolean {
  return signupInProgress;
}

// ── id / code generation ─────────────────────────────────────────────────────

/** Unambiguous uppercase alphabet — no 0/O, 1/I/L lookalikes. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = getRandomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** "Anna's Kitchen & Bar" → "annas-kitchen-bar" (≤ 24 chars). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "restaurant";
}

/** Normalize what the user typed as a join code: uppercase, drop spaces and
 *  hyphens. (Codes are minted from CODE_ALPHABET, so 0/O/1/I/L never occur.) */
export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

// ── path A: brand-new restaurant ─────────────────────────────────────────────

/**
 * `phone` is the owner's mobile in E.164 (`+919876543210`), and it is
 * OPTIONAL here while being REQUIRED on the signup screen. The screen is where
 * a human is asked a question and can be told the number is wrong; this
 * function is also called by the e2e suites, which register throwaway
 * restaurants and have no phone to give. An empty value writes NO KEY at all
 * rather than an empty string — absent means "never collected", and a stored
 * "" would look like a number someone tried and failed to enter.
 */
export async function registerRestaurant(
  restaurantName: string,
  ownerName: string,
  email: string,
  password: string,
  phone?: string,
  options?: RegistrationOptions,
): Promise<void> {
  signupInProgress = true;
  const cred = await createUserWithEmailAndPassword(auth, email, password).catch(
    (e) => {
      signupInProgress = false;
      throw e;
    },
  );
  try {
    await commitOwnerRegistration(
      cred.user.uid,
      restaurantName,
      ownerName,
      email,
      phone,
      options,
    );
  } catch (e) {
    // The login was created by THIS call and owns nothing — delete it so the
    // email is free to try again.
    await rollbackAuthUser(true);
    throw e;
  } finally {
    signupInProgress = false;
  }
}

// ── path A′: the same restaurant, opened with a Google account ───────────────

/**
 * Register a restaurant for a Google account that has ALREADY been picked.
 *
 * The account picker itself is deliberately NOT called from here. It is a
 * native module, and this file is imported by the e2e suites, which run under
 * plain Node — one `import "react-native"` at the top of anything on this path
 * takes every suite down at parse time, including the four that guard the
 * money path. So `AuthContext` owns the picker and hands the result down; this
 * file stays pure Firebase and keeps running in Node.
 *
 * Cancelling therefore never reaches here: `AuthContext` returns before
 * calling this when nobody was picked.
 *
 * The load-bearing decisions:
 *
 * - **The restaurant name is still asked for, and is still the caller's
 *   job.** Google supplies a person, not a business; there is no field on a
 *   Google profile that could stand in for "Anna's Kitchen". The signup
 *   screen therefore collects it BEFORE launching the picker, so nobody
 *   authenticates and is then told the form was incomplete.
 * - **`signupInProgress` goes up BEFORE `signInWithCredential`, not after.**
 *   `onAuthStateChanged` fires the instant the credential lands, and a
 *   brand-new Google account has no `userIndex` doc yet — without the flag
 *   AuthContext reaches "this account isn't linked to any restaurant" and
 *   signs the owner out in the middle of registering. The email path gets
 *   away with setting it around `createUserWithEmailAndPassword` for the same
 *   reason it needs it at all; this one just has a wider window.
 * - **An account that ALREADY has a restaurant is signed in, not given a
 *   second one.** Unlike an email address, a Google account is a button
 *   press away on the wrong screen: an owner who taps Continue with Google on
 *   /signup instead of /login must land in the restaurant they already have,
 *   not open a duplicate one that then holds their join code and their menu
 *   hostage. `userIndex/{uid}` is the check, and it is exactly what
 *   AuthContext is about to read anyway.
 * - **Rollback DELETES only an account this call created.** `isNewUser` is
 *   the whole difference. Deleting an existing Google login because our
 *   Firestore batch failed would take out an account the person uses
 *   elsewhere in Google's eyes; signing it out is enough.
 */
export async function registerRestaurantWithGoogle(
  account: GoogleSignup,
  restaurantName: string,
  phone?: string,
  options?: RegistrationOptions,
): Promise<void> {
  signupInProgress = true;
  let uid: string;
  let isNewAccount: boolean;
  try {
    const cred = await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(account.idToken),
    );
    uid = cred.user.uid;
    isNewAccount = getAdditionalUserInfo(cred)?.isNewUser === true;
  } catch (e) {
    signupInProgress = false;
    throw e;
  }

  try {
    if (!isNewAccount) {
      // Already known to Firebase — do they already belong somewhere?
      const idx = await getDoc(paths.userIndex(uid));
      if (idx.exists()) return; // AuthContext resolves it from here
    }
    await commitOwnerRegistration(
      uid,
      restaurantName,
      // Google's display name is optional and can come back empty. The rules
      // require a non-empty name, and "" would also leave the staff list and
      // every receipt naming nobody — so fall back to the address they just
      // signed in with, which is at least true.
      account.name.trim() || account.email,
      account.email,
      phone,
      options,
    );
  } catch (e) {
    await rollbackAuthUser(isNewAccount);
    throw e;
  } finally {
    signupInProgress = false;
  }
}

/**
 * THE REGISTRATION BATCH — shared by both front doors.
 *
 * The caller has already produced a signed-in Firebase user by whatever means;
 * everything from here down is identical, and deliberately so. This is the
 * shape `isOwnerRegistrationBatch()` in firestore.rules verifies with
 * getAfter, and a second copy of it is a second thing to keep in step with the
 * rules.
 *
 * Throws on failure and leaves the auth user alone — unwinding that is the
 * caller's decision, because only the caller knows whether it created the
 * account (see `rollbackAuthUser`).
 */
async function commitOwnerRegistration(
  uid: string,
  restaurantName: string,
  ownerName: string,
  email: string,
  phone?: string,
  options?: RegistrationOptions,
): Promise<void> {
  // Retry with a fresh suffix/code on the (rare) id or code collision —
  // the rules reject the batch if either doc already exists.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const restaurantId = `${slugify(restaurantName)}-${randomCode(6).toLowerCase()}`;
    const joinCode = randomCode(6);

    // Cheap pre-check (any signed-in user may `get` a code doc); the rules
    // still enforce uniqueness atomically if two owners race.
    const taken = await getDoc(paths.restaurantCode(joinCode));
    if (taken.exists()) continue;

    setActiveRestaurantId(restaurantId);
    const batch = writeBatch(db);
    batch.set(paths.restaurantProfile(), {
      name: restaurantName.trim(),
      gstEnabled: true,
      joinCode,
      // FIRST-RUN SETUP IS PENDING. The (app) layout routes the owner to
      // /setup while this is true, and the wizard deletes it when it
      // finishes — so an interrupted setup resumes instead of leaving a
      // restaurant half-configured.
      //
      // The marker is written HERE, at registration, rather than inferred
      // from "this restaurant has no config fields yet". Every restaurant
      // that predates the wizard also has no config fields, so inferring it
      // would have shown the wizard to the whole existing customer base on
      // their next launch. Only restaurants created by a build that has the
      // wizard can ever be sent to it.
      needsSetup: true,
      // NO TRIAL CLOCK OF OURS. This used to stamp `trialStartedAt:
      // serverTimestamp()` and the deadline was computed from it. The rules
      // now reject that field, so adding it back breaks registration outright
      // rather than quietly reviving the clock. The free trial is Google's.
      //
      // What is written instead is either NOTHING — a permanent restaurant —
      // or the epoch-0 sentinel, which locks it until the owner subscribes.
      // A spread, so the permanent case writes no key at all: absence is what
      // "never expires" means, and `expiresAt: undefined` would throw.
      ...(options?.awaitSubscription
        ? {
            expiresAt: Timestamp.fromMillis(
              AWAITING_SUBSCRIPTION_MS,
            ) as unknown as RestaurantProfile["expiresAt"],
          }
        : {}),
      updatedAt: serverTimestamp() as unknown as RestaurantProfile["updatedAt"],
    });
    batch.set(paths.bootstrap(), { cashierClaimed: true });
    batch.set(paths.user(uid), {
      uid,
      name: ownerName,
      email,
      role: "cashier",
      status: "approved",
      active: true,
      // Spread, not `phone: phone ?? undefined` — an explicit `undefined`
      // makes the client SDK throw on commit, and writing "" instead would
      // store a number nobody entered. No key at all is the honest record.
      ...(phone ? { phone } : {}),
      createdAt: serverTimestamp() as unknown as AppUser["createdAt"],
    });
    batch.set(paths.restaurantCode(joinCode), { restaurantId });
    batch.set(paths.userIndex(uid), { restaurantId });

    try {
      await batch.commit();
    } catch (e) {
      setActiveRestaurantId(null);
      lastError = e;
      const code = (e as { code?: string })?.code;
      // LOUD, because this is the failure that has no other symptom.
      //
      // A denied batch here leaves a signed-in Firebase user with no
      // userIndex and no profile, and `rollbackAuthUser` below then deletes
      // the account — so by the time anything is visible on screen, every
      // trace of WHY is gone and the owner is looking at a login screen
      // saying they aren't linked to a restaurant. The rules are proven
      // against this exact call by `scripts/e2e/trialExpiry.e2e.ts`, which
      // means a denial in the wild is environmental (rules not deployed,
      // App Check, a production-only evaluation limit) — and none of those
      // are diagnosable without the code and message printed here.
      console.warn(
        `[signup] registration batch failed (attempt ${attempt + 1}/3) ` +
          `rid="${restaurantId}" code="${code ?? "?"}": ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      // permission-denied can mean an id/code collision — try a new pair.
      if (code === "permission-denied") continue;
      throw e;
    }

    // The restaurant now EXISTS.
    //
    // NOTHING IS SEEDED HERE ANY MORE. The starter menu and floor used to be
    // written at this point, one size for everyone — which handed a food
    // truck eight tables to delete and a cafe a tandoori menu. Seeding now
    // happens at the END of the setup wizard, from the answers, so what
    // lands is a starter menu for the kind of place this actually is. See
    // `completeSetup` in features/onboarding/onboardingApi.
    return; // success — AuthContext picks up userIndex and proceeds
  }
  // Three denials in a row is not an id collision. Say so, rather than
  // re-throwing a Firestore error the signup screen will render as a
  // generic "something went wrong" — the owner then retries forever against
  // a server that is never going to accept them.
  if ((lastError as { code?: string })?.code === "permission-denied") {
    throw new AuthMessageError(
      "The server refused to create this restaurant. This is a " +
        "configuration problem on our side, not something you did — " +
        "please contact support.",
    );
  }
  throw lastError ?? new Error("Could not create the restaurant. Try again.");
}

// ── path B: join an existing restaurant ──────────────────────────────────────

export async function joinRestaurant(
  joinCodeRaw: string,
  name: string,
  email: string,
  password: string,
  role: SignupRole,
): Promise<void> {
  const joinCode = normalizeJoinCode(joinCodeRaw);
  if (joinCode.length < 4) {
    throw new AuthMessageError("Enter the restaurant's join code (ask your manager).");
  }

  signupInProgress = true;
  const cred = await createUserWithEmailAndPassword(auth, email, password).catch(
    (e) => {
      signupInProgress = false;
      throw e;
    },
  );
  try {
    // Resolving a code requires being signed in (rules), hence after
    // account creation — an unknown code rolls the half-made login back.
    const codeSnap = await getDoc(paths.restaurantCode(joinCode));
    if (!codeSnap.exists()) {
      throw new AuthMessageError(
        "No restaurant found for that join code. Check it with your manager and try again.",
      );
    }
    const restaurantId = codeSnap.data().restaurantId;
    setActiveRestaurantId(restaurantId);

    const batch = writeBatch(db);
    batch.set(paths.user(cred.user.uid), {
      uid: cred.user.uid,
      name,
      email,
      role,
      status: "pending",
      active: false,
      joinCode,
      createdAt: serverTimestamp() as unknown as AppUser["createdAt"],
    });
    batch.set(paths.userIndex(cred.user.uid), { restaurantId });
    try {
      await batch.commit();
    } catch (e) {
      setActiveRestaurantId(null);
      throw e;
    }
  } catch (e) {
    await rollbackAuthUser(true);
    throw e;
  } finally {
    signupInProgress = false;
  }
}

/**
 * Unwind a signup that got as far as authenticating and no further.
 *
 * `deleteAccount` is only true when THIS call minted the login — an
 * email/password signup, or a Google account Firebase had never seen. Such an
 * account owns nothing, and deleting it is what frees the email address to try
 * again instead of hitting `auth/email-already-in-use` forever.
 *
 * It is false for a Google account that already existed. That login is the
 * person's own, may be signed into other things, and did not become ours
 * because our Firestore batch failed — signing out is the whole of the cleanup
 * it deserves.
 */
async function rollbackAuthUser(deleteAccount: boolean): Promise<void> {
  try {
    if (!deleteAccount) {
      await fbSignOut(auth);
      return;
    }
    await auth.currentUser?.delete();
  } catch {
    // Best effort — at minimum sign out so AuthContext doesn't bounce around
    // with an account that has no restaurant.
    try {
      await fbSignOut(auth);
    } catch {
      /* ignore */
    }
  }
}
