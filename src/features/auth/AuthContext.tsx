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
 * TRIAL EXPIRY: a demo account carries `expiresAt`. Because expiry is a clock
 * event rather than a write, no snapshot fires at the deadline — a timer does
 * the work (see the expiry effect below), flipping `gate` to "expired" and
 * signing the device out. Accounts with NO `expiresAt` never expire; that's the
 * default and it is what every real customer has.
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
import type { AppUser, Role } from "@/types/models";

export type { SignupRole };

const NOT_LINKED_MESSAGE =
  "This account isn't linked to any restaurant. Sign up again with your " +
  "restaurant's join code, or contact support.";

const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended. Thanks for trying Smart Serve — get in touch to " +
  "activate your restaurant and keep everything you've set up.";

/** setTimeout stores its delay in a signed 32-bit int; anything larger
 *  overflows and fires IMMEDIATELY. Re-arm in chunks no bigger than this. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

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
  gate: GateStatus;
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
  // True only when the snapshot positively said "no such doc" (vs. an error,
  // which we treat as signed-out rather than "account removed").
  const [docMissing, setDocMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let unsubIndex: (() => void) | null = null;
    let unsubProfile: (() => void) | null = null;
    let profileRid: string | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubIndex?.();
      unsubIndex = null;
      unsubProfile?.();
      unsubProfile = null;
      profileRid = null;
      setFirebaseUser(user);
      if (!user) {
        setActiveRestaurantId(null);
        setRestaurantId(null);
        setRawProfile(null);
        setDocMissing(false);
        setLoading(false);
        return;
      }
      setLoading(true);

      const subscribeProfile = (rid: string) => {
        if (profileRid === rid && unsubProfile) return;
        profileRid = rid;
        setActiveRestaurantId(rid);
        setRestaurantId(rid);
        unsubProfile?.();
        unsubProfile = onSnapshot(
          paths.user(user.uid),
          (snap) => {
            setRawProfile(
              snap.exists() ? { ...snap.data(), uid: user.uid } : null,
            );
            setDocMissing(!snap.exists());
            setLoading(false);
          },
          (e) => {
            // Profile unreadable (offline, rules) — treat as signed-out rather
            // than crashing the app or claiming the account was removed.
            console.warn("[auth] failed to load profile:", e);
            setRawProfile(null);
            setDocMissing(false);
            setLoading(false);
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
          setRawProfile(null);
          setDocMissing(false);
          setLoading(false);
        },
      );
    });
    return () => {
      unsubIndex?.();
      unsubProfile?.();
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
  // No expiresAt = permanent account = never expires. Never written as
  // "expiresAt must be in the future".
  const expiresAtMs = rawProfile?.expiresAt?.toMillis() ?? null;
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

  // Deadline reached mid-session: explain, then end the session for real. The
  // notice survives the sign-out and renders on the login screen.
  useEffect(() => {
    if (!expired || !firebaseUser) return;
    setNotice(TRIAL_ENDED_MESSAGE);
    fbSignOut(auth).catch(() => {});
  }, [expired, firebaseUser]);

  const usable =
    rawProfile !== null &&
    rawProfile.status === "approved" &&
    rawProfile.active &&
    !expired;
  const profile = usable ? rawProfile : null;

  let gate: GateStatus = null;
  if (firebaseUser && !loading && !profile) {
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
    gate,
    loading,
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
