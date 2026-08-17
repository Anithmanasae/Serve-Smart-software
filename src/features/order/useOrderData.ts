/**
 * Live data hooks for the Waiter Order screen — thin wrappers over the generic
 * realtime hooks so the screen always renders current data (never polled).
 */
import { useMemo } from "react";
import { orderBy, query, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData, useDocData } from "@/lib/firestore/useRealtime";
import type { Kot, MenuCategory, MenuItem, Order, Table } from "@/types/models";

/** Enabled categories, ordered by sortOrder (ascending). */
export function useMenuCategories() {
  const q = useMemo(
    () => query(paths.menuCategories(), orderBy("sortOrder", "asc")),
    []
  );
  return useCollectionData<MenuCategory>(q);
}

/** All menu items, ordered by name. */
export function useMenuItems() {
  const q = useMemo(() => query(paths.menuItems(), orderBy("name", "asc")), []);
  return useCollectionData<MenuItem>(q);
}

/** Subscribe to a single table (for its label + currentOrderId). */
export function useTable(tableId: string | null) {
  const ref = useMemo(
    () => (tableId ? paths.table(tableId) : null),
    [tableId]
  );
  return useDocData<Table>(ref);
}

/**
 * Resolve the active OPEN order for a table.
 *
 * Query the orders collection for `tableId == && status == "open"` and
 * subscribe live. Returns the first match (there should only be one open order
 * per table at a time). Requires a composite index on (tableId, status).
 */
export function useOpenOrderForTable(tableId: string | null) {
  const q = useMemo(
    () =>
      tableId
        ? query(
            paths.orders(),
            where("tableId", "==", tableId),
            where("status", "==", "open")
          )
        : null,
    [tableId]
  );
  const state = useCollectionData<Order>(q);
  return {
    ...state,
    order: state.data[0] ?? null,
  };
}

/**
 * The takeaway order this user walked away from, if there is one.
 *
 * A dine-in order is found again through its table; a takeaway order has no
 * table, so its id lives only in Order screen state. Anything that tears that
 * screen down — the app being killed mid-bill, a tab switch, a reload — used
 * to leave the order (and any bill already generated for it) open in Firestore
 * with nothing on screen pointing at it. This is how the counter finds it.
 *
 * `billed` is in the filter deliberately: `generateBill` moves the order out
 * of `open`, so the half-settled counter order — the one actually worth
 * resuming — is the one a `status == "open"` query would miss. `closed` and
 * `cancelled` are finished business and stay out.
 *
 * Scoped to the caller's OWN orders: two tablets taking takeaway at the same
 * time must never adopt each other's cart. Runs on the (tableId, status)
 * index; `orderType` and `waiterId` are narrowed here rather than in the query
 * so no new composite index is needed.
 */
export function useResumableTakeawayOrder(waiterId: string | null) {
  const q = useMemo(
    () =>
      waiterId
        ? query(
            paths.orders(),
            where("tableId", "==", null),
            where("status", "in", ["open", "billed"])
          )
        : null,
    [waiterId]
  );
  const state = useCollectionData<Order>(q);
  const order = useMemo(() => {
    const mine = state.data.filter(
      (o) =>
        o.orderType === "takeaway" &&
        o.waiterId === waiterId &&
        (o.items?.length ?? 0) > 0
    );
    // Newest first: if service left more than one behind, the live one at the
    // counter is the last one started. A serverTimestamp still in flight has
    // no millis yet, but such an order was minted by this very screen and is
    // never the one being resumed.
    mine.sort(
      (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );
    return mine[0] ?? null;
  }, [state.data, waiterId]);
  return { ...state, order };
}

/** Subscribe to a single order doc by id. */
export function useOrder(orderId: string | null) {
  const ref = useMemo(
    () => (orderId ? paths.order(orderId) : null),
    [orderId]
  );
  return useDocData<Order>(ref);
}

/**
 * Subscribe to every KOT belonging to an order, so the screen can mirror
 * kitchen status back onto the order lines. Requires an index on `orderId`.
 */
export function useKotsForOrder(orderId: string | null) {
  const q = useMemo(
    () => (orderId ? query(paths.kots(), where("orderId", "==", orderId)) : null),
    [orderId]
  );
  return useCollectionData<Kot>(q);
}
