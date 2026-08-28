/**
 * Insights / Reports — the analytics dashboard for admins and cashiers.
 *
 * This screen is UI only: all data comes from the live `dailySummaries`
 * subscription and the pure aggregation helpers in `reportsData.ts` (range
 * builders, sumTotals/computeDelta, revenueSeries, topItems, sourceSummary,
 * paymentSummary). Nothing here re-implements aggregation or touches Firestore
 * directly. Money is always rendered via `formatMoney`.
 *
 * The range selector offers three presets plus a custom range picked in
 * `DateRangeSheet`. Everything downstream reads the resulting `DateRange`, so
 * a custom span is not a special case anywhere below this file's state.
 */
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bone, Skeleton } from "@/components/Skeleton";
import { ProfileButton } from "@/components/ProfileButton";
import { colors, radius, shadow, space } from "@/theme/theme";
import { BrandHeader } from "@/components/BrandHeader";
import { ScreenHeader } from "@/components/ScreenHeader";
import { formatMoney } from "@/lib/money";
import { formatDayKeyFull, formatDayKeyShort } from "@/lib/date";
import { feel } from "@/lib/feedback";
import { useResponsive } from "@/lib/responsive";
import {
  NC_REASONS,
  NC_REASON_LABELS,
  type OrderType,
  type PaymentMode,
} from "@/types/models";
import {
  computeDelta,
  currentRange,
  ncReasonSummary,
  paymentSummary,
  previousOf,
  rangeBetween,
  revenueSeries,
  sourceSummary,
  sumTotals,
  summariesForKeys,
  topItems,
  useDailySummaries,
  type DateRange,
  type PresetKind,
} from "./reportsData";
import { useAuth } from "@/features/auth/AuthContext";
import { DateRangeSheet } from "./DateRangeSheet";
import { KpiCard } from "./KpiCard";
import { RevenueChart } from "./RevenueChart";

type Tab = "analytics" | "reports";

/**
 * What the range selector is set to. A union rather than a kind + optional
 * dates, so "custom with no dates" is not a state anything downstream has to
 * defend against.
 */
type Selection =
  | { kind: PresetKind }
  | { kind: "custom"; start: string; end: string };

