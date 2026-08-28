/**
 * ACTIVATION — is this a brand-new owner, and how far have they got?
 *
 * ## What this is now
 *
 * This hook used to power three things: a getting-started checklist on
 * Insights, a coach that floated over the tabs, and the notification ladder.
 * The first two are gone — a checklist of chores turned out to be the wrong
 * answer to "teach me this app", and the walkthrough
 * (`practice/PracticeRun`) replaced both. What is left is the ladder, and
 * that is all this file is for.
 *
 * ## The load-bearing decisions
 *
 * - **It reads real state, never a tutorial's own counter.** Every signal
 *   here is a document the owner produced by using the app, so it cannot
 *   claim progress that did not happen and cannot drift.
 * - **The team signal waits for an APPROVED join, and counts the PENDING
 *   ones.** A waiter who has signed up is locked out until the owner taps
 *   approve, and nothing else in the app tells them so — which is why the
 *   ladder's one rung that outranks the first order is "somebody is waiting
 *   to join".
 * - **It retires itself, and retirement is a fact about the RESTAURANT.**
 *   `activationDoneAt` on the root doc, so a restaurant that is plainly
 *   trading (a third settled bill, or bills on two separate days) stops being
 *   nudged on every device at once. Absent = still activating, matching
 *   `needsSetup` and the trial fields.
 * - **Nothing is reported until the probes have answered.** An established
 *   restaurant carries no local flag and no marker, so for the beat before
 *   `bills` resolves it looks exactly like a brand-new one. Reporting during
 *   that beat is how a year-old restaurant gets scheduled a "take your first
 *   order" notification.
 * - **Every query is bounded**, and once retired the hook never subscribes
 *   again — which is what keeps these listeners off the front door of a
 *   restaurant that has been running a year.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import type {
  AppUser,
  Bill,
  DailySummary,
  RestaurantProfile,
} from "@/types/models";

/**
 * How much trading it takes to retire, unasked.
 *
 * Two independent tests because they catch different restaurants: a busy
 * first evening trips the bill count, and a quiet place that bills once a day
 * trips the day count.
 */
const AUTO_RETIRE_BILLS = 3;
const AUTO_RETIRE_DAYS = 2;

// ── local flags ──────────────────────────────────────────────────────────────
//
// Keyed by restaurant id: one tablet can be signed into a different workspace
// tomorrow, and an unkeyed flag would silence a brand-new restaurant because
// a previous one had finished.

const keyRetired = (rid: string) => `activation:graduated:${rid}`;
const keySetupAt = (rid: string) => `activation:setupAt:${rid}`;

/** Stamp the moment first-run setup finished. The nudge ladder is measured
 *  from here, so it is written by the wizard and never by anything else. */
export async function markSetupCompleted(rid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keySetupAt(rid), String(Date.now()));
  } catch {
    // A device that cannot persist this simply gets no nudges.
  }
}

