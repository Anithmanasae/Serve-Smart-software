/**
 * Authentication + role context.
 *
 * MULTI-TENANT RESOLUTION: after Firebase sign-in the FIRST read is
 * userIndex/{uid} → restaurantId. Only once that is known does the profile
 * listener attach to restaurants/{rid}/users/{uid} — no app query can fire
 * against the wrong (or no) restaurant. An account with no userIndex entry is
 * signed out with a clear message ("not linked to a restaurant"); the only
 * exceptions are a signup batch still in flight (isSignupInProgress) and the
 * __DEV__ env-RESTAURANT_ID fallback for pre-migration logins.
 *
 * The user's ROLE is the authorization boundary for the whole app. It is read
 * from the user's Firestore profile (restaurants/{rid}/users/{uid}). Firestore
 * Security Rules independently re-check this role server-side on every write —
 * the client context is for UX/routing only and is NOT the security boundary.
 *
 * The profile doc is watched LIVE (onSnapshot): the moment the cashier
 * approves, restricts, or removes a staff member, that phone reacts instantly
 * — no app restart needed. `profile` is only non-null for a usable account
 * (approved + active); every other signed-in state is described by `gate`.
 *
 * TRIAL EXPIRY: the deadline is resolved from TWO documents, and the earlier of
 * them wins:
 *
 *   the RESTAURANT   restaurants/{rid}   trialStartedAt (+2d) or expiresAt
 *   the ACCOUNT      users/{uid}         expiresAt
 *
 * The restaurant doc is the important one. Every new restaurant is born a
 * 3-day trial and its whole staff is gated by that single field — a waiter who
 * joined with a join code carries no expiry of their own, so reading only the
 * user profile would leave them looking fine on the client while every query
 * failed server-side. Both docs are watched live, and the root doc stays
 * readable after expiry (rules: `isMember()`, no expiry check) precisely so
 * this screen can explain itself.
 *
 * Because expiry is a clock event rather than a write, no snapshot fires at the
 * deadline — a timer does the work (see the expiry effect below), flipping
 * `gate` to "expired". A restaurant with NO trial fields never expires; that is
 * what activating a paying customer produces.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { AppState } from "react-native";
import { getDoc, onSnapshot } from "firebase/firestore";
import { auth, RESTAURANT_ID } from "@/lib/firebase";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";
import {
  isSignupInProgress,
  joinRestaurant,
  registerRestaurant,
  type SignupRole,
} from "@/features/auth/signupApi";
import {
  resolveRestaurantConfig,
  type RestaurantConfig,
} from "@/features/settings/restaurantConfig";
import type { AppUser, RestaurantProfile, Role } from "@/types/models";

export type { SignupRole };

/** Trial length. MUST match `trialLength()` in firestore.rules — the rules are
 *  what actually enforce it; this only drives the countdown and the screen. */
const TRIAL_DAYS = 3;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

const NOT_LINKED_MESSAGE =
  "This account isn't linked to any restaurant. Sign up again with your " +
  "restaurant's join code, or contact support.";

const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended. Thanks for trying Smart Serve — get in touch to " +
  "activate your restaurant and keep everything you've set up.";

/** setTimeout stores its delay in a signed 32-bit int; anything larger
 *  overflows and fires IMMEDIATELY. Re-arm in chunks no bigger than this. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * How long sign-in may spend unresolved before the app gives up and shows the
 * login screen.
 *
 * Generous — it covers a cold start on a restaurant's wifi plus a signup batch
 * committing — but finite, because the alternative to giving up is the splash
 * screen forever. See `armResolveTimer`.
 */
const AUTH_RESOLVE_TIMEOUT_MS = 20_000;

/** Dev-build fallback tenant for logins that predate userIndex (migration). */
function devFallbackRestaurantId(): string | null {
  return typeof __DEV__ !== "undefined" && __DEV__ ? RESTAURANT_ID : null;
}

/**
 * Why a signed-in user is NOT allowed into the app:
 *  - pending    signup awaiting the cashier's approval
 *  - denied     cashier rejected the signup
 *  - restricted approved account switched off for now (day off / suspended)
 *  - removed    profile deleted — account permanently revoked
 *  - expired    time-limited trial account whose deadline has passed
 * null when signed out or fully usable.
 */
export type GateStatus =
  | "pending"
  | "denied"
  | "restricted"
  | "removed"
  | "expired"
  | null;

