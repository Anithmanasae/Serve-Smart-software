/**
 * The notification ladder — what Smart Serve says to an owner who has left.
 *
 * A new owner installs the app, answers the wizard, looks at the floor, and
 * puts the tablet down. Nothing about that means they decided against it;
 * usually it means service started. This is the only thing the app can do
 * about that, so it gets one job and a hard budget: **at most one
 * notification per day, at most four in total, and every rung disappears the
 * moment the thing it is nagging about is done.**
 *
 * ## The load-bearing decisions
 *
 * - **The ladder is DERIVED, not advanced.** `buildActivationNudges` is a
 *   pure function of "where is this owner now" — it does not know or care
 *   which rungs were sent before. Cancelling everything and re-deriving on
 *   each change is what makes "they took an order, so stop asking them to"
 *   automatic rather than a thing someone has to remember to call.
 * - **Nothing fires during service, and nothing fires at night.** Rungs are
 *   pinned to specific local hours (see `TIMES`), not to "+24h from setup",
 *   because +24h from a 7pm signup is 7pm the next day — the exact moment a
 *   restaurant owner is least able to look at a phone, and 3am for anyone who
 *   set the app up after a late close.
 * - **Every rung earns its place by being useful, not by being a reminder.**
 *   "Your trial is ending" is a message about us. "Your day's revenue and top
 *   dish are waiting" is a message about them. Only the second kind gets
 *   opened twice.
 * - **The trial itself is Google Play's problem.** Play runs the free trial
 *   and sends its own billing mail; duplicating that here would put the app
 *   in the position of dunning a customer it has not yet convinced. Nothing
 *   in this file mentions payment.
 * - **Re-scheduling is gated on a SIGNATURE.** These subscriptions push a
 *   snapshot on every write during service; re-writing four alarms each time
 *   would be pure churn, so the effect only runs when the derived ladder
 *   would actually differ.
 */
import { useEffect, useRef } from "react";
import {
  hasNotificationPermission,
  replaceScheduled,
  type NudgePayload,
  type ScheduledNudge,
} from "@/lib/notifications";

/** Local wall-clock times each rung aims for. A restaurant is quiet mid
 *  morning and again before the evening rush; both are when an owner is
 *  actually holding their phone. */
const TIMES = {
  /** Same day, a few hours after setup — but never outside 09:00–21:00. */
  sameDayOffsetHours: 3,
  morning: { h: 10, m: 30 },
  preService: { h: 17, m: 0 },
  eveningRecap: { h: 21, m: 30 },
} as const;

const DAY_START_H = 9;
const DAY_END_H = 21;

export interface NudgeInput {
  /** Local ms epoch when the setup wizard finished. */
  setupAt: number;
  firstOrderDone: boolean;
  teamInvited: boolean;
  /** Staff who have joined and are waiting on the owner to approve them. */
  teamPending: number;
  /** Where "take an order" should land — a counter business has no floor. */
  tablesEnabled: boolean;
  /** Injected so the pure builder can be reasoned about at any clock time. */
  now?: number;
}

