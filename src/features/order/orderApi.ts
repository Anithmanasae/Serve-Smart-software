/**
 * Firestore write helpers for the Waiter Order + KOT module.
 *
 * Every mutation goes through `paths` (never a hand-built path). Writes that
 * touch several documents at once (order + table, or counter + kot + order)
 * run inside a transaction/batch so the docs never drift out of sync.
 *
 * Money is integer paise everywhere; the order subtotal is recomputed from the
 * line-items on every write via money.ts's rule (Σ price*qty for non-voided).
 */
import {
  Timestamp,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  waitForPendingWrites,
  writeBatch,
} from "firebase/firestore";
import { randomUUID } from "expo-crypto";
import { db } from "@/lib/firebase";
import { paths } from "@/lib/firestore/paths";
import { computeBill } from "@/lib/money";
import { applyOffers, totalOfferDiscount } from "@/lib/offers";
import { composeLineName } from "@/features/menu/variants";
import type {
  Kot,
  KotItem,
  Offer,
  Order,
  OrderItem,
  OrderType,
} from "@/types/models";

/**
 * First minted KOT ticket is this + 1 — so a new restaurant's first ticket is
 * KOT 1.
 *
 * A KOT number is spoken across a kitchen ("where's 7?"), so it wants to be
 * the shortest number that still identifies one ticket. It counts up forever
 * rather than resetting nightly: a ticket outlives the day it was fired (the
 * reprint, the bill it feeds, the audit), and two different tickets both
 * called "KOT 1" would make that history ambiguous for the sake of a digit.
 */
const KOT_TICKET_SEED = 0;

/** Σ price*qty over non-voided lines (paise) — reuses computeBill's subtotal.
 *  GROSS of offers, matching `Order.subtotal`'s definition. */
function subtotalOf(items: OrderItem[]): number {
  return computeBill(items.map((l) => ({ price: l.price, qty: l.qty, voided: l.voided })))
    .subtotal;
}

/**
 * Everything the pricing engine needs, threaded through the line mutators.
 */
export interface PricingContext {
  offers: Offer[];
  /**
   * The moment the order's pricing is judged against — the order's OWN
   * `createdAt`, not the wall clock.
   *
   * This is what stops a tab losing its discount mid-meal. A party seated at
   * 6:50pm during a 4–7pm happy hour orders another round at 7:10; pricing
   * against "now" would silently re-rate the whole tab, including the drinks
   * already served and quoted. Freezing at the moment the order opened means
   * one rule the floor can actually say out loud: the deal you got when you sat
   * down applies to your table. The same choice keeps a long dinner from losing
   * a day-scoped promo when it crosses midnight.
   */
  at: Date;
}

/**
 * Re-price a line-set against the restaurant's offers.
 *
 * Called after EVERY mutation rather than only when a line is added, because a
 * quantity change can start or stop a quantity-based deal: dropping the third
 * coffee has to take the BOGO discount away again, and only a full re-run over
 * the whole set can see that.
 */
export function repriceLines(
  items: OrderItem[],
  ctx: PricingContext
): OrderItem[] {
  return applyOffers(items, ctx.offers, ctx.at);
}

/** The two derived money fields every order write must carry. */
function totalsOf(items: OrderItem[]): {
  subtotal: number;
  offerDiscount: number;
} {
  return {
    subtotal: subtotalOf(items),
    offerDiscount: totalOfferDiscount(items),
  };
}

/** The chosen priced option, when the dish had any. Snapshotted onto the line
 *  so renaming or repricing it later never rewrites an order. */
export interface LineVariant {
  id: string;
  name: string;
}

/** Everything one add needs. `price` is what will actually be CHARGED per
 *  unit — the variant's price when `variant` is set, the item's otherwise;
 *  the caller resolves that, because only it knows which option was tapped. */
export interface AddLineSpec {
  menuItemId: string;
  /** The dish's own name. The variant is appended by `composeLineName`. */
  name: string;
  price: number;
  categoryId?: string;
  variant?: LineVariant;
  /** Defaults to 1. The Customize sheet commits its whole stepper at once. */
  qty?: number;
  notes?: string;
}

/** Build a fresh `pending` order line for a menu item (price snapshotted).
 *  `categoryId` is snapshotted alongside the price so category-scoped offers
 *  can be applied from the order alone, with no menu lookup. */