const RANGE_OPTIONS: { key: PresetKind; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

/** Daily Report rows shown before the owner asks for the whole range. */
const DAILY_ROWS_COLLAPSED = 14;

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

/** The count line under a KPI's money total — "1 Bill" / "3 Bills". */
function billsCaption(count: number): string {
  return `${count} ${count === 1 ? "Bill" : "Bills"}`;
}

/** "12 Jul – 06 Aug 2026", dropping the repeated year when both ends share it. */
function formatRangeLabel(range: DateRange): string {
  if (range.start === range.end) return formatDayKeyFull(range.end);
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  const from = sameYear
    ? formatDayKeyShort(range.start)
    : formatDayKeyFull(range.start);
  return `${from} – ${formatDayKeyFull(range.end)}`;
}

export function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const { restaurantName, config } = useAuth();
  // Two tiles across on a phone, three on a tablet. Fixed either way rather
  // than derived from width: the six KPIs read as a block, and a count that
  // shifted with the window would reshuffle that block on every rotation.
  const kpiWidth = `${100 / (isTablet ? 3 : 2)}%` as `${number}%`;
  const [tab, setTab] = useState<Tab>("analytics");
  const [selection, setSelection] = useState<Selection>({ kind: "week" });
  const [pickerOpen, setPickerOpen] = useState(false);
  // Remembered so reopening the picker after a detour through the presets
  // starts from the last custom range instead of a blank calendar.
  const [lastCustom, setLastCustom] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [showAllItems, setShowAllItems] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);

  // Stable "now" so ranges only change when the day (or selection) changes.
  const now = useMemo(() => new Date(), []);
  const range = useMemo(
    () =>
      selection.kind === "custom"
        ? rangeBetween(selection.start, selection.end)
        : currentRange(selection.kind, now),
    [selection, now]
  );
  // Derived from the range itself, so a custom span is compared against the
  // equally-long span immediately before it.
  const prev = useMemo(() => previousOf(range), [range]);

  // One subscription covers both the current and previous periods — they are
  // contiguous, so a single bounded `date` query fetches exactly the days in
  // play and nothing else. Each period is sliced out client-side.
  const {
    data: summaries,
    loading,
    error,
  } = useDailySummaries(prev.start, range.end);

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
      voided: computeDelta(totals.voidedBillCount, prevTotals.voidedBillCount),
      nc: computeDelta(totals.ncAmount, prevTotals.ncAmount),
      ncCount: computeDelta(totals.ncCount, prevTotals.ncCount),
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
  const ncByReason = useMemo(() => ncReasonSummary(curSummaries), [curSummaries]);

  const isCustom = selection.kind === "custom";
  const rangeLabel = isCustom
    ? formatRangeLabel(range)
    : (RANGE_OPTIONS.find((o) => o.key === selection.kind)?.label ?? "");
  const reportTitle = isCustom
    ? "Custom Report"
    : selection.kind === "today"
      ? "Today's Report"
      : selection.kind === "week"
        ? "Weekly Report"
        : "Monthly Report";

  const visibleItems = showAllItems ? items : items.slice(0, 5);
  // A long range makes for a long table, so it collapses to the most recent
  // days — the end of the range is what anyone scrolls here to read first.
  const daysCollapsible = series.length > DAILY_ROWS_COLLAPSED;
  const visibleDays =
    showAllDays || !daysCollapsible
      ? series
      : series.slice(-DAILY_ROWS_COLLAPSED);


  const selectPreset = (kind: PresetKind) => {
    feel.select(); // Today / Week / Month are a range picker, not buttons
    setSelection({ kind });
    setShowAllDays(false);
  };

  const openPicker = () => {
    feel.press(); // the date sheet comes up
    setPickerOpen(true);
  };

  const applyCustom = (start: string, end: string) => {
    feel.press(); // the sheet closes and the whole report re-reads
    setSelection({ kind: "custom", start, end });
    setLastCustom({ start, end });
    setShowAllDays(false);
    setPickerOpen(false);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <BrandHeader />
      <ScreenHeader
        title="Insights"
        subtitle="Analyze your restaurant's performance."
        right={<ProfileButton />}
      />

      {/* Analytics | Reports segmented control */}
      <View style={styles.segment}>
        {(["analytics", "reports"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              // A segmented control ticks between choices; re-tapping the
              // segment you are already on says nothing.
              onPress={() => {
                if (!active) feel.select();
                setTab(t);
              }}
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

      {/* Date range selector — presets plus a custom range. Scrolls
          horizontally so the custom chip can carry the full range as its
          label without squeezing the presets.

          */}
      <View style={styles.rangeRow}>
        {/* A vector glyph, not the 🗓️ codepoint: an emoji renders in the
            platform's own colour and weight, which is the one thing in this
            row that could not be made to match the outline icons in the tab
            bar below. Decorative — the chips already say what this is. */}
        <Ionicons
          name="calendar-outline"
          size={18}
          color={colors.textMuted}
          style={styles.rangeIcon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // `flexShrink` (not `flex: 1`) lets the row stay chip-width on a
          // tablet and become scrollable on a narrow phone, and the icon keeps
          // its space either way instead of being pushed off the left edge.
          style={styles.rangeScroll}
          contentContainerStyle={styles.rangeChips}
        >
          {RANGE_OPTIONS.map((o) => {
            const active = selection.kind === o.key;
            return (
              <Pressable
                key={o.key}
                style={({ pressed }) => [
                  styles.rangeChip,
                  active && styles.rangeChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => selectPreset(o.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
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
          <Pressable
            style={({ pressed }) => [
              styles.rangeChip,
              styles.customChip,
              isCustom && styles.rangeChipActive,
              pressed && styles.pressed,
            ]}
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityState={{ selected: isCustom }}
            accessibilityLabel={
              isCustom ? `Custom range, ${rangeLabel}` : "Pick a custom range"
            }
          >
            <Text
              style={[
                styles.rangeChipText,
                isCustom && styles.rangeChipTextActive,
              ]}
            >
              {isCustom ? rangeLabel : "Custom"}
            </Text>
            <Text
              style={[
                styles.customCaret,
                isCustom && styles.rangeChipTextActive,
              ]}
            >
              ▾
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {loading ? (
        <InsightsSkeleton tab={tab} kpiWidth={kpiWidth} wide={isTablet} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            // Wide enough for the chart to breathe, capped so the report
            // tables don't smear a label and its number to opposite edges.
            isTablet && styles.scrollContentWide,
            { paddingBottom: insets.bottom + space.s6 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {tab === "analytics" ? (
            <>
              {/* THE FRONT DOOR of a restaurant that has not billed anything
                  yet. Insights is where an owner lands, and until there is a
                  single bill every tile below reads ₹0.00 — an accounting
                  screen accurately reporting that nothing has happened, which
                  is the worst first impression this app can make. The
                  checklist stands in its place, and the real dashboard
                  arrives the moment there is something in it to read. That
                  swap is itself part of the reward. */}
              {/* KPI tiles — one wrapping grid, 2 across on a phone and 3 on
                  a tablet. The reading order is fixed and meaningful, so the
                  tiles wrap rather than rearrange. */}
              <View style={styles.kpiGrid}>
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="Total Revenue"
                    value={formatMoney(totals.totalRevenue)}
                    delta={deltas.revenue}
                  />
                </View>
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="Orders"
                    value={String(totals.orderCount)}
                    delta={deltas.orders}
                  />
                </View>
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="Avg Order Value"
                    value={formatMoney(totals.avgOrderValue)}
                    delta={deltas.aov}
                  />
                </View>
                {/* Revenue above is already NET of these — the cancelled sale
                    was reversed out of it. This tile is what stops a refund
                    from looking like a sale that simply never happened.
                    Money leads and the count qualifies it: "3 · ₹7,200.00" on
                    one line made the reader work out which number was the
                    headline, and put a count where every other tile has a
                    total. */}
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="Cancelled Bills"
                    value={formatMoney(totals.voidedRevenue)}
                    subtitle={billsCaption(totals.voidedBillCount)}
                    delta={deltas.voided}
                  />
                </View>
                {/* Non-chargeable sits alongside the headline numbers, not
                    buried in a sub-report: a comp is money the restaurant
                    chose not to take, and it should be as visible as the
                    money it did. "NC Value" / "NC Bills" rather than
                    "Non-Chargeable" / "NC Bills" — one term for the feature,
                    so the pair reads as two views of one thing. */}
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="NC Value"
                    value={formatMoney(totals.ncAmount)}
                    delta={deltas.nc}
                  />
                </View>
                <View style={[styles.kpiCell, { width: kpiWidth }]}>
                  <KpiCard
                    label="NC Bills"
                    value={formatMoney(totals.ncAmount)}
                    subtitle={billsCaption(totals.ncCount)}
                    delta={deltas.ncCount}
                  />
                </View>
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
                    <Pressable
                      onPress={() => setShowAllItems((v) => !v)}
                      onPressIn={feel.tap}
                    >
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
                <Text style={styles.cardTitle}>{reportTitle}</Text>
                <Text style={styles.cardCaption}>{formatRangeLabel(range)}</Text>
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
                    label="Cancelled"
                    value={formatMoney(totals.voidedRevenue)}
                  />
                  {/* Same term as the Analytics tile — one name for one
                      number, whichever tab you read it on. */}
                  <SummaryStat
                    label="NC Value"
                    value={formatMoney(totals.ncAmount)}
                  />
                  <SummaryStat
                    label="NC Bills"
                    value={String(totals.ncCount)}
                  />
                </View>
              </View>

              {/* Daily report */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Daily Report</Text>
                  {daysCollapsible && (
                    <Pressable
                      onPress={() => setShowAllDays((v) => !v)}
                      onPressIn={feel.tap}
                    >
                      <Text style={styles.link}>
                        {showAllDays
                          ? "Show Less"
                          : `View all ${series.length} days`}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {daysCollapsible && !showAllDays && (
                  <Text style={styles.cardCaption}>
                    Most recent {DAILY_ROWS_COLLAPSED} days
                  </Text>
                )}
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.thDay]}>Day</Text>
                  <Text style={[styles.th, styles.thNum]}>Orders</Text>
                  <Text style={[styles.th, styles.thMoney]}>Revenue</Text>
                </View>
                {visibleDays.length === 0 ? (
                  <Text style={styles.emptyText}>No data.</Text>
                ) : (
                  visibleDays.map((p) => {
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

              {/* Non-chargeable breakdown — the point of fixed reasons: this
                  is the only view that answers "which kind of comp, and how
                  much?". Rendered even at zero so it never looks missing. */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Non-Chargeable</Text>
                  <Text style={styles.ncTotalText}>
                    {formatMoney(totals.ncAmount)}
                  </Text>
                </View>
                {totals.ncCount === 0 ? (
                  <Text style={styles.emptyText}>
                    No bills were comped in this period.
                  </Text>
                ) : (
                  NC_REASONS.filter((r) => ncByReason[r] > 0).map((r) => (
                    <View key={r} style={styles.sourceRow}>
                      <Text style={styles.sourceIcon}>🎁</Text>
                      <Text style={styles.sourceLabel}>
                        {NC_REASON_LABELS[r]}
                      </Text>
                      <Text style={styles.sourceValue}>
                        {formatMoney(ncByReason[r])}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {pickerOpen && (
        <DateRangeSheet
          initialStart={
            selection.kind === "custom" ? selection.start : lastCustom?.start
          }
          initialEnd={
            selection.kind === "custom" ? selection.end : lastCustom?.end
          }
          onClose={() => {
            feel.dismiss();
            setPickerOpen(false);
          }}
          onApply={applyCustom}
        />
      )}
    </View>
  );
}

/** One grey card with a title and `rows` list lines, the shape both tabs
 *  repeat down the page. */
function SkeletonCard({ rows }: { rows: number }) {
  return (
    <View style={styles.card}>
      <Bone width={148} height={16} />
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.sourceRow}>
          <Bone width="45%" height={13} />
          <View style={styles.skeletonSpacer} />
          <Bone width={72} height={13} />
        </View>
      ))}
    </View>
  );
}

/**
 * Insights mid-load, branched on the tab because the two are shaped nothing
 * alike: Analytics opens on a KPI grid and a chart, Reports on stacked
 * tables. Showing one skeleton for both would put the tiles somewhere the
 * user is about to find a table, which is worse than a spinner.
 */
function InsightsSkeleton({
  tab,
  kpiWidth,
  wide,
}: {
  tab: Tab;
  kpiWidth: `${number}%`;
  wide: boolean;
}) {
  return (
    <Skeleton
      style={[
        styles.scrollContent,
        styles.skeletonWrap,
        wide && styles.scrollContentWide,
      ]}
    >
      {tab === "analytics" ? (
        <>
          <View style={styles.kpiGrid}>
            {Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={[styles.kpiCell, { width: kpiWidth }]}>
                <View style={styles.card}>
                  <Bone width="70%" height={13} />
                  <Bone
                    width="55%"
                    height={22}
                    style={styles.skeletonKpiValue}
                  />
                  <Bone
                    width={54}
                    height={16}
                    round={radius.pill}
                    style={styles.skeletonKpiPill}
                  />
                </View>
              </View>
            ))}
          </View>
          {/* Revenue Over Time — the chart is the tallest thing on the page
              and the one whose absence would collapse the scroll. */}
          <View style={styles.card}>
            <Bone width={168} height={16} />
            <Bone width={96} height={12} style={styles.skeletonCaption} />
            <Bone height={168} round={radius.md} />
          </View>
          <SkeletonCard rows={4} />
        </>
      ) : (
        <>
          <SkeletonCard rows={3} />
          <SkeletonCard rows={5} />
          <SkeletonCard rows={3} />
        </>
      )}
    </Skeleton>
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
  pressed: {
    opacity: 0.7,
  },
  // The active tab is white, so the TRACK is what has to carry the contrast —
  // `surfaceMuted` behind `surface` is a difference you can only see indoors.
  // A darker track plus a lift on the active tab means the selected half reads
  // as raised rather than as "the half that isn't grey".
  segment: {
    flexDirection: "row",
    marginHorizontal: space.s4,
    padding: space.s1,
    backgroundColor: colors.track,
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
    ...shadow.raised,
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
    paddingLeft: space.s4,
    paddingVertical: space.s3,
  },
  rangeIcon: {
    // The glyph box is square; nudge it onto the chips' optical centre.
    marginTop: 1,
  },
  rangeScroll: {
    flexShrink: 1,
  },
  rangeChips: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    // The chips are the scrollable content, so their own trailing padding is
    // the right margin — a margin on the ScrollView would clip the last chip
    // mid-scroll instead of letting it come fully into view.
    paddingRight: space.s4,
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
  customChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
  },
  customCaret: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
  },
  scrollContent: {
    paddingHorizontal: space.s4,
    paddingTop: space.s1,
    gap: space.s3,
  },
  scrollContentWide: { width: "100%", maxWidth: 1000, alignSelf: "center" },
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
  // Negative margin + per-cell padding rather than `gap`: percentage widths
  // and a gap fight each other and overflow the row.
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -space.s2,
    // Cancel the last row's cell margin so the grid's spacing to the chart
    // below is the scroll container's `gap`, same as every other block.
    marginBottom: -space.s3,
  },
  kpiCell: {
    // Width is set per-render from the window — see `kpiWidth`.
    paddingHorizontal: space.s2,
    marginBottom: space.s3,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    ...shadow.card,
  },

  // ── Loading placeholder ─────────────────────────────────────────────────
  // Reuses `scrollContent`, `kpiGrid`, `kpiCell`, `card` and `sourceRow`, so
  // the report drops into the frame the bones were already holding.
  skeletonWrap: { flex: 1, overflow: "hidden" },
  skeletonKpiValue: { marginTop: space.s2 },
  skeletonKpiPill: { marginTop: space.s3 },
  skeletonCaption: { marginTop: space.s1, marginBottom: space.s3 },
  skeletonSpacer: { flex: 1 },
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
  ncTotalText: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.ncAmber,
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
