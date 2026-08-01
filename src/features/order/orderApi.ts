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
import type {
  Kot,
  KotItem,
  Order,
  OrderItem,
  OrderType,
} from "@/types/models";

/** First minted KOT ticket is this + 1 (i.e. #4001). */
const KOT_TICKET_SEED = 4000;

/** Σ price*qty over non-voided lines (paise) — reuses computeBill's subtotal. */
function subtotalOf(items: OrderItem[]): number {
  return computeBill(items.map((l) => ({ price: l.price, qty: l.qty, voided: l.voided })))
    .subtotal;
}

/** Build a fresh `pending` order line for a menu item (price snapshotted). */
export function newOrderLine(menuItemId: string, name: string, price: number): OrderItem {
  return {
    lineId: randomUUID(),
    menuItemId,
    name,
    price,
    qty: 1,
    notes: "",
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

/** Pure: merge one unit of a menu item into a line-set. Increments qty on an
 *  existing pending, note-less, un-voided line for the item, else appends a
 *  fresh line — same semantics as addOrCreateOrder's append path. */
export function mergeItemIntoLines(
  items: OrderItem[],
  menuItemId: string,
  name: string,
  price: number
): OrderItem[] {
  const idx = items.findIndex(
    (l) =>
      l.menuItemId === menuItemId &&
      l.kotStatus === "pending" &&
      !l.voided &&
      !l.notes
  );
  if (idx >= 0) {
    return items.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
  }
  return [...items, newOrderLine(menuItemId, name, price)];
}

/** Pure: set a pending line's qty; `qty <= 0` removes the line. */
export function setLineQtyInLines(
  items: OrderItem[],
  lineId: string,
  qty: number
): OrderItem[] {
  if (qty <= 0) return items.filter((l) => l.lineId !== lineId);
  return items.map((l) => (l.lineId === lineId ? { ...l, qty } : l));
}

/** Pure: set a line's special-instructions note. */
export function setLineNotesInLines(
  items: OrderItem[],
  lineId: string,
  notes: string
): OrderItem[] {
  return items.map((l) => (l.lineId === lineId ? { ...l, notes } : l));
}

/** Persist an order's full line-set (subtotal recomputed). Plain write —
 *  echoes into the local cache instantly. */
export function writeOrderItems(
  orderId: string,
  items: OrderItem[]
): Promise<void> {
  return updateDoc(paths.order(orderId), {
    items,
    subtotal: subtotalOf(items),
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
}): { orderId: string; items: OrderItem[]; commit: Promise<void> } {
  const { tableId, orderType, waiterId, menuItemId, name, price } = params;
  const newOrderRef = doc(paths.orders());
  const items = [newOrderLine(menuItemId, name, price)];

  const order: Omit<Order, "id"> = {
    tableId: tableId ?? null,
    orderType,
    waiterId,
    status: "open",
    items,
    subtotal: subtotalOf(items),
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
 *      (created at KOT_TICKET_SEED if missing, so the first ticket is #4001).
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
    tx.update(paths.order(orderId), {
      items,
      subtotal: subtotalOf(items),
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
