/**
 * The tour's answers, held on the DEVICE across a registration.
 *
 * The setup wizard now runs twice over, in two different worlds. A prospect
 * meets it before they have an account (`app/welcome.tsx`), where there is no
 * restaurant to write to and no `paths.restaurantProfile()` to write it with;
 * the real write happens minutes later in `(app)/setup.tsx`, once they have
 * registered and Firestore knows who they are. This file is the only thing
 * that spans the two.
 *
 * The load-bearing decisions:
 *
 * - **AsyncStorage, not module state.** Between the last card of the tour and
 *   the "Create my restaurant" button there is a five-field form, and
 *   people leave a signup form — to fetch a password, to answer a message. On
 *   Android that is a process that can be killed. Answers held in a variable
 *   would be gone on the way back and the owner would be asked the same three
 *   questions again, which is precisely the thing the tour promised not to do.
 * - **It EXPIRES.** A tablet that toured the app in March must not shape a
 *   restaurant registered on it in June — a demo device handed to a second
 *   owner is the ordinary way that happens. Past `PENDING_TTL_MS` the stash is
 *   ignored and the wizard simply runs for real, which is the old behaviour
 *   and always safe.
 * - **It is a HINT, never a source of truth.** Nothing downstream reads it:
 *   `(app)/setup.tsx` hands it straight to `completeSetup`, which writes the
 *   config to the restaurant root doc exactly as it does for a typed-in
 *   answer, and then this stash is cleared. The restaurant document remains
 *   the only place the app asks what kind of place this is.
 * - **Seeing the tour is a SEPARATE flag from having answered it.** Someone
 *   who backs out at the welcome card has seen it; they must not be met with
 *   it again on every cold start, and they have no answers to carry.
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BusinessType, SetupAnswers } from "./setupTypes";

const KEY_ANSWERS = "onboarding:pendingSetup";
const KEY_TOUR_SEEN = "onboarding:tourSeen";

/** How long a toured-but-unregistered answer set stays good. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredPendingSetup {
  answers: SetupAnswers;
  /** When the tour was finished, so a stale stash can be ignored. */
  savedAt: number;
}

/**
 * Parse defensively. This is device storage written by an older build as
 * easily as by this one, and a malformed stash must degrade to "no stash" —
 * i.e. to the wizard running normally — rather than to a half-shaped app.
 */
function parse(raw: string | null): StoredPendingSetup | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredPendingSetup>;
    const a = v.answers;
    if (
      !a ||
      typeof a.businessType !== "string" ||
      typeof a.kotEnabled !== "boolean" ||
      typeof a.tableCount !== "number" ||
      // A stash written before the GST question existed carries no answer to
      // it, and there is no safe value to invent: guessing `true` is the
      // silent tax-on-every-bill this question was added to stop, and
      // guessing `false` is as presumptuous the other way. So it degrades to
      // "no stash" like any other incomplete one, and the wizard asks.
      typeof a.gstEnabled !== "boolean" ||
      typeof v.savedAt !== "number"
    ) {
      return null;
    }
    return {
      answers: {
        businessType: a.businessType as BusinessType,
        kotEnabled: a.kotEnabled,
        tableCount: a.tableCount,
        gstEnabled: a.gstEnabled,
      },
      savedAt: v.savedAt,
    };
  } catch {
    return null;
  }
}

/** Called by the tour's last card, before it sends them to signup. */
export async function savePendingSetup(answers: SetupAnswers): Promise<void> {
  try {
    const payload: StoredPendingSetup = { answers, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY_ANSWERS, JSON.stringify(payload));
  } catch {
    // A device that cannot persist this asks the questions again after
    // signup. Worse, not broken — so never let it fail the tour.
  }
}

/** The answers a prospect gave before registering, or null. */
export async function readPendingSetup(): Promise<SetupAnswers | null> {
  try {
    const stored = parse(await AsyncStorage.getItem(KEY_ANSWERS));
    if (!stored) return null;
    if (Date.now() - stored.savedAt > PENDING_TTL_MS) {
      void clearPendingSetup();
      return null;
    }
    return stored.answers;
  } catch {
    return null;
  }
}

/** Cleared the moment the answers have been written to a restaurant. */
export async function clearPendingSetup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_ANSWERS);
  } catch {
    // Nothing to do: a stash that cannot be cleared still expires.
  }
}

/**
 * Has this device been offered the tour? Written when the tour is finished
 * AND when it is backed out of — both mean "we have shown it", which is the
 * only question the launch route asks.
 */
export async function markTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_TOUR_SEEN, "1");
  } catch {
    // See `useTourSeen` — an unreadable flag is treated as SEEN, so a device
    // with no storage lands on login rather than looping through the tour.
  }
}

/**
 * `null` while the flag is being read — the caller must hold a splash rather
 * than guess, because guessing "not seen" flashes the tour at a returning
 * customer and guessing "seen" hides it from a new one.
 *
 * A read that THROWS resolves to `true`. The failure mode of "assume unseen"
 * on a device that cannot persist anything is the tour on every single
 * launch, with no way to get past it to the login screen.
 */
export function useTourSeen(): boolean | null {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let value = true;
      try {
        value = (await AsyncStorage.getItem(KEY_TOUR_SEEN)) === "1";
      } catch {
        value = true;
      }
      if (alive) setSeen(value);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return seen;
}

/**
 * Whether this launch of the signup screen followed the tour — which is what
 * decides whether the trial button gets its spotlight. Same `null`-while-
 * loading contract as `useTourSeen`.
 */
export function usePendingSetup(): SetupAnswers | null | undefined {
  const [answers, setAnswers] = useState<SetupAnswers | null | undefined>(
    undefined
  );

  useEffect(() => {
    let alive = true;
    void readPendingSetup().then((a) => {
      if (alive) setAnswers(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  return answers;
}
