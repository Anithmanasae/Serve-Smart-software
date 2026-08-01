/**
 * Firestore write helpers for the Table Management module.
 *
 * Every mutation goes through `paths` (never a hand-built path) and uses
 * transactions/batches when several documents change together, so table
 * status + order docs never drift out of sync.
 */
import {
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { paths } from "@/lib/firestore/paths";
import type { Order, OrderItem, Table } from "@/types/models";

/**
 * Open a table: create a fresh open dine-in order and flip the table to
 * "occupied". Both writes happen atomically. Returns the new order id.
 *
 * If the table already has a current order, that order id is returned
 * unchanged (idempotent — avoids orphaning an existing order).
 */
export async function openTable(
  tableId: string,
  waiterId: string
): Promise<string> {
  const newOrderRef = doc(paths.orders());

  const orderId = await runTransaction(db, async (tx) => {
    const tableSnap = await tx.get(paths.table(tableId));
    if (!tableSnap.exists()) {
      throw new Error(`Table ${tableId} not found`);
    }
    const table = tableSnap.data();

    // Already occupied with a live order — reuse it.
    if (table.currentOrderId) {
      return table.currentOrderId;
    }

    const order: Omit<Order, "id"> = {
      tableId,
      orderType: "dine-in",
      waiterId,
      status: "open",
      items: [],
      subtotal: 0,
      billId: null,
      // serverTimestamp() resolves server-side; typed as Ts (Timestamp | null).
      createdAt: serverTimestamp() as unknown as Order["createdAt"],
      updatedAt: serverTimestamp() as unknown as Order["updatedAt"],
    };
    tx.set(newOrderRef, order);

    tx.update(paths.table(tableId), {
      status: "occupied",
      currentOrderId: newOrderRef.id,
      updatedAt: serverTimestamp(),
    });

    return newOrderRef.id;
  });

  return orderId;
}

/**
 * Merge 2+ tables into a primary. Secondary tables get `mergedInto = primaryId`
 * and are cleared (their guests are now served on the primary's order).
 *
 * Kept intentionally simple: we point the secondaries at the primary and free
 * them; combining order line-items is handled on the order screen.
 */
export async function mergeTables(
  primaryId: string,
  secondaryIds: string[]
): Promise<void> {
  const others = secondaryIds.filter((id) => id !== primaryId);
  if (others.length === 0) return;

  const batch = writeBatch(db);
  for (const id of others) {
    batch.update(paths.table(id), {
      mergedInto: primaryId,
      status: "occupied",
      currentOrderId: null,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/**
 * Split a table: move selected order lines onto a brand-new order attached to a
 * free target table. Both orders' subtotals are recomputed from their lines.
 *
 * Minimal-but-correct version: the source order keeps the remaining lines; the
 * moved lines start a new open order on the target table (marked occupied).
 */
export async function splitTable(
  sourceOrderId: string,
  targetTableId: string,
  lineIdsToMove: string[],
  waiterId: string
): Promise<string> {
  const moveSet = new Set(lineIdsToMove);
  const newOrderRef = doc(paths.orders());

  await runTransaction(db, async (tx) => {
    const srcSnap = await tx.get(paths.order(sourceOrderId));
    if (!srcSnap.exists()) throw new Error(`Order ${sourceOrderId} not found`);
    const src = srcSnap.data();

    const targetSnap = await tx.get(paths.table(targetTableId));
    if (!targetSnap.exists()) {
      throw new Error(`Table ${targetTableId} not found`);
    }
    if (targetSnap.data().currentOrderId) {
      throw new Error("Target table is not free");
    }

    const moved: OrderItem[] = src.items.filter((l) => moveSet.has(l.lineId));
    const remaining: OrderItem[] = src.items.filter(
      (l) => !moveSet.has(l.lineId)
    );
    if (moved.length === 0) throw new Error("No lines selected to move");

    // Recompute subtotals from the split line-sets (non-voided only).
    const remainingSubtotal = subtotalOf(remaining);
    const movedSubtotal = subtotalOf(moved);

    tx.update(paths.order(sourceOrderId), {
      items: remaining,
      subtotal: remainingSubtotal,
      updatedAt: serverTimestamp(),
    });

    const newOrder: Omit<Order, "id"> = {
      tableId: targetTableId,
      orderType: src.orderType,
      waiterId,
      status: "open",
      items: moved,
      subtotal: movedSubtotal,
      billId: null,
      createdAt: serverTimestamp() as unknown as Order["createdAt"],
      updatedAt: serverTimestamp() as unknown as Order["updatedAt"],
    };
    tx.set(newOrderRef, newOrder);

    tx.update(paths.table(targetTableId), {
      status: "occupied",
      currentOrderId: newOrderRef.id,
      updatedAt: serverTimestamp(),
    });
  });

  return newOrderRef.id;
}

/**
 * Shift an order from one table to another free table. Reassigns the order's
 * `tableId`, frees the source table, and occupies the target — atomically.
 */
export async function shiftTable(
  orderId: string,
  fromTableId: string,
  toTableId: string
): Promise<void> {
  if (fromTableId === toTableId) return;

  await runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(paths.order(orderId));
    if (!orderSnap.exists()) throw new Error(`Order ${orderId} not found`);

    const toSnap = await tx.get(paths.table(toTableId));
    if (!toSnap.exists()) throw new Error(`Table ${toTableId} not found`);
    if (toSnap.data().currentOrderId) {
      throw new Error("Target table is not free");
    }

    const status = orderSnap.data().status;

    tx.update(paths.order(orderId), {
      tableId: toTableId,
      updatedAt: serverTimestamp(),
    });

    tx.update(paths.table(fromTableId), {
      status: "available",
      currentOrderId: null,
      updatedAt: serverTimestamp(),
    });

    tx.update(paths.table(toTableId), {
      // Preserve billed state if the order was already billed.
      status: status === "billed" ? "billed" : "occupied",
      currentOrderId: orderId,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Close a table back to "available" once its order is settled. Clears the
 * current order pointer and any merge link. The order itself is closed
 * elsewhere (cashier module); here we just free the floor slot.
 */
export async function closeTable(tableId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(paths.table(tableId), {
    status: "available",
    currentOrderId: null,
    mergedInto: null,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** Default seats for a table the cashier adds from the count setter. */
const DEFAULT_CAPACITY = 4;

/** A table is safe to remove only when nobody is seated at it. */
function isFree(t: Table): boolean {
  return t.status === "available" && !t.currentOrderId && !t.mergedInto;
}

/**
 * Grow or shrink the floor to exactly `target` tables (owner/cashier setup).
 *
 * - Growing appends new tables numbered after the highest existing one, so
 *   existing tables (and their live orders) are never touched.
 * - Shrinking removes the highest-numbered FREE tables first. Occupied/billed
 *   or merged tables are left in place; if that means the target can't be
 *   reached, we remove as many as we safely can and throw so the UI can tell
 *   the cashier to clear those tables first.
 *
 * Returns the resulting table count.
 */
export async function setTableCount(
  tables: (Table & { id: string })[],
  target: number,
): Promise<number> {
  const desired = Math.floor(target);
  if (!Number.isFinite(desired) || desired < 0 || desired > 200) {
    throw new Error("Enter a table count between 0 and 200.");
  }

  const current = tables.length;
  if (desired === current) return current;

  const batch = writeBatch(db);

  if (desired > current) {
    // Continue numbering after the current highest table number.
    let next = tables.reduce((max, t) => Math.max(max, t.number), 0) + 1;
    for (let i = current; i < desired; i++, next++) {
      const tableRef = doc(paths.tables());
      batch.set(tableRef, {
        id: tableRef.id,
        number: next,
        label: `T${next}`,
        capacity: DEFAULT_CAPACITY,
        status: "available",
        currentOrderId: null,
        mergedInto: null,
        updatedAt: serverTimestamp() as unknown as Table["updatedAt"],
      });
    }
    await batch.commit();
    return desired;
  }

  // Shrinking: drop the highest-numbered free tables first.
  const removable = tables
    .filter(isFree)
    .sort((a, b) => b.number - a.number);
  const toRemove = current - desired;
  const removing = removable.slice(0, toRemove);
  for (const t of removing) batch.delete(paths.table(t.id));
  await batch.commit();

  const remaining = current - removing.length;
  if (removing.length < toRemove) {
    throw new Error(
      `Removed ${removing.length} free table(s). ${remaining - desired} table(s) ` +
        "are still in use — clear or bill them, then try again.",
    );
  }
  return remaining;
}

/** Σ price*qty over non-voided lines (paise). Mirrors money.ts's subtotal. */
function subtotalOf(items: OrderItem[]): number {
  return items
    .filter((l) => !l.voided)
    .reduce((sum, l) => sum + l.price * l.qty, 0);
}
