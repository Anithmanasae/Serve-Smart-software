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
import {
  NC_REASONS,
  type DailySummary,
  type NcReason,
  type OrderType,
  type PaymentMode,
} from "@/types/models";

// ─────────────────────────────────────────────────────────────────────────────
// Range model
// ─────────────────────────────────────────────────────────────────────────────

/** The fixed, relative-to-today ranges offered as one-tap chips. */
export type PresetKind = "today" | "week" | "month";
/** Everything the range selector can be set to. */
export type RangeKind = PresetKind | "custom";

export interface DateRange {
  /** Inclusive first day key (yyyy-mm-dd). */
  start: string;
  /** Inclusive last day key (yyyy-mm-dd). */
  end: string;
  /** Every day key in the range, ascending. */
  keys: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Longest custom range we will subscribe to. The subscription also streams the
 * preceding period (for deltas), so the real ceiling is 2× this many summary
 * documents — and each one carries a full `itemSales` map.
 */
export const MAX_RANGE_DAYS = 366;

/**
 * Day-key arithmetic is done in UTC on purpose. A key is a *label* for a
 * business day, not an instant: once `dayKey` has picked today's label (in
 * IST), stepping backwards through the calendar is pure integer maths and must
 * not be re-interpreted against any timezone or DST rule.
 */
function keyToUTC(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  const dt = new Date(ms);
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${m}-${d}`;
}

/** The day key `days` after `key` (negative for earlier). */
export function shiftDayKey(key: string, days: number): string {
  return utcToKey(keyToUTC(key) + days * DAY_MS);
}

/** Inclusive number of days spanned by two keys, in either order. */
export function dayCount(a: string, b: string): number {
  return Math.abs(Math.round((keyToUTC(b) - keyToUTC(a)) / DAY_MS)) + 1;
}

/** Inclusive range between two day keys. Accepts them in either order. */
export function rangeBetween(a: string, b: string): DateRange {
  // yyyy-mm-dd sorts correctly as a string, so no parsing needed to order them.
  const [start, end] = a <= b ? [a, b] : [b, a];
  const last = keyToUTC(end);
  const keys: string[] = [];
  for (let t = keyToUTC(start); t <= last; t += DAY_MS) keys.push(utcToKey(t));
  return { start, end, keys };
}

/** Number of days each preset spans. */
export function rangeLength(kind: PresetKind): number {
  switch (kind) {
    case "today":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
  }
}

/** The current range for the selected preset, ending today. */
export function currentRange(
  kind: PresetKind,
  now: Date = new Date()
): DateRange {
  const end = dayKey(now);
  return rangeBetween(shiftDayKey(end, -(rangeLength(kind) - 1)), end);
}

/**
 * The equally-long period immediately before `range`, used for delta
 * comparisons. Derived from the range itself rather than from a preset, so a
 * 12-day custom range is compared against the 12 days preceding it.
 */
export function previousOf(range: DateRange): DateRange {
  const end = shiftDayKey(range.start, -1);
  return rangeBetween(shiftDayKey(end, -(range.keys.length - 1)), end);
}

// ─────────────────────────────────────────────────────────────────────────────
// Live subscription
// ─────────────────────────────────────────────────────────────────────────────

export type DailySummaryDoc = DailySummary & { id: string };

/**
 * Subscribe to the daily summaries between two day keys, inclusive. Both
 * filters are on the same `date` field, so this stays a single-field range
 * query — no composite index, however many days it spans.
 *
 * Pass the span that covers the current range AND the preceding comparison
 * period (they are contiguous); callers slice out the exact days they need
 * with {@link summariesForKeys}. The upper bound matters: without it, a custom
 * range that ends in the past would stream every summary from its start to
 * today.
 */
export function useDailySummaries(fromKey: string, toKey: string) {
  const q = useMemo(
    () =>
      query(
        paths.dailySummaries(),
        where("date", ">=", fromKey),
        where("date", "<=", toKey)
      ),
    [fromKey, toKey]
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
  /** NON-CHARGEABLE: comped bills, counted only here. They are absent from
   *  totalRevenue and orderCount by design, so avgOrderValue stays a figure
   *  about food that was actually sold. */
  ncCount: number;
  ncAmount: number; // paise given away
  /** CANCELLED: settled bills that were later voided and refunded. Their sale
   *  has already been reversed out of totalRevenue and orderCount, so these
   *  two are the only remaining trace of it. */
  voidedBillCount: number;
  voidedRevenue: number; // paise refunded
}

/** Sum the headline metrics across a set of summaries. */
export function sumTotals(summaries: DailySummary[]): Totals {
  let totalRevenue = 0;
  let orderCount = 0;
  let voidedItemCount = 0;
  let ncCount = 0;
  let ncAmount = 0;
  let voidedBillCount = 0;
  let voidedRevenue = 0;
  for (const s of summaries) {
    totalRevenue += s.totalRevenue ?? 0;
    orderCount += s.orderCount ?? 0;
    voidedItemCount += s.voidedItemCount ?? 0;
    // Absent on summaries written before NC existed.
    ncCount += s.ncCount ?? 0;
    ncAmount += s.ncAmount ?? 0;
    // Absent on summaries written before cancellation existed.
    voidedBillCount += s.voidedBillCount ?? 0;
    voidedRevenue += s.voidedRevenue ?? 0;
  }
  const avgOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;
  return {
    totalRevenue,
    orderCount,
    voidedItemCount,
    avgOrderValue,
    ncCount,
    ncAmount,
    voidedBillCount,
    voidedRevenue,
  };
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

/**
 * Sum comped value by reason across summaries — the answer to "what are the
 * free meals actually costing me, and which kind?".
 */
export function ncReasonSummary(
  summaries: DailySummary[]
): Record<NcReason, number> {
  const out = { owner: 0, staff: 0, complaint: 0, pr: 0, other: 0 };
  for (const s of summaries) {
    for (const key of NC_REASONS) {
      out[key] += s.byNcReason?.[key] ?? 0;
    }
  }
  return out;
}
