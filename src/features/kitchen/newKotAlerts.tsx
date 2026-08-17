/**
 * In-app KITCHEN alert for incoming orders.
 *
 * The mirror image of `order/kotAlerts.tsx`: that one watches for a status
 * TRANSITION and tells the waiter their food is ready; this one watches for an
 * ARRIVAL and tells the kitchen there is food to cook. Same shape, same "no
 * server involved" — the KDS already holds a live kot subscription, so a new
 * ticket is just an id that wasn't in the previous snapshot.
 *
 * Three channels, because a kitchen defeats any one of them on its own:
 * a chime (the cook is at the pass, not the screen), a haptic (the tablet may
 * be in a hand), and a banner (the answer to "what just made that noise?").
 *
 * ## The load-bearing decisions
 *
 * - **The FIRST snapshot only seeds the baseline.** Otherwise opening the app
 *   mid-service announces every ticket already on the board, and an alert that
 *   cries wolf on launch is one the kitchen learns to ignore by Tuesday.
 * - **Arrival is detected per KOT, not per table card.** The board folds a
 *   table's rounds into one card (`groupKots`), so a second round fired to a
 *   table that already has a card changes no card count at all — and a second
 *   round is exactly the order most likely to be missed.
 * - **It repeats while the ticket is still `new`, and `new` is the ack.**
 *   Sound is the only channel that reaches a cook facing away, and a sound
 *   heard once over an extractor fan is a sound not heard. Tapping START
 *   (`status: "preparing"`) silences it, so the acknowledgement is a thing the
 *   kitchen was already going to do rather than a dismiss button bolted on to
 *   shut the app up.
 * - **...but it gives up after MAX_REPEATS.** A kitchen that hasn't touched a
 *   ticket in two minutes is not going to be persuaded by a sixteenth chime;
 *   past that point it is just noise, and noise is what gets the volume turned
 *   down for the whole service. A fresh arrival resets the budget.
 *
 * TODO: this still only reaches a FOREGROUNDED app. A backgrounded or sleeping
 * tablet needs expo-notifications + per-device push tokens, same caveat as the
 * waiter side.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { feel } from "@/lib/feedback";
import { playNewOrderChime } from "@/lib/kitchenChime";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { LiveKot } from "./groupKots";

/** How long the banner stays up. Long enough to read across a kitchen. */
const BANNER_MS = 5000;
/** Gap between nags while a ticket is still unacknowledged. */
const REPEAT_MS = 20000;
/** Nags per arrival before it stops asking. ~2 minutes at REPEAT_MS. */
const MAX_REPEATS = 6;

export interface NewKotAlert {
  /** Changes per alert so a repeat arrival re-triggers the banner. */
  key: number;
  /** One table's label, or null when several landed at once. */
  tableLabel: string | null;
  /** Tickets in this arrival — drives "2 NEW ORDERS". */
  count: number;
  /** Dishes across them, so the kitchen knows the size before walking over. */
  itemCount: number;
}

function countItems(kot: LiveKot): number {
  let n = 0;
  for (const item of kot.items) if (!item.voided) n += item.qty;
  return n;
}

/**
 * Watch a live kot array for arrivals. Fires chime + haptic + banner, then
 * re-chimes while anything is still `new`.
 *
 * `ready` MUST be false while the subscription is still loading. Firestore's
 * pre-first-snapshot state is an EMPTY array, so seeding the baseline from it
 * makes the whole first snapshot look like it just arrived — and the board
 * would announce every ticket on it every time the app is opened. That is the
 * one way to get this wrong, and it fails loudest during service.
 *
 * Returns the banner payload; render it with `<NewKotAlertBanner />`.
 */
export function useNewKotAlerts(
  kots: LiveKot[],
  ready: boolean
): NewKotAlert | null {
  const [alert, setAlert] = useState<NewKotAlert | null>(null);
  const seenRef = useRef<Set<string> | null>(null);
  /** Nags left for the current batch of unacknowledged tickets. */
  const repeatsLeftRef = useRef(0);
  /** Bumped per arrival; restarts the nag timer so its phase is the arrival. */
  const [repeatEpoch, setRepeatEpoch] = useState(0);

  // How many tickets nobody has pressed START on. Read through a ref inside
  // the timer so the timer never has to list it as a dependency — see below.
  const pendingRef = useRef(0);
  pendingRef.current = kots.reduce(
    (n, k) => n + (k.status === "new" ? 1 : 0),
    0
  );

  useEffect(() => {
    if (!ready) return;
    const seen = seenRef.current;
    const next = new Set(kots.map((k) => k.id));

    if (seen) {
      const arrived = kots.filter((k) => !seen.has(k.id));
      if (arrived.length > 0) {
        playNewOrderChime();
        // The kitchen's counterpart to the waiter's READY pulse, and the only
        // other unsolicited haptic in the app. Both are "walk somewhere now".
        feel.success();
        repeatsLeftRef.current = MAX_REPEATS;
        setRepeatEpoch((n) => n + 1);
        setAlert({
          key: Date.now(),
          tableLabel: arrived.length === 1 ? arrived[0].tableLabel : null,
          count: arrived.length,
          itemCount: arrived.reduce((n, k) => n + countItems(k), 0),
        });
      }
    }

    seenRef.current = next;
  }, [kots, ready]);

  // Nag while anything is still unacknowledged.
  //
  // Keyed on the ARRIVAL, not on the pending count and not on `kots`. Both of
  // those change constantly during service — a status change, a reprint, a
  // cook starting one ticket of three — and every change would tear the timer
  // down and restart it, pushing the next chime out by a fresh REPEAT_MS each
  // time. On a busy board that means the nag never fires at all, which is the
  // exact service where it matters most. Anchoring to the arrival also gets
  // the phase right: an order landing 19s into a cycle waits its own full
  // REPEAT_MS rather than being nagged a second later.
  useEffect(() => {
    if (repeatEpoch === 0) return;
    const id = setInterval(() => {
      // Everything acknowledged, or the budget is spent — go quiet until the
      // next arrival restarts this effect.
      if (repeatsLeftRef.current <= 0 || pendingRef.current === 0) {
        clearInterval(id);
        return;
      }
      repeatsLeftRef.current -= 1;
      playNewOrderChime();
    }, REPEAT_MS);
    return () => clearInterval(id);
  }, [repeatEpoch]);

  useEffect(() => {
    if (!alert) return;
    const id = setTimeout(() => setAlert(null), BANNER_MS);
    return () => clearTimeout(id);
  }, [alert]);

  return alert;
}

/** Floating banner; render last inside the screen root so it sits on top. */
export function NewKotAlertBanner({
  alert,
  topOffset,
}: {
  alert: NewKotAlert | null;
  topOffset: number;
}) {
  if (!alert) return null;
  const title =
    alert.tableLabel != null
      ? `${alert.tableLabel} — NEW ORDER`
      : `${alert.count} NEW ORDERS`;
  return (
    <View
      pointerEvents="none"
      style={[styles.banner, { top: topOffset }]}
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>
        {alert.itemCount} {alert.itemCount === 1 ? "item" : "items"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: space.s4,
    right: space.s4,
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.statusRed,
    zIndex: 10,
    ...shadow.card,
  },
  title: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  detail: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.9,
    marginTop: 2,
  },
});
