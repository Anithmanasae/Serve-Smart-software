/**
 * WHAT THE RUN TEACHES, AND IN WHAT ORDER — resolved from this restaurant's
 * own setup answers.
 *
 * The wizard's answers do not merely reword this app, they REMOVE controls
 * from it: quick billing has no Send-KOT button and no kitchen tab at all
 * (`OrderCartPanel` renders neither), and a counter business has no floor
 * (`canSeeTab` drops the Tables tab). A walkthrough that pointed at "Send to
 * Kitchen" in a restaurant that told us it has no kitchen ticket would be
 * teaching a button that does not exist — the single worst thing a tutorial
 * can do, because the owner concludes the app is broken rather than that the
 * tutorial is.
 *
 * So every step declares what it NEEDS, and the list is filtered before the
 * run starts — deliberately the same shape as `canSeeTab(tab, role, config)`
 * in `TabBar`, because this is the same question asked about a different
 * thing, and two different ways of asking it is how they drift apart.
 *
 * The four loops this produces:
 *
 * | tables | KOT | the run |
 * |---|---|---|
 * | yes | yes | table → dish → send → kitchen → bills → settle |
 * | yes | no  | table → dish → charge |
 * | no  | yes | dish → send → kitchen → bill |
 * | no  | no  | dish → charge |
 *
 * Where the money is taken moves too, and that is not cosmetic: `canBillHere`
 * in `OrderScreen` is `(!isDineIn || !config.kotEnabled)`, so a dine-in table
 * with a kitchen ticket settles on the BILLS tab, and everything else settles
 * on the order screen itself. The script has to walk to a different place.
 */
import type { RestaurantConfig } from "@/features/settings/restaurantConfig";
import type { PracticeStage, PracticeState } from "./practiceState";

export type PracticeStepId =
  | "pick-table"
  | "add-dish"
  | "open-cart"
  | "send-kot"
  | "kds-complete"
  | "settle"
  | "receipt";

export interface PracticeStep {
  id: PracticeStepId;
  /** The stage this step is performed on. */
  stage: PracticeStage;
  /** Shown as the caption's heading — an instruction, never a description. */
  title: string;
  /** One line of why, or what will happen. Never two. */
  body: string;
  /** Whether this restaurant has the control this step points at. Absent =
   *  every restaurant does. */
  requires?: (config: RestaurantConfig) => boolean;
  /**
   * Has the owner done it? Read off the run's own state, so the caption can
   * never claim a step is finished that isn't — the same rule the live
   * activation hook follows against Firestore.
   */
  done: (state: PracticeState) => boolean;
}

const ALL_STEPS: readonly PracticeStep[] = [
  {
    id: "pick-table",
    stage: "floor",
    title: "Tap table 4",
    body: "A table turns green when guests sit down. Tapping one opens its order.",
    requires: (c) => c.tablesEnabled,
    done: (s) => s.activeTableId !== null,
  },
  {
    id: "add-dish",
    stage: "order",
    title: "Tap any dish to add it",
    body: "This is your own menu. Tap the same dish twice to make it two.",
    done: (s) => s.lines.length > 0,
  },
  {
    // PHONE ONLY, and filtered out where the cart pane is always on screen.
    // On a phone the real order screen collapses the cart to a bar, and the
    // Send-KOT button lives inside the sheet that bar opens — so an owner who
    // is never told to tap it is looking for a button that is one tap away
    // and invisible. On a tablet the pane is already there and this step
    // would be pointing at nothing.
    id: "open-cart",
    stage: "order",
    title: "Tap the order bar",
    body: "Everything you have added is in here — and so is the way to send it.",
    done: (s) => s.cartOpen || s.kot !== null || s.paidAt !== null,
  },
  {
    id: "send-kot",
    stage: "order",
    title: "Now send it to the kitchen",
    body: "This is the moment the order leaves your hands and becomes a ticket.",
    requires: (c) => c.kotEnabled,
    done: (s) => s.kot !== null,
  },
  {
    // ONE step, because the board card has one button. START and READY exist
    // only inside the detail sheet, and teaching them here would have the
    // caption naming controls that are not on the screen it is pointing at.
    // COMPLETE is also the tap a real kitchen actually uses at the pass.
    id: "kds-complete",
    stage: "kds",
    title: "Your kitchen sees this",
    body: "On their own screen, the moment you send it. Tap COMPLETE when the food is up.",
    requires: (c) => c.kotEnabled,
    done: (s) => s.kot?.status === "completed",
  },
  {
    // There is no separate "go to Bills" step, and there was one until it was
    // noticed that it completed ITSELF: arriving at the payment screen is
    // what satisfies it, so the caption appeared and vanished in the same
    // frame having taught nothing. Where the owner has arrived is said here
    // instead, in the copy of the step they are actually performing.
    id: "settle",
    stage: "bills",
    title: "Take the payment",
    body: "Cash, UPI or card. That is the whole transaction.",
    done: (s) => s.paidAt !== null,
  },
  {
    id: "receipt",
    stage: "receipt",
    title: "That is your bill",
    body: "Your restaurant's name, your prices, your tax — ready to hand over.",
    done: () => false,
  },
];

/**
 * The steps THIS restaurant runs.
 *
 * Payment always happens on the same stage; what differs is how the owner GOT
 * there, and that is a difference worth naming. A dine-in table with a
 * kitchen ticket is paid for from the Bills tab — a separate screen they have
 * to know exists. Everything else is charged from the cart they are already
 * looking at, and telling that owner about a Bills tab they never need to
 * open is how a walkthrough starts teaching the app's shape instead of their
 * job.
 */
export interface PracticeLayout {
  /** The cart pane is permanently on screen (a tablet), so there is no bar to
   *  tap and no sheet to open. */
  cartAlwaysVisible: boolean;
}

export function practiceScript(
  config: RestaurantConfig,
  layout: PracticeLayout = { cartAlwaysVisible: false }
): PracticeStep[] {
  const billsIsASeparateStop = config.tablesEnabled && config.kotEnabled;
  return ALL_STEPS.filter(
    (s) =>
      (s.requires?.(config) ?? true) &&
      !(s.id === "open-cart" && layout.cartAlwaysVisible)
  ).map((s) =>
    s.id === "settle"
      ? {
          ...s,
          // "No second screen" was wrong and had to go: Charge does open a
          // payment surface. The real difference is not how many screens
          // there are, it is whether the owner has to LEAVE — a dine-in table
          // is paid for over on the Bills tab, a counter order is charged
          // from the cart already in front of them.
          body: billsIsASeparateStop
            ? "This is your Bills tab — where a table that has eaten gets paid for."
            : "Charge from the cart you are already in — no trip to the Bills tab.",
        }
      : s
  );
}

/** How many taps this restaurant's loop actually takes. Said out loud on the
 *  intro card, because "four steps" is a promise a nervous owner will hold
 *  you to, and it differs by more than half between configurations. */
export function practiceStepCount(
  config: RestaurantConfig,
  layout?: PracticeLayout
): number {
  // The receipt is the payoff, not a step the owner performs.
  return practiceScript(config, layout).filter((s) => s.id !== "receipt").length;
}
