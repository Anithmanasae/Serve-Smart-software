/**
 * Live subscriptions for the cashier screen.
 */
import { useMemo } from "react";
import { limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData, useDocData } from "@/lib/firestore/useRealtime";
import type { Bill, Kot, Order, Table } from "@/types/models";

/** Bills awaiting the cashier: requested (by a waiter) or finalized (in progress). */
export function useActiveBills() {
  const q = useMemo(
    () =>
      query(paths.bills(), where("status", "in", ["requested", "finalized"])),
    []
  );
  return useCollectionData<Bill>(q);
}

/** How far back the settled-bill history looks. */
const HISTORY_WINDOW_DAYS = 30;

/**
 * Settled bills for the history screen, newest first. Only paid bills carry a
 * `paidAt` timestamp, so a range on that single field selects exactly them
 * without needing a composite index (unlike status == 'paid' + orderBy).
 * Capped to the last 30 days / 200 docs so the subscription stays bounded.
 */
export function usePaidBills() {
  const q = useMemo(() => {
    const since = Timestamp.fromMillis(
      Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    return query(
      paths.bills(),
      where("paidAt", ">", since),
      orderBy("paidAt", "desc"),
      limit(200)
    );
  }, []);
  return useCollectionData<Bill>(q);
}

/** KOT statuses that mean the kitchen is still working on a ticket. */
export const ACTIVE_KOT_STATUSES = ["new", "preparing", "ready"] as const;

/**
 * Is this order ready to bill?
 *   - at least one line was actually sent to the kitchen (has a kotId), AND
 *   - no line is still waiting to be sent (`pending` — billing it would charge
 *     for food the kitchen never saw), AND
 *   - dine-in only ("food first, pay after"): none of the order's tickets are
 *     still new/preparing/ready. Takeaway/delivery is pay-first at the
 *     counter, so it's billable as soon as its ticket is fired.
 *
 * Derived entirely from the live order lines + live kot docs — the kitchen
 * never writes to orders (rules only let it change kot status/printedCount).
 * Mirrors `assertKitchenDone` in cashierApi (the write-path backstop).
 */
export function isKitchenDone(
  order: Order,
  orderIdsWithActiveKots: ReadonlySet<string>
): boolean {
  const lines = order.items.filter((i) => !i.voided && i.qty > 0);
  const hasSent = lines.some((i) => i.kotId !== null);
  const hasUnsent = lines.some((i) => i.kotStatus === "pending");
  if (!hasSent || hasUnsent) return false;
  if (order.orderType !== "dine-in") return true;
  return !orderIdsWithActiveKots.has(order.id);
}

/**
 * Open, un-billed orders split by kitchen progress.
 *
 * `data` ("ready to bill") contains ONLY kitchen-done orders; `preparing`
 * holds the rest so the UI can show them greyed out. Both come from live
 * subscriptions, so when a waiter sends a new round for an already-completed
 * order, its fresh `new` ticket re-appears in the active-kots set and the
 * order automatically drops back from `data` into `preparing` until the
 * kitchen completes that ticket too.
 */
export function useBillableOrders() {
  const ordersQ = useMemo(
    () => query(paths.orders(), where("status", "==", "open")),
    []
  );
  // Only non-completed tickets — bounded set (the live board), unlike the
  // ever-growing history of completed kots.
  const kotsQ = useMemo(
    () => query(paths.kots(), where("status", "in", [...ACTIVE_KOT_STATUSES])),
    []
  );
  const orders = useCollectionData<Order>(ordersQ);
  const kots = useCollectionData<Kot>(kotsQ);

  return useMemo(() => {
    const open = orders.data.filter(
      (o) => !o.billId && o.items.some((i) => !i.voided)
    );
    const activeKotOrderIds = new Set(kots.data.map((k) => k.orderId));
    return {
      data: open.filter((o) => isKitchenDone(o, activeKotOrderIds)),
      preparing: open.filter((o) => !isKitchenDone(o, activeKotOrderIds)),
      loading: orders.loading || kots.loading,
      error: orders.error ?? kots.error,
    };
  }, [orders, kots]);
}

export function useAllTables() {
  const q = useMemo(() => paths.tables(), []);
  return useCollectionData<Table>(q);
}

export function useBill(billId: string | null) {
  const ref = useMemo(() => (billId ? paths.bill(billId) : null), [billId]);
  return useDocData<Bill>(ref);
}

export function useOrder(orderId: string | null) {
  const ref = useMemo(() => (orderId ? paths.order(orderId) : null), [orderId]);
  return useDocData<Order>(ref);
}