/** `anchor` + `days`, snapped to a local wall-clock time. */
function atLocalTime(anchor: number, days: number, h: number, m: number): Date {
  const d = new Date(anchor);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * A few hours from now, pulled back inside waking hours. An owner who sets
 * the app up at 23:40 should hear from us at 10:30, not at 02:40.
 */
function soonAfter(anchor: number): Date {
  const d = new Date(anchor + TIMES.sameDayOffsetHours * 3600_000);
  if (d.getHours() < DAY_START_H) {
    d.setHours(TIMES.morning.h, TIMES.morning.m, 0, 0);
  } else if (d.getHours() >= DAY_END_H) {
    d.setDate(d.getDate() + 1);
    d.setHours(TIMES.morning.h, TIMES.morning.m, 0, 0);
  }
  return d;
}

/**
 * The whole ladder, derived from where the owner is right now.
 *
 * Pure and deterministic — same input, same alarms — which is what lets the
 * caller re-derive it freely instead of tracking what it sent last time.
 */
export function buildActivationNudges(input: NudgeInput): ScheduledNudge[] {
  const { setupAt, firstOrderDone, teamInvited, teamPending, tablesEnabled } =
    input;
  const now = input.now ?? Date.now();
  const orderRoute = tablesEnabled ? "/tables" : "/order";
  const out: ScheduledNudge[] = [];

  const push = (n: ScheduledNudge) => {
    if (n.at.getTime() > now) out.push(n);
  };

  // OUTRANKS the first order, and is the only rung that does. Every other
  // nudge here asks the owner to do something for themselves and can wait for
  // a better hour; this one is a person on the payroll locked out of the app,
  // who signed up and is now waiting on a tap the owner does not know exists.
  // Nothing else in the product tells them.
  if (teamPending > 0) {
    push({
      title:
        teamPending === 1
          ? "Someone is waiting to join"
          : `${teamPending} people are waiting to join`,
      body: "They signed up with your join code and cannot use the app until you approve them.",
      at: soonAfter(now),
      data: { kind: "activation", step: "approve-team", route: "/staff" },
    });
  }

  if (!firstOrderDone) {
    // The whole product hinges on this one action, so it gets three tries —
    // and every one of them names the payoff rather than the chore.
    push({
      title: "Your menu is already loaded",
      body: "Tap a table, tap a dish, and watch a real bill come out. About a minute.",
      at: soonAfter(setupAt),
      data: { kind: "activation", step: "first-order-1", route: orderRoute },
    });
    push({
      title: "Take one practice order",
      body: "It is the fastest way to know whether Smart Serve fits your place. Nothing you do is permanent.",
      at: atLocalTime(setupAt, 1, TIMES.morning.h, TIMES.morning.m),
      data: { kind: "activation", step: "first-order-2", route: orderRoute },
    });
    push({
      title: "Before tonight's rush",
      body: "Your menu and floor are set up and waiting. One order is all that is left to see the whole thing work.",
      at: atLocalTime(setupAt, 2, TIMES.preService.h, TIMES.preService.m),
      data: { kind: "activation", step: "first-order-3", route: orderRoute },
    });
    return out;
  }

  // They have billed something. Now the two things that make it a system
  // rather than a calculator: the staff on it, and the numbers coming back.
  push({
    title: "See how today went",
    body: "Your revenue, your best-selling dish and where the orders came from are all in Insights.",
    at: atLocalTime(now, 0, TIMES.eveningRecap.h, TIMES.eveningRecap.m),
    data: { kind: "activation", step: "recap", route: "/insights" },
  });

  if (!teamInvited) {
    push({
      title: "Put your waiters on it",
      body: "Share your join code and staff take orders from their own phones — straight through to your kitchen.",
      at: atLocalTime(now, 1, TIMES.morning.h, TIMES.morning.m),
      data: { kind: "activation", step: "invite-team", route: "/staff" },
    });
  }

  return out;
}

/** What has to change before the alarms are worth rewriting. */
function signature(input: NudgeInput | null): string {
  if (!input) return "off";
  return [
    input.setupAt,
    input.firstOrderDone ? "1" : "0",
    input.teamInvited ? "1" : "0",
    input.teamPending,
    input.tablesEnabled ? "1" : "0",
  ].join("|");
}

/**
 * Keep the scheduled ladder in step with reality.
 *
 * `null` means there is nothing to nudge about — not an owner, already
 * activated, or a restaurant that predates the wizard and so has no anchor.
 * That case still runs, and clears any alarms left over from before.
 */
export function useActivationNudges(input: NudgeInput | null): void {
  // The effect depends on the SIGNATURE, never on the object: `input` is
  // rebuilt on every render, and an effect keyed on its identity would tear
  // down an in-flight schedule on the very next snapshot — cancelling the
  // alarms it was halfway through writing and, because the signature had not
  // changed, never starting again.
  const sig = signature(input);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    let live = true;
    (async () => {
      // Read the permission rather than prompting for it: the wizard already
      // had that conversation, and a nudge nobody agreed to receive should
      // quietly never be scheduled instead of raising a dialog mid-service.
      if (!(await hasNotificationPermission())) return;
      if (!live) return;
      const kind: NudgePayload["kind"] = "activation";
      const current = latest.current;
      await replaceScheduled(
        kind,
        current ? buildActivationNudges(current) : []
      );
    })();

    return () => {
      live = false;
    };
  }, [sig]);
}
