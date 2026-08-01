/**
 * Insights / Reports — the analytics dashboard for admins and cashiers.
 *
 * This screen is UI only: all data comes from the live `dailySummaries`
 * subscription and the pure aggregation helpers in `reportsData.ts` (range
 * builders, sumTotals/computeDelta, revenueSeries, topItems, sourceSummary,
 * paymentSummary). Nothing here re-implements aggregation or touches Firestore
 * directly. Money is always rendered via `formatMoney`.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, space } from "@/theme/theme";
import { formatMoney } from "@/lib/money";
import type { OrderType, PaymentMode } from "@/types/models";
import {
  computeDelta,
  currentRange,
  paymentSummary,
  previousRange,
  revenueSeries,
  sourceSummary,
  sumTotals,
  summariesForKeys,
  topItems,
  useDailySummaries,
  type RangeKind,
} from "./reportsData";
import { KpiCard } from "./KpiCard";
import { RevenueChart } from "./RevenueChart";

type Tab = "analytics" | "reports";

const RANGE_OPTIONS: { key: RangeKind; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

const SOURCE_META: { key: OrderType; label: string; icon: string }[] = [
  { key: "dine-in", label: "Dine-In", icon: "🍽️" },
  { key: "takeaway", label: "Takeout", icon: "🥡" },
  { key: "delivery", label: "Delivery", icon: "🛵" },
];

const PAYMENT_META: { key: PaymentMode; label: string; icon: string }[] = [
  { key: "cash", label: "Cash", icon: "💵" },
  { key: "upi", label: "UPI", icon: "📱" },
  { key: "card", label: "Card", icon: "💳" },
];

/** Human weekday+date label for daily report rows (tz-safe). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function prettyDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("analytics");
  const [rangeKind, setRangeKind] = useState<RangeKind>("week");
  const [showAllItems, setShowAllItems] = useState(false);

  // Stable "now" so ranges only change when the day (or selection) changes.
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => currentRange(rangeKind, now), [rangeKind, now]);
  const prev = useMemo(() => previousRange(rangeKind, now), [rangeKind, now]);

  // One subscription covers both the current and previous periods; we slice
  // out each period client-side from the same doc set.
  const { data: summaries, loading, error } = useDailySummaries(prev.start);

  const curSummaries = useMemo(
    () => summariesForKeys(summaries, range.keys),
    [summaries, range.keys]
  );
  const prevSummaries = useMemo(
    () => summariesForKeys(summaries, prev.keys),
    [summaries, prev.keys]
  );

  const totals = useMemo(() => sumTotals(curSummaries), [curSummaries]);
  const prevTotals = useMemo(() => sumTotals(prevSummaries), [prevSummaries]);

  const deltas = useMemo(
    () => ({
      revenue: computeDelta(totals.totalRevenue, prevTotals.totalRevenue),
      orders: computeDelta(totals.orderCount, prevTotals.orderCount),
      aov: computeDelta(totals.avgOrderValue, prevTotals.avgOrderValue),
      voided: computeDelta(totals.voidedItemCount, prevTotals.voidedItemCount),
    }),
    [totals, prevTotals]
  );

  const series = useMemo(
    () => revenueSeries(curSummaries, range.keys),
    [curSummaries, range.keys]
  );
  const items = useMemo(() => topItems(curSummaries), [curSummaries]);
  const source = useMemo(() => sourceSummary(curSummaries), [curSummaries]);
  const payment = useMemo(() => paymentSummary(curSummaries), [curSummaries]);

  const rangeLabel =
    RANGE_OPTIONS.find((o) => o.key === rangeKind)?.label ?? "";
  const visibleItems = showAllItems ? items : items.slice(0, 5);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>
          Analyze your restaurant's performance.
        </Text>
      </View>

      {/* Analytics | Reports segmented control */}
      <View style={styles.segment}>
        {(["analytics", "reports"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text
                style={[
                  styles.segmentText,
                  active && styles.segmentTextActive,
                ]}
              >
                {t === "analytics" ? "Analytics" : "Reports"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Date range selector */}
      <View style={styles.rangeRow}>
        <Text style={styles.rangeIcon}>🗓️</Text>
        {RANGE_OPTIONS.map((o) => {
          const active = rangeKind === o.key;
          return (
            <Pressable
              key={o.key}
              style={[styles.rangeChip, active && styles.rangeChipActive]}
              onPress={() => setRangeKind(o.key)}
            >
              <Text
                style={[
                  styles.rangeChipText,
                  active && styles.rangeChipTextActive,
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + space.s6 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {tab === "analytics" ? (
            <>
              {/* KPI grid 2×2 */}
              <View style={styles.kpiRow}>
                <KpiCard
                  label="Total Revenue"
                  value={formatMoney(totals.totalRevenue)}
                  delta={deltas.revenue}
                />
                <KpiCard
                  label="Orders"
                  value={String(totals.orderCount)}
                  delta={deltas.orders}
                />
              </View>
              <View style={styles.kpiRow}>
                <KpiCard
                  label="Avg Order Value"
                  value={formatMoney(totals.avgOrderValue)}
                  delta={deltas.aov}
                />
                <KpiCard
                  label="Voided Items"
                  value={String(totals.voidedItemCount)}
                  delta={deltas.voided}
                />
              </View>

              {/* Revenue Over Time */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Revenue Over Time</Text>
                <Text style={styles.cardCaption}>{rangeLabel}</Text>
                <RevenueChart points={series} />
              </View>

              {/* Top Selling Items */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Top Selling Items</Text>
                  {items.length > 5 && (
                    <Pressable onPress={() => setShowAllItems((v) => !v)}>
                      <Text style={styles.link}>
                        {showAllItems ? "Show Less" : "View All"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {visibleItems.length === 0 ? (
                  <Text style={styles.emptyText}>No sales in this period.</Text>
                ) : (
                  visibleItems.map((it, i) => (
                    <View key={it.menuItemId} style={styles.itemRow}>
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {it.name}
                      </Text>
                      <Text style={styles.itemQty}>{it.qty} QTY</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Revenue by Source */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Revenue by Source</Text>
                {SOURCE_META.map((s) => (
                  <View key={s.key} style={styles.sourceRow}>
                    <Text style={styles.sourceIcon}>{s.icon}</Text>
                    <Text style={styles.sourceLabel}>{s.label}</Text>
                    <Text style={styles.sourceValue}>
                      {formatMoney(source[s.key])}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              {/* Reports: range summary */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {rangeKind === "today"
                    ? "Today's Report"
                    : rangeKind === "week"
                    ? "Weekly Report"
                    : "Monthly Report"}
                </Text>
                <Text style={styles.cardCaption}>
                  {range.start === range.end
                    ? range.start
                    : `${range.start} → ${range.end}`}
                </Text>
                <View style={styles.summaryGrid}>
                  <SummaryStat
                    label="Revenue"
                    value={formatMoney(totals.totalRevenue)}
                  />
                  <SummaryStat
                    label="Orders"
                    value={String(totals.orderCount)}
                  />
                  <SummaryStat
                    label="Avg Order"
                    value={formatMoney(totals.avgOrderValue)}
                  />
                  <SummaryStat
                    label="Voided"
                    value={String(totals.voidedItemCount)}
                  />
                </View>
              </View>

              {/* Daily report */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Daily Report</Text>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.thDay]}>Day</Text>
                  <Text style={[styles.th, styles.thNum]}>Orders</Text>
                  <Text style={[styles.th, styles.thMoney]}>Revenue</Text>
                </View>
                {series.length === 0 ? (
                  <Text style={styles.emptyText}>No data.</Text>
                ) : (
                  series.map((p) => {
                    const day = curSummaries.find((s) => s.date === p.date);
                    return (
                      <View key={p.date} style={styles.tableRow}>
                        <Text style={[styles.td, styles.thDay]}>
                          {prettyDay(p.date)}
                        </Text>
                        <Text style={[styles.td, styles.thNum]}>
                          {day?.orderCount ?? 0}
                        </Text>
                        <Text style={[styles.td, styles.thMoney]}>
                          {formatMoney(p.revenue)}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>

              {/* Item-wise sales / best-selling */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Item-wise Sales</Text>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.thItem]}>Item</Text>
                  <Text style={[styles.th, styles.thNum]}>Qty</Text>
                  <Text style={[styles.th, styles.thMoney]}>Revenue</Text>
                </View>
                {items.length === 0 ? (
                  <Text style={styles.emptyText}>No sales in this period.</Text>
                ) : (
                  items.map((it) => (
                    <View key={it.menuItemId} style={styles.tableRow}>
                      <Text
                        style={[styles.td, styles.thItem]}
                        numberOfLines={1}
                      >
                        {it.name}
                      </Text>
                      <Text style={[styles.td, styles.thNum]}>{it.qty}</Text>
                      <Text style={[styles.td, styles.thMoney]}>
                        {formatMoney(it.revenue)}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {/* Payment summary */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Payment Summary</Text>
                {PAYMENT_META.map((p) => (
                  <View key={p.key} style={styles.sourceRow}>
                    <Text style={styles.sourceIcon}>{p.icon}</Text>
                    <Text style={styles.sourceLabel}>{p.label}</Text>
                    <Text style={styles.sourceValue}>
                      {formatMoney(payment[p.key])}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s2,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  segment: {
    flexDirection: "row",
    marginHorizontal: space.s4,
    padding: space.s1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: space.s2,
    alignItems: "center",
    borderRadius: radius.sm,
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.text,
  },
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  rangeIcon: {
    fontSize: 16,
  },
  rangeChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rangeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rangeChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  rangeChipTextActive: {
    color: colors.textInverse,
  },
  scrollContent: {
    paddingHorizontal: space.s4,
    paddingTop: space.s1,
    gap: space.s3,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s6,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: "center",
  },
  kpiRow: {
    flexDirection: "row",
    gap: space.s3,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    ...shadow.card,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  cardCaption: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: space.s2,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s2,
  },
  link: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    paddingVertical: space.s3,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  itemQty: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textMuted,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingVertical: space.s3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sourceIcon: {
    fontSize: 20,
  },
  sourceLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  sourceValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: space.s2,
  },
  summaryStat: {
    width: "50%",
    paddingVertical: space.s2,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    marginTop: 2,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: space.s2,
    marginTop: space.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: space.s2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  td: {
    fontSize: 14,
    color: colors.text,
  },
  thDay: {
    flex: 1.4,
  },
  thItem: {
    flex: 2,
  },
  thNum: {
    flex: 1,
    textAlign: "center",
  },
  thMoney: {
    flex: 1.4,
    textAlign: "right",
  },
});
