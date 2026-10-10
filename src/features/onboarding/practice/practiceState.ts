/**
 * THE PRACTICE RUN'S WORLD — one restaurant, in memory, for ninety seconds.
 *
 * Everything the run shows is built here and lives only in React state. There
 * is no Firestore read, no write, no rules involvement and no cleanup to get
 * wrong: closing the screen is what deletes it.
 *
 * ## Why a simulation rather than the real app
 *
 * The alternative was to drive the real screens and then undo the damage —
 * write a real order, a real ticket and a real bill, then remember to reverse
 * all three. That version is one dropped connection away from leaving a
 * phantom ₹180 in a restaurant's opening figures, and the owner's very first
 * experience of the numbers screen would be a number they cannot explain.
 * Nothing in this app is worth less than the trust in those figures.
 *
 * ## Why it is still the real app
 *
 * The screens are not mocked up. `TableCard`, `OrderMenuCard`,
 * `OrderLineRow`, `OrderCartPanel` and `TableTicketCard` are all prop-driven
 * and hook-free, so the run mounts the SAME components the live app draws,
 * against this state instead of a subscription. `computeBill` and
 * `applyOffers` are pure, so the practice bill is arithmetically identical to
 * a real one — same GST, same offer handling, same rounding — and the receipt
 * at the end is rendered by the same encoder that prints a real one.
 *
 * What the owner practises on is their OWN menu, at their own prices, in
 * their own configuration. The only thing that is not real is that none of it
 * is saved.
 */
import type {
  Kot,
  MenuItem,
  Order,
  OrderItem,
  OrderType,
  Table,
} from "@/types/models";

/** Which screen of the loop the run is standing on. */
export type PracticeStage =
  | "floor"
  | "order"
  | "kds"
  | "bills"
  | "receipt";

export interface PracticeState {
  stage: PracticeStage;
  /** The floor. Empty for a counter business — it never shows a floor stage. */
  tables: PracticeTable[];
  /** The table the run is working (null before it is picked / counter mode). */
  activeTableId: string | null;
  lines: OrderItem[];
  /**
   * How many lines this run has ever opened — the source of the next
   * `lineId`. Counted rather than read off `lines.length`, because a removed
   * line shortens the list and the next dish would then be handed an id a
   * line still in the cart already holds: two rows, one key, and a stepper
   * on either changing both.
   */
  lineSeq: number;
  kot: PracticeKot | null;
  /**
   * The cart sheet is up.
   *
   * A phone has no room for the cart pane, so the real order screen collapses
   * it to a bar that opens a sheet — and the Send-KOT button lives INSIDE
   * that sheet. Opening it is therefore a step the owner has to be taught,
   * not a detail of this simulation.
   */
  cartOpen: boolean;
  /** Set once the bill is settled — the run's last real event. */
  paidAt: number | null;
  paymentLabel: string | null;
}

export type PracticeTable = Table & { id: string };
export type PracticeKot = Kot & { id: string };

/** How many tables the practice floor shows. Enough to look like a floor,
 *  few enough that the one being pointed at is obvious. */
const PRACTICE_TABLES = 6;
/** The table the run always uses. Second row, so the spotlight has to move —
 *  a target already under the caption teaches nothing about finding one. */
const PRACTICE_TABLE_INDEX = 3;

/** A timestamp shaped like Firestore's, for components that call `toMillis`. */
function stamp(at = Date.now()) {
  return {
    toMillis: () => at,
    toDate: () => new Date(at),
    seconds: Math.floor(at / 1000),
    nanoseconds: 0,
  } as unknown as Table["updatedAt"];
}

export function practiceTableLabel(state: PracticeState): string {
  const t = state.tables.find((x) => x.id === state.activeTableId);
  return t?.label ?? (state.tables.length > 0 ? "T4" : "Takeaway");
}

export const PRACTICE_ORDER_ID = "practice-order";
export const PRACTICE_TABLE_ID = `practice-t${PRACTICE_TABLE_INDEX + 1}`;

export function initialPracticeState(tablesEnabled: boolean): PracticeState {
  return {
    stage: tablesEnabled ? "floor" : "order",
    tables: tablesEnabled ? buildFloor() : [],
    activeTableId: null,
    lines: [],
    lineSeq: 0,
    kot: null,
    cartOpen: false,
    paidAt: null,
    paymentLabel: null,
  };
}

function buildFloor(): PracticeTable[] {
  return Array.from({ length: PRACTICE_TABLES }, (_, i) => {
    const n = i + 1;
    return {
      id: `practice-t${n}`,
      number: n,
      label: `T${n}`,
      capacity: 4,
      status: "available",
      currentOrderId: null,
      mergedInto: null,
      updatedAt: stamp(),
    } satisfies PracticeTable;
  });
}

// ── the events the run can produce ───────────────────────────────────────────
//
// Deliberately named for what the OWNER did, not for what changes. Every one
// of them is something they tapped on a real component; there is no "next"
// and no event this file can raise by itself.

