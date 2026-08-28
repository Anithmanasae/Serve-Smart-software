/**
 * What the setup wizard asks, and what the answers mean.
 *
 * The wizard is deliberately SHORT — a new owner answers two or three
 * questions and the app configures itself. Everything an answer implies is
 * declared here rather than branched on at each call site, so "what does
 * picking Café actually do?" has exactly one place to read.
 *
 * The answers are written to the restaurant root doc by
 * `onboardingApi.completeSetup`, and read back everywhere through
 * `useAuth().config` — see `features/settings/restaurantConfig`.
 */
import type { MaterialCommunityIcons } from "@expo/vector-icons";

type IconName = Extract<keyof typeof MaterialCommunityIcons.glyphMap, string>;

/** The kind of place, which is what every other default falls out of. */
export type BusinessType = "cafe" | "qsr" | "foodtruck" | "restaurant";

export interface SetupAnswers {
  businessType: BusinessType;
  /**
   * Does an order go to the kitchen as a ticket before it is billed?
   *
   * `false` is the "quick billing" mode: no KDS, no Send-KOT step, the order
   * screen bills straight from the cart. Asked with NO answer pre-selected —
   * it changes enough of the app that it should be a decision, not a default
   * somebody tapped past.
   */
  kotEnabled: boolean;
  /** How many tables to put on the floor. **0 = counter service, no floor.** */
  tableCount: number;
  /**
   * Does this restaurant add GST to a bill?
   *
   * Asked here, with NO answer pre-selected, because it is the only setup
   * question with a wrong answer that costs real money. The switch has always
   * existed on the Account screen and defaulted to ON, so an owner who is not
   * registered — most small places, on day one — charged their customers a
   * tax they cannot remit until somebody happened to scroll far enough to
   * find the toggle. Nothing in the app raised it, and it prints on every
   * bill. It is a decision, so it gets asked like one.
   */
  gstEnabled: boolean;
}

export interface BusinessTypeDef {
  value: BusinessType;
  label: string;
  hint: string;
  icon: IconName;
  /**
   * Whether to ask the tables question at all. A food truck and a QSR counter
   * skip it and go straight to `tableCount: 0` — asking a truck how many
   * tables it has is the kind of question that makes setup feel like a form.
   */
  hasFloor: boolean;
  /** The count highlighted when the tables question opens. */
  defaultTables: number;
  /** Named on the final card, so the owner knows what landed in their menu. */
  starterMenu: string;
}

export const BUSINESS_TYPES: readonly BusinessTypeDef[] = [
  {
    value: "cafe",
    label: "Café",
    hint: "Coffee, bakes, all-day counter",
    icon: "coffee",
    hasFloor: true,
    defaultTables: 6,
    starterMenu: "Café starter menu",
  },
  {
    value: "qsr",
    label: "Quick service",
    hint: "Order at the counter, eat fast",
    icon: "hamburger",
    hasFloor: false,
    defaultTables: 0,
    starterMenu: "Quick-service starter menu",
  },
  {
    value: "foodtruck",
    label: "Food truck or stall",
    hint: "One window, no seating",
    icon: "truck",
    hasFloor: false,
    defaultTables: 0,
    starterMenu: "Short street-food menu",
  },
  {
    value: "restaurant",
    label: "Restaurant",
    hint: "Guests sit down and order at the table",
    icon: "silverware-fork-knife",
    hasFloor: true,
    defaultTables: 8,
    starterMenu: "Full restaurant menu",
  },
];

export const businessTypeDef = (value: BusinessType): BusinessTypeDef =>
  BUSINESS_TYPES.find((t) => t.value === value) ?? BUSINESS_TYPES[3];

/** Table counts offered as one-tap chips. Anything else is set later in Table
 *  Setup — a wizard that can express every number is a form, not a wizard. */
export const TABLE_CHOICES = [2, 4, 6, 8, 10, 12, 16, 20] as const;

export interface SummaryLine {
  icon: IconName;
  text: string;
}

/**
 * What the last card reports back. This is the payoff of the whole wizard:
 * setup that says nothing looks like setup that did nothing, so each answer
 * gets a line naming the thing it changed.
 */
export function describeSetup(
  answers: SetupAnswers,
  /** First run seeds a starter menu; a later change of answers does not, and
   *  must not claim to — the owner's real menu is already in there. */
  firstRun = true
): SummaryLine[] {
  const def = businessTypeDef(answers.businessType);
  const lines: SummaryLine[] = [];

  lines.push(
    answers.kotEnabled
      ? {
          icon: "pot-steam",
          text: "Kitchen tickets on — orders go to the kitchen display before they're billed",
        }
      : {
          icon: "receipt-text",
          text: "Quick billing — take the order and bill it in one go, no kitchen ticket",
        }
  );

  lines.push(
    answers.gstEnabled
      ? {
          icon: "percent",
          text: "GST on — bills add CGST + SGST at 5%",
        }
      : {
          icon: "percent-outline",
          text: "No GST — bills are the price of the food, nothing added",
        }
  );

  if (answers.tableCount === 0) {
    lines.push({
      icon: "counter",
      text: "Counter service — no table screen to work through",
    });
  } else if (firstRun) {
    lines.push({
      icon: "table-furniture",
      text: `${answers.tableCount} tables ready on your floor`,
    });
  } else {
    // A re-run sets only whether there IS a floor; the count belongs to the
    // floor that already exists, and Table Setup is what resizes it.
    lines.push({
      icon: "table-furniture",
      text: "Tables on — add or remove them in Account → Floor",
    });
  }

  if (firstRun) {
    lines.push({
      icon: "food",
      text: `${def.starterMenu} added — edit it, or replace it with your own`,
    });
  } else {
    // Deliberately "kept", not "untouched": a re-run does back-fill a
    // starter menu onto a restaurant that has none (see
    // `seedStarterMenuIfEmpty`), and this line has to stay true either way.
    lines.push({
      icon: "food",
      text: "Your menu is kept — this only changed how the app works",
    });
  }

  return lines;
}