export function newOrderLine(
  menuItemId: string,
  name: string,
  price: number,
  categoryId?: string,
  variant?: LineVariant,
  qty = 1,
  notes = ""
): OrderItem {
  return {
    lineId: randomUUID(),
    menuItemId,
    // Composed once, here. Every downstream reader — the KOT, the ESC/POS
    // ticket, the KDS card, the bill — prints `name` and so shows the chosen
    // option without knowing variants exist.
    name: composeLineName(name, variant?.name),
    price,
    ...(categoryId ? { categoryId } : {}),
    ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
    qty,
    notes,
    kotStatus: "pending",
    kotId: null,
    voided: false,
    // Timestamp.now(), not serverTimestamp(): FieldValue sentinels are not
    // allowed inside array values, and `items` is an array field.
    addedAt: Timestamp.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency-compensated write path (waiter hot path).
//
// `runTransaction` always waits for a full server round-trip and is never
// echoed into the local cache, so a transactional add lags the UI by network
// latency on every tap — and fails outright when offline. The helpers below
// use plain document writes instead: the SDK applies them to the local cache
// immediately (live snapshots fire with `hasPendingWrites`), so the screen
// updates in the same frame and writes queue while offline.
//
// Trade-off: no read-modify-write guard — concurrent edits to the SAME order
// from two devices are last-write-wins on the items array. A table is worked
// from one waiter's device at a time, so that's acceptable for the floor flow;
// money-critical mutations (send KOT, billing) stay transactional.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pending, note-less, un-voided line a further tap of ＋ should land on —
 * or -1 for none.
 *
 * The VARIANT is part of the identity: a Chicken Burger and a Veg Burger are
 * two lines at two prices, and merging them would charge one price for both.
 * A line predating variants has no `variantId`, which correctly matches a
 * plain add and correctly misses a variant one.
 */
export function findMergeableLine(
  items: OrderItem[],
  menuItemId: string,
  variantId?: string
): number {
  return items.findIndex(
    (l) =>
      l.menuItemId === menuItemId &&
      (l.variantId ?? undefined) === variantId &&
      l.kotStatus === "pending" &&
      !l.voided &&
      !l.notes
  );
}

/**
 * Pure: add `qty` units of a dish to a line-set, then re-price against
 * `offers`.
 *
 * Merges onto a matching pending line where one exists, else appends. A spec
 * carrying `notes` ALWAYS appends: "no onions" is a different instruction to
 * the kitchen, so folding it into an existing line would silently change what
 * gets cooked for someone who did not ask for it.
 */
export function addLineToLines(
  items: OrderItem[],
  spec: AddLineSpec,
  ctx: PricingContext
): OrderItem[] {
  const qty = spec.qty ?? 1;
  const notes = spec.notes?.trim() ?? "";
  const idx = notes
    ? -1
    : findMergeableLine(items, spec.menuItemId, spec.variant?.id);
  const next =
    idx >= 0
      ? items.map((l, i) => (i === idx ? { ...l, qty: l.qty + qty } : l))
      : [
          ...items,
          newOrderLine(
            spec.menuItemId,
            spec.name,
            spec.price,
            spec.categoryId,
            spec.variant,
            qty,
            notes
          ),
        ];
  return repriceLines(next, ctx);
}

/** Pure: merge ONE unit of a menu item into a line-set, then re-price against
 *  `offers`. The plain ＋ path — `addLineToLines` with a qty of one. */
export function mergeItemIntoLines(
  items: OrderItem[],
  menuItemId: string,
  name: string,
  price: number,
  ctx: PricingContext,
  categoryId?: string,
  variant?: LineVariant
): OrderItem[] {
  return addLineToLines(
    items,
    { menuItemId, name, price, categoryId, variant },
    ctx
  );
}

/** Pure: set a pending line's qty; `qty <= 0` removes the line. Re-priced,
 *  because a quantity change can start or end a "buy N" deal. */
export function setLineQtyInLines(
  items: OrderItem[],
  lineId: string,
  qty: number,
  ctx: PricingContext
): OrderItem[] {
  const next =
    qty <= 0
      ? items.filter((l) => l.lineId !== lineId)
      : items.map((l) => (l.lineId === lineId ? { ...l, qty } : l));
  return repriceLines(next, ctx);
}

/** Pure: set a line's special-instructions note. A note splits nothing and
 *  changes no quantity, so the offer stamps carry over untouched. */
export function setLineNotesInLines(
  items: OrderItem[],
  lineId: string,
  notes: string
): OrderItem[] {
  return items.map((l) => (l.lineId === lineId ? { ...l, notes } : l));
}

/** Persist an order's full line-set (subtotal + offer total recomputed). Plain
 *  write — echoes into the local cache instantly. */
export function writeOrderItems(
  orderId: string,
  items: OrderItem[]
): Promise<void> {
  return updateDoc(paths.order(orderId), {
    items,
    ...totalsOf(items),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Create a brand-new order containing its first line and (dine-in) occupy the
 * table — one writeBatch, echoed into the local cache instantly. The order id
 * is minted client-side and returned synchronously so the caller can keep
 * editing before the server acknowledges.
 */
export function createOrderLocal(params: {
  tableId: string | null;
  orderType: OrderType;
  waiterId: string;
  menuItemId: string;
  name: string;
  price: number;
  categoryId?: string;
  variant?: LineVariant;
  qty?: number;
  notes?: string;
  offers?: Offer[];
}): { orderId: string; items: OrderItem[]; commit: Promise<void> } {
  const {
    tableId,
    orderType,
    waiterId,
    menuItemId,
    name,
    price,
    categoryId,
    variant,
    qty,
    notes,
    offers = [],
  } = params;
  const newOrderRef = doc(paths.orders());
  // Priced on creation, so a single-item order that already qualifies (a flat
  // or percent deal needs no second unit) shows its discount from the first
  // tap. This moment is also the one every later edit is re-priced against —
  // see PricingContext.at.
  const items = repriceLines(
    [
      newOrderLine(
        menuItemId,
        name,
        price,
        categoryId,
        variant,
        qty ?? 1,
        notes?.trim() ?? ""
      ),
    ],
    { offers, at: new Date() }
  );

  const order: Omit<Order, "id"> = {
    tableId: tableId ?? null,
    orderType,
    waiterId,
    status: "open",
    items,
    ...totalsOf(items),
    billId: null,
    createdAt: serverTimestamp() as unknown as Order["createdAt"],
    updatedAt: serverTimestamp() as unknown as Order["updatedAt"],
  };

  const batch = writeBatch(db);
  batch.set(newOrderRef, order);
  if (tableId) {
    batch.update(paths.table(tableId), {
      status: "occupied",
      currentOrderId: newOrderRef.id,
      updatedAt: serverTimestamp(),
    });
  }
  return { orderId: newOrderRef.id, items, commit: batch.commit() };
}

/** Resolve once every queued local write has been acknowledged by the server.
 *  Call before transactional ops (send KOT) whose server-side reads must see
 *  the latest local edits. */
export function flushPendingWrites(): Promise<void> {
  return waitForPendingWrites(db);
}

/**
 * Send all `pending` lines of an order to the kitchen as a new KOT ticket.
 *
 * Atomically (single runTransaction):
 *   1. Increment `counters/kotTicket` to mint a human ticket number
 *      (created at KOT_TICKET_SEED if missing, so the first ticket is #1).
 *   2. Create a new `Kot` (status "new", denormalized tableLabel/orderType,
 *      pending lines mapped to KotItem, printedCount 0).
 *   3. Flip those order lines to `kotStatus: "sent"` with their new `kotId`.
 *
 * Returns the new kot id, or null when there was nothing pending to send.
 */
export async function sendKot(
  orderId: string,
  tableLabel: string
): Promise<string | null> {
  const kotRef = doc(paths.kots());
  const counterRef = paths.counter("kotTicket");

  return runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(paths.order(orderId));
    if (!orderSnap.exists()) throw new Error(`Order ${orderId} not found`);
    const order = orderSnap.data();

    const pending = order.items.filter(
      (l) => l.kotStatus === "pending" && !l.voided && l.qty > 0
    );
    if (pending.length === 0) return null;

    // Mint the ticket number (all reads must precede writes in a transaction).
    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists() ? counterSnap.data().value : KOT_TICKET_SEED;
    const ticketNumber = current + 1;

    const kotItems: KotItem[] = pending.map((l) => ({
      lineId: l.lineId,
      menuItemId: l.menuItemId,
      name: l.name,
      qty: l.qty,
      notes: l.notes ?? "",
      voided: l.voided,
    }));

    const kot: Omit<Kot, "id"> = {
      orderId,
      tableId: order.tableId,
      tableLabel,
      orderType: order.orderType,
      ticketNumber,
      items: kotItems,
      status: "new",
      printedCount: 0,
      createdAt: serverTimestamp() as unknown as Kot["createdAt"],
      updatedAt: serverTimestamp() as unknown as Kot["updatedAt"],
    };

    // Writes.
    tx.set(counterRef, { value: ticketNumber });
    tx.set(kotRef, kot);

    const sentIds = new Set(pending.map((l) => l.lineId));
    const items = order.items.map((l) =>
      sentIds.has(l.lineId)
        ? { ...l, kotStatus: "sent" as const, kotId: kotRef.id }
        : l
    );
    // Offer stamps ride along untouched: sending to the kitchen only flips
    // kotStatus, and the KOT itself carries the real `qty` — a BOGO's free
    // unit is food that has to be cooked.
    tx.update(paths.order(orderId), {
      items,
      ...totalsOf(items),
      updatedAt: serverTimestamp(),
    });

    return kotRef.id;
  });
}

/** One-shot read of a kot doc — used to print the ticket sendKot just made. */
export async function fetchKot(kotId: string): Promise<Kot | null> {
  const snap = await getDoc(paths.kot(kotId));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}

/**
 * Reflect KDS progress back onto order lines. When a KOT's status changes in
 * the kitchen we mirror it onto every line that was sent on that ticket. Kept
 * as a batch so all line updates land together.
 *
 * `kotStatuses` maps kotId -> the per-line status to stamp (pending/sent/
 * preparing/ready/served). Returns true if the order doc was changed.
 */
export async function syncLineStatuses(
  orderId: string,
  kotStatuses: Map<string, OrderItem["kotStatus"]>
): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(paths.order(orderId));
    if (!snap.exists()) return false;

    let changed = false;
    const items = snap.data().items.map((l) => {
      if (!l.kotId) return l;
      const next = kotStatuses.get(l.kotId);
      if (next && next !== l.kotStatus) {
        changed = true;
        return { ...l, kotStatus: next };
      }
      return l;
    });

    if (!changed) return false;
    tx.update(paths.order(orderId), { items, updatedAt: serverTimestamp() });
    return true;
  });
}