export type PracticeEvent =
  | { type: "pickTable"; tableId: string }
  | { type: "addDish"; item: MenuItem }
  | { type: "setQty"; lineId: string; qty: number }
  // Takes the DISH, not the line, so the grid's minus button needs no
  // knowledge of the current lines — which is what lets its handler keep a
  // stable identity and `OrderMenuCard`'s `memo` keep working. See the note
  // in `PracticeRun`.
  | { type: "decrementDish"; menuItemId: string }
  | { type: "openCart" }
  | { type: "closeCart" }
  | { type: "sendKot" }
  | { type: "kdsComplete" }
  | { type: "openBills" }
  | { type: "settle"; paymentLabel: string }
  | { type: "reset"; tablesEnabled: boolean };

export function practiceReducer(
  state: PracticeState,
  event: PracticeEvent
): PracticeState {
  switch (event.type) {
    case "reset":
      return initialPracticeState(event.tablesEnabled);

    case "pickTable":
      return {
        ...state,
        stage: "order",
        activeTableId: event.tableId,
        tables: state.tables.map((t) =>
          t.id === event.tableId
            ? { ...t, status: "occupied", currentOrderId: PRACTICE_ORDER_ID }
            : t
        ),
      };

    case "addDish": {
      // Same rule the real order screen uses: a repeat of the same dish (and
      // the same variant) grows the existing line rather than opening a
      // second one, so the cart the owner learns here is the cart they get.
      const existing = state.lines.find(
        (l) => l.menuItemId === event.item.id && l.kotStatus === "pending"
      );
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((l) =>
            l.lineId === existing.lineId ? { ...l, qty: l.qty + 1 } : l
          ),
        };
      }
      return {
        ...state,
        lineSeq: state.lineSeq + 1,
        lines: [
          ...state.lines,
          {
            lineId: `practice-line-${state.lineSeq + 1}`,
            menuItemId: event.item.id,
            name: event.item.name,
            price: event.item.price,
            categoryId: event.item.categoryId,
            qty: 1,
            kotStatus: "pending",
            kotId: null,
            voided: false,
            addedAt: stamp(),
          },
        ],
      };
    }

    case "setQty":
      return {
        ...state,
        lines: state.lines
          .map((l) =>
            l.lineId === event.lineId ? { ...l, qty: event.qty } : l
          )
          .filter((l) => l.qty > 0),
      };

    // Also returns to the order stage, because the cart only exists there.
    // The kitchen hands a counter order back to the cart it came from — that
    // is where `canBillHere` puts the Generate Bill button — so this is the
    // way back as well as the way open. On a tablet the pane is permanently
    // on screen and `cartOpen` is simply ignored.
    case "decrementDish": {
      const line = [...state.lines]
        .reverse()
        .find((l) => l.menuItemId === event.menuItemId);
      if (!line) return state;
      return {
        ...state,
        lines: state.lines
          .map((l) =>
            l.lineId === line.lineId ? { ...l, qty: l.qty - 1 } : l
          )
          .filter((l) => l.qty > 0),
      };
    }

    case "openCart":
      return { ...state, stage: "order", cartOpen: true };

    case "closeCart":
      return { ...state, cartOpen: false };

    case "sendKot": {
      if (state.lines.length === 0) return state;
      const tableLabel = practiceTableLabel(state);
      const orderType: OrderType = state.tables.length > 0
        ? "dine-in"
        : "takeaway";
      return {
        ...state,
        stage: "kds",
        cartOpen: false,
        lines: state.lines.map((l) => ({
          ...l,
          kotStatus: "sent",
          kotId: "practice-kot",
        })),
        kot: {
          id: "practice-kot",
          orderId: PRACTICE_ORDER_ID,
          tableId: state.activeTableId,
          tableLabel,
          orderType,
          // #1: on a first run it genuinely would be, and on a replay from
          // Account it is plainly the practice ticket rather than one of
          // theirs. A padded number to look busier would be the one
          // dishonest thing on an otherwise real screen.
          ticketNumber: 1,
          items: state.lines.map((l) => ({
            lineId: l.lineId,
            menuItemId: l.menuItemId,
            name: l.name,
            qty: l.qty,
            voided: false,
          })),
          status: "new",
          printedCount: 0,
          createdAt: stamp(),
          updatedAt: stamp(),
        },
      };
    }

    case "kdsComplete":
      return state.kot
        ? {
            ...state,
            kot: { ...state.kot, status: "completed" },
            lines: state.lines.map((l) => ({ ...l, kotStatus: "served" })),
          }
        : state;

    case "openBills":
      return { ...state, stage: "bills", cartOpen: false };

    case "settle":
      return {
        ...state,
        stage: "receipt",
        paidAt: Date.now(),
        paymentLabel: event.paymentLabel,
        tables: state.tables.map((t) =>
          t.id === state.activeTableId
            ? { ...t, status: "available", currentOrderId: null }
            : t
        ),
      };

    default:
      return state;
  }
}

/** The order document the cart panel and the receipt read. Derived, never
 *  stored — one less thing that can disagree with `lines`. */
export function practiceOrder(state: PracticeState): Order & { id: string } {
  return {
    id: PRACTICE_ORDER_ID,
    tableId: state.activeTableId,
    tableLabel: practiceTableLabel(state),
    orderType: state.tables.length > 0 ? "dine-in" : "takeaway",
    items: state.lines,
    status: state.paidAt ? "closed" : "open",
    billId: state.paidAt ? "practice-bill" : null,
    createdBy: "practice",
    createdAt: stamp(),
    updatedAt: stamp(),
  } as unknown as Order & { id: string };
}