export async function readSetupCompletedAt(rid: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(keySetupAt(rid));
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Retire this restaurant from activation, everywhere.
 *
 * Best-effort and unawaited: the local flag has already stopped this device,
 * and a failed write costs the other tablets one more day of nudges rather
 * than anything an owner would notice.
 */
async function markActivationDone(): Promise<void> {
  try {
    await setDoc(
      paths.restaurantProfile(),
      {
        activationDoneAt:
          serverTimestamp() as unknown as RestaurantProfile["activationDoneAt"],
      },
      { merge: true }
    );
  } catch {
    // ignore — see above
  }
}

// ── the hook ─────────────────────────────────────────────────────────────────

export interface Activation {
  /** Still resolving — callers hold their render rather than guessing. */
  loading: boolean;
  /** A brand-new owner who has not finished activating. */
  active: boolean;
  /** Local ms epoch of when setup finished, or null (pre-wizard restaurant). */
  setupAt: number | null;
  /** At least one bill has been settled. */
  firstOrderDone: boolean;
  /** Somebody besides the owner has signed up — approved or not. */
  teamInvited: boolean;
  /** …and the owner has approved them, which is what lets them in. */
  teamApproved: boolean;
  /** Staff waiting on the owner right now. */
  teamPending: number;
}

const INERT: Activation = {
  loading: false,
  active: false,
  setupAt: null,
  firstOrderDone: false,
  teamInvited: false,
  teamApproved: false,
  teamPending: 0,
};

export interface UseActivationArgs {
  restaurantId: string | null;
  /** Only the owner is activated — a waiter who joins an established
   *  restaurant is not setting anything up. */
  isOwner: boolean;
  /** Setup is still owed; the wizard is on screen and nothing else should be. */
  needsSetup: boolean;
  /** The restaurant root doc, from the subscription `AuthContext` already
   *  holds — so the retirement marker costs no listener of its own. */
  profile: RestaurantProfile | null;
}

export function useActivation({
  restaurantId,
  isOwner,
  needsSetup,
  profile,
}: UseActivationArgs): Activation {
  const [flags, setFlags] = useState<{
    loading: boolean;
    retired: boolean;
    setupAt: number | null;
  }>({ loading: true, retired: false, setupAt: null });

  useEffect(() => {
    let live = true;
    if (!restaurantId || !isOwner) {
      setFlags((f) => ({ ...f, loading: false }));
      return;
    }
    (async () => {
      const [retiredRaw, setupAt] = await Promise.all([
        AsyncStorage.getItem(keyRetired(restaurantId)).catch(() => null),
        readSetupCompletedAt(restaurantId),
      ]);
      if (live) {
        setFlags({ loading: false, retired: retiredRaw === "1", setupAt });
      }
    })();
    return () => {
      live = false;
    };
  }, [restaurantId, isOwner]);

  // The server's word outranks the local cache, and neither can un-retire
  // what the other has retired.
  const retired = flags.retired || profile?.activationDoneAt != null;

  const live =
    !!restaurantId && isOwner && !needsSetup && !flags.loading && !retired;

  // Four, not three: the owner plus enough of a team to tell "somebody joined
  // and is waiting" from "somebody joined and was let in".
  const staffQ = useMemo(
    () => (live ? query(paths.users(), limit(4)) : null),
    [live]
  );
  // Equality on a single field — no composite index. Bounded at the number
  // that retires this hook: past that the answer cannot change.
  const billQ = useMemo(
    () =>
      live
        ? query(
            paths.bills(),
            where("status", "==", "paid"),
            limit(AUTO_RETIRE_BILLS)
          )
        : null,
    [live]
  );
  // One doc per trading day, so this counts DAYS for the price of counting
  // documents — and only ever two of them.
  const dayQ = useMemo(
    () => (live ? query(paths.dailySummaries(), limit(AUTO_RETIRE_DAYS)) : null),
    [live]
  );

  const staff = useCollectionData<AppUser>(staffQ);
  const bills = useCollectionData<Bill>(billQ);
  const days = useCollectionData<DailySummary>(dayQ);

  const retire = useCallback(() => {
    if (!restaurantId) return;
    setFlags((f) => ({ ...f, retired: true }));
    AsyncStorage.setItem(keyRetired(restaurantId), "1").catch(() => {});
    void markActivationDone();
  }, [restaurantId]);

  const shouldRetire =
    live &&
    !bills.loading &&
    !days.loading &&
    (bills.data.length >= AUTO_RETIRE_BILLS ||
      days.data.length >= AUTO_RETIRE_DAYS);
  const retireFired = useRef(false);
  useEffect(() => {
    if (!shouldRetire || retireFired.current) return;
    retireFired.current = true;
    retire();
  }, [shouldRetire, retire]);

  if (!live) {
    return flags.loading && isOwner && !!restaurantId
      ? { ...INERT, loading: true }
      : INERT;
  }

  // See the note at the top: an established restaurant is indistinguishable
  // from a new one until these answer, and acting during that beat is how it
  // gets treated as new.
  if (bills.loading || days.loading) return { ...INERT, loading: true };

  // Somebody other than the owner. The owner's own profile is `cashier` or
  // `admin`, so the team is whatever is left.
  const team = staff.data.filter(
    (u) => u.role === "waiter" || u.role === "kitchen"
  );

  return {
    loading: false,
    active: true,
    setupAt: flags.setupAt,
    firstOrderDone: bills.data.length > 0,
    teamInvited: team.length > 0,
    teamApproved: team.some((u) => u.status === "approved"),
    teamPending: team.filter((u) => u.status === "pending").length,
  };
}