interface AuthState {
  firebaseUser: User | null;
  profile: AppUser | null;
  role: Role | null;
  /** The restaurant this login belongs to (null until resolved / signed out). */
  restaurantId: string | null;
  /** Its display name — readable even once expired, so the "trial ended"
   *  screen can name the restaurant it's talking about. */
  restaurantName: string | null;
  /**
   * The restaurant root doc itself, live — the receipt header, the join code,
   * the wizard's answers and the activation marker.
   *
   * Exposed because this subscription already exists for the trial clock, so
   * a reader that needs one more field off this document costs nothing;
   * opening a second listener on the busiest doc in the restaurant to read a
   * field this one already has would be the expensive way to ask.
   *
   * `config` above stays the way to ask how the restaurant WORKS — it resolves
   * what an absent field means, and no caller should be re-deciding that.
   */
  restaurant: RestaurantProfile | null;
  /**
   * How this restaurant works — the setup wizard's answers, live. Derived
   * from the same root-doc subscription as the trial clock, so it costs no
   * extra listener and every device re-shapes the moment an answer changes.
   *
   * Defaults to kitchen-tickets-on / tables-on for every restaurant that
   * predates the wizard — but NOT while the doc is still in flight: `loading`
   * stays true until the root doc has answered, so no screen ever acts on
   * that default mistaking it for an answer. See `restaurantAnswered` and
   * `resolveRestaurantConfig`.
   */
  config: RestaurantConfig;
  gate: GateStatus;
  /**
   * The role on the profile doc REGARDLESS of whether the account is usable.
   *
   * `role` above is null the moment a gate closes — that is the point of it.
   * But the gate screens have to tell an owner from their staff: an expired
   * workspace offers the owner a way to pay and everyone else "ask your
   * manager", and offering a waiter a subscription button would invite them to
   * put a restaurant on their own card. Read this ONLY to choose what to say;
   * it grants nothing, and `role` remains the one that gates behaviour.
   */
  gatedRole: Role | null;
  /** When this workspace stops working (ms epoch), or null if it never does.
   *  Drives the countdown banner; NOT the enforcement (that's firestore.rules). */
  trialEndsAt: number | null;
  loading: boolean;
  /** Set when the app had to force-sign-out (e.g. account not linked to a
   *  restaurant) — the login screen shows it. */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  registerRestaurant: (
    restaurantName: string,
    ownerName: string,
    email: string,
    password: string,
  ) => Promise<void>;
  joinRestaurant: (
    joinCode: string,
    name: string,
    email: string,
    password: string,
    role: SignupRole,
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [rawProfile, setRawProfile] = useState<AppUser | null>(null);
  // The restaurant root doc — watched for its trial fields (see the expiry
  // section below). Readable even by an expired member, by design.
  const [restaurantDoc, setRestaurantDoc] = useState<RestaurantProfile | null>(
    null,
  );
  // True only when the SERVER positively said "no such doc" — never from a
  // cache-only miss, and never from an error. This one boolean is the whole
  // difference between "your account was removed" and "I couldn't see it just
  // now", and the app locks people out on it, so it is set in exactly two
  // places and both of them have heard back from the backend. See the profile
  // listener.
  const [docMissing, setDocMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * Has the restaurant listener SAID ANYTHING yet — a doc, a miss, or an
   * error? Not "is there a doc": the question is whether we have an answer at
   * all, and `restaurantDoc === null` cannot tell the two apart.
   *
   * It has to be tracked separately because `resolveRestaurantConfig(null)`
   * returns DEFAULT_CONFIG, whose every value is a working restaurant with a
   * kitchen display, a floor, and setup already finished. Handing that out
   * while the doc is still in flight is not a harmless default — it is a
   * confident wrong answer, and the app acts on it:
   *
   *  - the tab bar draws the KDS tab and the order screen draws Send-to-
   *    Kitchen, so a restaurant that answered "no kitchen tickets" gets the
   *    KOT app anyway;
   *  - `needsSetup` reads false, so `(app)/setup` believes a brand-new
   *    restaurant is a returning one — it seeds the menu but NO FLOOR, skips
   *    `markSetupCompleted`, and sends the owner home instead of into the
   *    walkthrough.
   *
   * The profile listener used to clear `loading` on its own, so that window
   * was open on every launch. Now nothing downstream sees a config until the
   * restaurant doc has answered. An ERROR counts as an answer — DEFAULT_CONFIG
   * is the right fallback once we know we cannot do better, and holding the
   * splash for ever on an offline tablet would be the worse failure.
   */
  const [restaurantAnswered, setRestaurantAnswered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let unsubIndex: (() => void) | null = null;
    let unsubProfile: (() => void) | null = null;
    let unsubRestaurant: (() => void) | null = null;
    let profileRid: string | null = null;
    /**
     * Have we EVER held this login's profile document?
     *
     * The difference between "your account was removed" and "you never had an
     * account here" — and the app locks people out on the first, so it may
     * only ever be concluded from a transition. See the profile listener.
     */
    let sawProfile = false;
    /**
     * Guarantees `loading` resolves.
     *
     * Every branch below that waits for something — a signup batch mid-flight,
     * a userIndex doc that has not arrived, a profile listener that has not
     * spoken — waits by RETURNING, which leaves `loading` true and the app on
     * the splash screen. Any one of them failing to fire again is a permanent
     * white screen, which is exactly what a user reports as "it just hangs".
     * This is the floor under all of them: on expiry the app gives up and
     * shows the login screen, which is recoverable, instead of nothing, which
     * is not.
     */
    let resolveTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResolveTimer = () => {
      if (resolveTimer) {
        clearTimeout(resolveTimer);
        resolveTimer = null;
      }
    };
    const armResolveTimer = () => {
      clearResolveTimer();
      resolveTimer = setTimeout(() => {
        resolveTimer = null;
        console.warn(
          "[auth] sign-in never resolved — falling back to signed-out.",
        );
        setRawProfile(null);
        setDocMissing(false);
        setLoading(false);
        // Nothing is coming. Stop holding the splash for a restaurant doc
        // that is never going to answer either.
        setRestaurantAnswered(true);
      }, AUTH_RESOLVE_TIMEOUT_MS);
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubIndex?.();
      unsubIndex = null;
      unsubProfile?.();
      unsubProfile = null;
      unsubRestaurant?.();
      unsubRestaurant = null;
      clearResolveTimer();
      sawProfile = false;
      profileRid = null;
      setFirebaseUser(user);
      if (!user) {
        setActiveRestaurantId(null);
        setRestaurantId(null);
        setRawProfile(null);
        setRestaurantDoc(null);
        // Signed out: there is no restaurant to wait for, and `resolving`
        // below only ever holds while a firebaseUser exists.
        setRestaurantAnswered(false);
        setDocMissing(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      // A NEW login answers for itself. Without this, the previous account's
      // config would stand in for the incoming one's for a beat — which on a
      // shared tablet is one restaurant's shape drawn over another's.
      setRestaurantAnswered(false);
      armResolveTimer();

      const subscribeProfile = (rid: string) => {
        if (profileRid === rid && unsubProfile) return;
        profileRid = rid;
        setActiveRestaurantId(rid);
        setRestaurantId(rid);
        unsubProfile?.();
        /**
         * THE PROFILE LISTENER, and the two distinctions it must never lose.
         *
         * **"Gone" vs "I can't see it."** A document snapshot arrives empty
         * for reasons that have nothing to do with an admin removing anybody:
         * the client is offline, the app was backgrounded and the listen
         * stream is re-establishing, or another listener on this restaurant
         * was denied and the SDK dropped the cached collection on its way to
         * resetting. `metadata.fromCache` separates them — it is false only
         * when the BACKEND confirmed this snapshot. A cache-only miss is a gap
         * in our knowledge and is ignored outright, so a blip mid-service
         * leaves the session exactly as it was. Data that EXISTS is always
         * used, cached or not: a stale profile is still a profile, and there
         * is no reason to hold up a shift to re-confirm a role that changes
         * yearly.
         *
         * **"Removed" vs "never had one."** Removal is a TRANSITION — the doc
         * was here and now the server says it is not. `sawProfile` is what
         * makes that a transition rather than a guess. Without it, the very
         * first look at a brand-new signup (whose batch may still be settling)
         * comes back empty and the owner is told their account was deleted —
         * permanently, because nothing ever clears that verdict. A first look
         * that comes back genuinely empty means something else entirely: this
         * login has no profile in this restaurant, which is the "not linked"
         * path that already exists and signs out with an explanation.
         */
        unsubProfile = onSnapshot(
          paths.user(user.uid),
          (snap) => {
            if (snap.exists()) {
              clearResolveTimer();
              sawProfile = true;
              setRawProfile({ ...snap.data(), uid: user.uid });
              setDocMissing(false);
              setLoading(false);
              return;
            }

            // Not in the cache we happen to hold. That is not an answer.
            if (snap.metadata.fromCache) return;

            // A signup batch is still settling; its own writes will arrive.
            if (isSignupInProgress()) return;

            clearResolveTimer();
            if (sawProfile) {
              // It WAS here, and the server says it no longer is. The only
              // thing that produces this is a real deletion.
              console.warn("[auth] profile deleted server-side — removed.");
              setRawProfile(null);
              setDocMissing(true);
              setLoading(false);
              return;
            }

            // Never seen. This login simply has no profile in this
            // restaurant — say so, rather than accusing anyone of deleting it.
            console.warn(
              `[auth] no profile at users/${user.uid} in "${rid}" — not linked.`,
            );
            setDocMissing(false);
            setLoading(false);
            setNotice(NOT_LINKED_MESSAGE);
            fbSignOut(auth).catch(() => {});
          },
          (e) => {
            // Profile unreadable (offline, rules) — treat as signed-out rather
            // than crashing the app or claiming the account was removed.
            console.warn("[auth] failed to load profile:", e);
            clearResolveTimer();
            setRawProfile(null);
            setDocMissing(false);
            setLoading(false);
          },
        );

        // The workspace's trial clock. Live, because activation is a WRITE to
        // this doc — the moment the owner is activated, every signed-in device
        // in the restaurant unblocks without a restart.
        unsubRestaurant?.();
        unsubRestaurant = onSnapshot(
          paths.restaurantProfile(),
          (snap) => {
            setRestaurantDoc(snap.exists() ? snap.data() : null);
            // An answer, either way — see `restaurantAnswered`. A miss is as
            // much of an answer as a doc: it means DEFAULT_CONFIG is the truth
            // here, rather than a guess we have not checked yet.
            setRestaurantAnswered(true);
          },
          (e) => {
            // Unreadable (offline, or not a member). Fall back to the account
            // field alone rather than locking someone out on a network blip.
            console.warn("[auth] failed to load restaurant profile:", e);
            setRestaurantDoc(null);
            setRestaurantAnswered(true);
          },
        );
      };

      // FIRST: which restaurant does this login belong to? A live listener
      // (userIndex is write-once) so a signup batch committing a moment after
      // auth-user creation resolves the tenant without a race.
      unsubIndex = onSnapshot(
        paths.userIndex(user.uid),
        (snap) => {
          if (snap.exists()) {
            subscribeProfile(snap.data().restaurantId);
            return;
          }
          // Same rule as the profile listener: an empty snapshot that only
          // the local cache vouches for is not an answer. A cold start begins
          // with an empty cache, and acting on that miss is how a perfectly
          // linked account gets signed out — or, in a dev build, pointed at
          // the fallback restaurant where it has no profile at all and is
          // then reported as "removed".
          if (snap.metadata.fromCache) return;
          if (isSignupInProgress()) return; // batch in flight — keep waiting
          const fallback = devFallbackRestaurantId();
          if (fallback) {
            console.warn(
              `[auth] userIndex/${user.uid} missing — DEV fallback to env ` +
                `restaurant "${fallback}" (run scripts/migrate.js).`,
            );
            subscribeProfile(fallback);
            return;
          }
          console.warn(`[auth] userIndex/${user.uid} missing — signing out.`);
          setNotice(NOT_LINKED_MESSAGE);
          fbSignOut(auth).catch(() => {});
        },
        (e) => {
          console.warn("[auth] failed to resolve restaurant:", e);
          clearResolveTimer();
          setRawProfile(null);
          setDocMissing(false);
          setLoading(false);
        },
      );
    });
    return () => {
      clearResolveTimer();
      unsubIndex?.();
      unsubProfile?.();
      unsubRestaurant?.();
      unsubAuth();
    };
  }, []);

  // ── trial expiry ────────────────────────────────────────────────────────────
  // Expiry is a CLOCK event, not a data change. The profile listener above is
  // an onSnapshot — it fires on WRITES, and nothing writes to the doc at the
  // deadline, so a live subscription alone would leave a trial device happily
  // working until some unrelated write happened to land. Hence a timer.
  //
  // This is UX only. The real gate is firestore.rules against request.time (the
  // server clock). If the prospect rolls the device date back, this timer just
  // won't fire early — every query still fails server-side, so nothing is
  // extended; they simply see errors instead of the friendly screen.
  //
  // No trial fields = permanent = never expires. Never written as "expiresAt
  // must be in the future" — that form would lock out every paying customer.
  //
  // Mirrors firestore.rules exactly. On the RESTAURANT an explicit expiresAt
  // overrides the computed trial deadline (`tenantNotExpired`); on the ACCOUNT
  // expiresAt stands alone (`selfNotExpired`). Either level can close the app,
  // so the EARLIER of the two wins — and null at a level means that level
  // imposes no deadline at all.
  const tenantEndsAt =
    restaurantDoc?.expiresAt?.toMillis() ??
    (restaurantDoc?.trialStartedAt
      ? restaurantDoc.trialStartedAt.toMillis() + TRIAL_MS
      : null);
  const accountEndsAt = rawProfile?.expiresAt?.toMillis() ?? null;
  const expiresAtMs =
    tenantEndsAt === null
      ? accountEndsAt
      : accountEndsAt === null
        ? tenantEndsAt
        : Math.min(tenantEndsAt, accountEndsAt);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (expiresAtMs === null) {
      setExpired(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        setExpired(true);
        return;
      }
      setExpired(false);
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    check();
    // Background JS timers are throttled or suspended on both platforms, so a
    // device that slept through the deadline must re-check when it wakes.
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (timer) clearTimeout(timer);
      check();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [expiresAtMs]);

  // Deadline reached mid-session. The session is deliberately NOT ended: `gate`
  // flips to "expired" and the app parks on /pending, which explains what
  // happened and offers a way to get in touch. Signing out would bounce them to
  // a login screen where the only option is to re-enter credentials that no
  // longer work — and, more importantly, activation is a live write to the
  // restaurant doc, so a device that stays signed in unblocks by itself the
  // moment the owner pays. The notice is staged anyway, so it still explains
  // things if they sign out by hand from that screen.
  useEffect(() => {
    if (!expired || !firebaseUser) return;
    setNotice(TRIAL_ENDED_MESSAGE);
  }, [expired, firebaseUser]);

  const usable =
    rawProfile !== null &&
    rawProfile.status === "approved" &&
    rawProfile.active &&
    !expired;
  const profile = usable ? rawProfile : null;

  /**
   * Still resolving THIS login — the profile, or the restaurant doc the whole
   * app's shape is read off. Both must have answered before anything renders:
   * see `restaurantAnswered`. Used for the gate as well as the exported
   * `loading`, because the gate itself is decided partly from the restaurant
   * doc (the tenant's trial deadline lives there).
   */
  const resolving = loading || (!!firebaseUser && !restaurantAnswered);

  let gate: GateStatus = null;
  if (firebaseUser && !resolving && !profile) {
    if (expired && rawProfile !== null) {
      // Wins over every other reason: the account is approved and active, it's
      // the trial that ran out. Shown in the window before sign-out lands, and
      // as the fallback if sign-out fails (e.g. offline).
      gate = "expired";
    } else if (rawProfile === null) {
      gate = docMissing ? "removed" : null;
    } else if (rawProfile.status === "pending") {
      gate = "pending";
    } else if (rawProfile.status === "denied") {
      gate = "denied";
    } else {
      gate = "restricted";
    }
  }

  const value: AuthState = {
    firebaseUser,
    profile,
    role: profile?.role ?? null,
    restaurantId,
    restaurantName: restaurantDoc?.name ?? null,
    restaurant: restaurantDoc,
    config: resolveRestaurantConfig(restaurantDoc),
    gate,
    gatedRole: rawProfile?.role ?? null,
    trialEndsAt: expiresAtMs,
    loading: resolving,
    notice,
    signIn: async (email, password) => {
      setNotice(null);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Surface "not linked" as a login error instead of a silent bounce.
      // (The index listener above races to the same conclusion; tolerate its
      // sign-out making this read fail.)
      try {
        const idx = await getDoc(paths.userIndex(cred.user.uid));
        if (!idx.exists() && !devFallbackRestaurantId()) {
          await fbSignOut(auth).catch(() => {});
          throw new Error(NOT_LINKED_MESSAGE);
        }
      } catch (e) {
        if (e instanceof Error && e.message === NOT_LINKED_MESSAGE) throw e;
        if (!auth.currentUser) throw new Error(NOT_LINKED_MESSAGE);
        // Index unreadable but still signed in (offline blip) — let the
        // listener sort it out.
      }
    },
    registerRestaurant: async (restaurantName, ownerName, email, password) => {
      setNotice(null);
      await registerRestaurant(restaurantName, ownerName, email, password);
    },
    joinRestaurant: async (joinCode, name, email, password, role) => {
      setNotice(null);
      await joinRestaurant(joinCode, name, email, password, role);
    },
    signOut: async () => {
      await fbSignOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
