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
 *     The batch also stamps `needsSetup: true`, which is what sends the new
 *     owner into the first-run wizard; the wizard seeds their starter menu
 *     and floor from the answers and clears the marker.
 *
 *     EVERY new restaurant starts as a 3-day TRIAL: the root profile carries a
 *     server-stamped `trialStartedAt` and the rules reject the batch without
 *     it. Nothing here can opt out — a restaurant becomes permanent only when
 *     the owner activates it later through the Admin SDK. Staff joining via
 *     path B inherit the workspace's clock; they never get one of their own.
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
import { createUserWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getRandomBytes } from "expo-crypto";
import { auth, db } from "@/lib/firebase";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import type { AppUser, RestaurantProfile } from "@/types/models";

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

export async function registerRestaurant(
  restaurantName: string,
  ownerName: string,
  email: string,
  password: string,
): Promise<void> {
  signupInProgress = true;
  const cred = await createUserWithEmailAndPassword(auth, email, password).catch(
    (e) => {
      signupInProgress = false;
      throw e;
    },
  );
  try {
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
        // STARTS THE TRIAL CLOCK. The rules require this to equal request.time,
        // so only the sentinel below can satisfy them — the server picks the
        // value, not this device. Removing this line does not create a
        // permanent restaurant; it makes registration fail outright.
        trialStartedAt:
          serverTimestamp() as unknown as RestaurantProfile["trialStartedAt"],
        updatedAt: serverTimestamp() as unknown as RestaurantProfile["updatedAt"],
      });
      batch.set(paths.bootstrap(), { cashierClaimed: true });
      batch.set(paths.user(cred.user.uid), {
        uid: cred.user.uid,
        name: ownerName,
        email,
        role: "cashier",
        status: "approved",
        active: true,
        createdAt: serverTimestamp() as unknown as AppUser["createdAt"],
      });
      batch.set(paths.restaurantCode(joinCode), { restaurantId });
      batch.set(paths.userIndex(cred.user.uid), { restaurantId });

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
      throw new Error(
        "The server refused to create this restaurant. This is a " +
          "configuration problem on our side, not something you did — " +
          "please contact support.",
      );
    }
    throw lastError ?? new Error("Could not create the restaurant. Try again.");
  } catch (e) {
    await rollbackAuthUser();
    throw e;
  } finally {
    signupInProgress = false;
  }
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
    throw new Error("Enter the restaurant's join code (ask your manager).");
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
      throw new Error(
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
    await rollbackAuthUser();
    throw e;
  } finally {
    signupInProgress = false;
  }
}

/** Remove the half-created login so the email can retry cleanly. */
async function rollbackAuthUser(): Promise<void> {
  try {
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
