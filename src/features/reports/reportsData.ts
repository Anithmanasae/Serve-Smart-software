/**
 * Reports / Insights — data subscription + pure aggregation helpers.
 *
 * All money is integer paise. Aggregation functions are pure and side-effect
 * free so they can be unit tested without Firestore. The live subscription
 * fetches the `dailySummaries` collection and filters client-side by the
 * `date` string (yyyy-mm-dd), which keeps the query composite-index free
 * regardless of how many days a range spans.
 */
import { useMemo } from "react";
import { query, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import { dayKey } from "@/lib/date";
import type {
  DailySummary,
  OrderType,
  PaymentMode,
} from "@/types/models";

// ─────────────────────────────────────────────────────────────────────────────
// Range model
// ─────────────────────────────────────────────────────────────────────────────

export type RangeKind = "today" | "week" | "month";

export interface DateRange {
  /** Inclusive first day key (yyyy-mm-dd). */
  start: string;
  /** Inclusive last day key (yyyy-mm-dd). */
  end: string;
  /** Every day key in the range, ascending. */
  keys: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a range of day keys ending at `end` and spanning `days` days. */
function rangeEndingAt(end: Date, days: number): DateRange {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(dayKey(new Date(end.getTime() - i * DAY_MS)));
  }
  return { start: keys[0], end: keys[keys.length - 1], keys };
}

/** Number of days each range kind spans. */
export function rangeLength(kind: RangeKind): number {
  switch (kind) {
    case "today":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
  }
}

/** The current range for the selected kind, ending today. */
export function currentRange(kind: RangeKind, now: Date = new Date()): DateRange {
  return rangeEndingAt(now, rangeLength(kind));
}

/**
 * The previous equivalent period (immediately before the current range),
 * used for delta comparisons. For a 7-day week ending today, this is the
 * 7 days before the current range's start.
 */
export function previousRange(kind: RangeKind, now: Date = new Date()): DateRange {
  const len = rangeLength(kind);
  const prevEnd = new Date(now.getTime() - len * DAY_MS);
  return rangeEndingAt(prevEnd, len);
}

// ─────────────────────────────────────────────────────────────────────────────
// Live subscription
// ─────────────────────────────────────────────────────────────────────────────

export type DailySummaryDoc = DailySummary & { id: string };

/**
 * Subscribe to all daily summaries at/after `sinceKey`. Uses a single-field
 * `date >=` filter (no composite index required). Callers slice out the exact
 * days they need with {@link summariesForKeys}.
 */
export function useDailySummaries(sinceKey: string) {
  const q = useMemo(
    () => query(paths.dailySummaries(), where("date", ">=", sinceKey)),
    [sinceKey]
  );
  return useCollectionData<DailySummary>(q);
}

/** Filter a summary list down to the exact set of day keys, ascending. */
export function summariesForKeys(
  summaries: DailySummaryDoc[],
  keys: string[]
): DailySummaryDoc[] {
  const set = new Set(keys);
  return summaries
    .filter((s) => set.has(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregation
// ─────────────────────────────────────────────────────────────────────────────

export interface Totals {
  totalRevenue: number; // paise
  orderCount: number;
  voidedItemCount: number;
  avgOrderValue: number; // paise; 0 when no orders
}

/** Sum the headline metrics across a set of summaries. */
export function sumTotals(summaries: DailySummary[]): Totals {
  let totalRevenue = 0;
  let orderCount = 0;
  let voidedItemCount = 0;
  for (const s of summaries) {
    totalRevenue += s.totalRevenue ?? 0;
    orderCount += s.orderCount ?? 0;
    voidedItemCount += s.voidedItemCount ?? 0;
  }
  const avgOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;
  return { totalRevenue, orderCount, voidedItemCount, avgOrderValue };
}

export type DeltaDirection = "up" | "down" | "neutral";

export interface Delta {
  /** Signed percentage change vs. previous period. 0 when no baseline. */
  percent: number;
  direction: DeltaDirection;
}

/** Percentage delta of `current` vs `previous`. */
export function computeDelta(current: number, previous: number): Delta {
  if (previous === 0) {
    if (current === 0) return { percent: 0, direction: "neutral" };
    // No baseline to divide by — treat any positive value as a full gain.
    return { percent: 100, direction: "up" };
  }
  const percent = ((current - previous) / previous) * 100;
  const direction: DeltaDirection =
    percent > 0.05 ? "up" : percent < -0.05 ? "down" : "neutral";
  return { percent, direction };
}

/** Per-day revenue series for the chart, ordered to match `keys`. */
export interface RevenuePoint {
  date: string; // yyyy-mm-dd
  revenue: number; // paise
}

export function revenueSeries(
  summaries: DailySummaryDoc[],
  keys: string[]
): RevenuePoint[] {
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  return keys.map((date) => ({
    date,
    revenue: byDate.get(date)?.totalRevenue ?? 0,
  }));
}

export interface ItemStat {
  menuItemId: string;
  name: string;
  qty: number;
  revenue: number; // paise
}

/** Aggregate `itemSales` across summaries, ranked by qty desc (revenue tiebreak). */
export function topItems(summaries: DailySummary[]): ItemStat[] {
  const acc = new Map<string, ItemStat>();
  for (const s of summaries) {
    for (const [menuItemId, sale] of Object.entries(s.itemSales ?? {})) {
      const prev = acc.get(menuItemId);
      if (prev) {
        prev.qty += sale.qty;
        prev.revenue += sale.revenue;
      } else {
        acc.set(menuItemId, {
          menuItemId,
          name: sale.name,
          qty: sale.qty,
          revenue: sale.revenue,
        });
      }
    }
  }
  return [...acc.values()].sort(
    (a, b) => b.qty - a.qty || b.revenue - a.revenue
  );
}

/** Sum revenue by order source across summaries. */
export function sourceSummary(
  summaries: DailySummary[]
): Record<OrderType, number> {
  const out: Record<OrderType, number> = {
    "dine-in": 0,
    takeaway: 0,
    delivery: 0,
  };
  for (const s of summaries) {
    for (const key of Object.keys(out) as OrderType[]) {
      out[key] += s.bySource?.[key] ?? 0;
    }
  }
  return out;
}

/** Sum revenue by payment mode across summaries. */
export function paymentSummary(
  summaries: DailySummary[]
): Record<PaymentMode, number> {
  const out: Record<PaymentMode, number> = { cash: 0, upi: 0, card: 0 };
  for (const s of summaries) {
    for (const key of Object.keys(out) as PaymentMode[]) {
      out[key] += s.byPaymentMode?.[key] ?? 0;
    }
  }
  return out;
}
