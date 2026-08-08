/**
 * DateRangeSheet — the custom date-range picker behind the Insights "Custom"
 * chip.
 *
 * Hand-rolled rather than a native date picker for two reasons: a platform
 * picker only ever returns ONE date (you'd open it twice and still hand-roll
 * the ordering rules), and it can't show a range as a continuous band, which is
 * the whole point of the interaction. Everything here is RN primitives + theme
 * tokens, so it looks identical on both platforms and needs no native module.
 *
 * The whole component works in `dayKey` space (yyyy-mm-dd). It never builds a
 * Date for anything except month arithmetic, so it cannot drift against the
 * IST business day the summaries are filed under.
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, space } from "@/theme/theme";
import { dayKey, formatDayKeyShort } from "@/lib/date";
import { feel } from "@/lib/feedback";
import { MAX_RANGE_DAYS, dayCount, shiftDayKey } from "./reportsData";

interface DateRangeSheetProps {
  /** The range to open with, if one is already applied. */
  initialStart?: string | null;
  initialEnd?: string | null;
  onClose: () => void;
  onApply: (start: string, end: string) => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/** Which end of the range the next day-tap will set. */
type Editing = "start" | "end";

// ─────────────────────────────────────────────────────────────────────────────
// Day-key helpers (pure, UTC-only — see the note in reportsData.ts)
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** First day of the month containing `key` — "2026-08-06" → "2026-08-01". */
function firstOfMonth(key: string): string {
  return `${key.slice(0, 8)}01`;
}

function keyFor(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** Year + 0-based month of a day key. */
function monthOf(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

/**
 * The cells of one month grid: leading blanks so the 1st lands on its weekday,
 * then every day, then trailing blanks to complete the last week.
 */
function monthCells(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array<null>(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(keyFor(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Chunk a flat cell list into weeks of 7. */
function toWeeks(cells: (string | null)[]): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick ranges
// ─────────────────────────────────────────────────────────────────────────────

interface QuickRange {
  label: string;
  resolve: (today: string) => { start: string; end: string };
}

const QUICK_RANGES: QuickRange[] = [
  {
    label: "Last 7 days",
    resolve: (today) => ({ start: shiftDayKey(today, -6), end: today }),
  },
  {
    label: "Last 30 days",
    resolve: (today) => ({ start: shiftDayKey(today, -29), end: today }),
  },
  {
    label: "This month",
    resolve: (today) => ({ start: firstOfMonth(today), end: today }),
  },
  {
    label: "Last month",
    resolve: (today) => {
      const end = shiftDayKey(firstOfMonth(today), -1);
      return { start: firstOfMonth(end), end };
    },
  },
  {
    label: "Last 90 days",
    resolve: (today) => ({ start: shiftDayKey(today, -89), end: today }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export function DateRangeSheet({
  initialStart,
  initialEnd,
  onClose,
  onApply,
}: DateRangeSheetProps) {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => dayKey(), []);

  const [start, setStart] = useState<string | null>(initialStart ?? null);
  const [end, setEnd] = useState<string | null>(initialEnd ?? null);
  // Opening with a range applied means the next tap should restart it; opening
  // blank means the next tap is the start either way.
  const [editing, setEditing] = useState<Editing>("start");

  // The month on screen. Anchored to the applied range so reopening lands
  // where the owner left off, not on today.
  const [view, setView] = useState(() => monthOf(initialEnd ?? today));

  const weeks = useMemo(
    () => toWeeks(monthCells(view.year, view.month)),
    [view]
  );

  const span = start && end ? dayCount(start, end) : 0;
  const tooLong = span > MAX_RANGE_DAYS;
  const canApply = !!start && !!end && !tooLong;

  // Only months that could contain data are reachable.
  const atCurrentMonth = useMemo(() => {
    const t = monthOf(today);
    return view.year === t.year && view.month === t.month;
  }, [view, today]);

  const stepMonth = (delta: number) => {
    feel.select();
    const d = new Date(Date.UTC(view.year, view.month + delta, 1));
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };

  const pickDay = (key: string) => {
    feel.select();
    if (editing === "start" || !start) {
      setStart(key);
      // A start after the old end would leave the range inside out.
      if (end && key > end) setEnd(null);
      setEditing("end");
      return;
    }
    // Tapping before the start pulls the start back instead of rejecting the
    // tap — the alternative is a dead press with no explanation.
    if (key < start) {
      setStart(key);
      return;
    }
    setEnd(key);
  };

  const applyQuick = (q: QuickRange) => {
    feel.select();
    const r = q.resolve(today);
    setStart(r.start);
    setEnd(r.end);
    setEditing("end");
    setView(monthOf(r.end));
  };

  const activeQuick = QUICK_RANGES.find((q) => {
    if (!start || !end) return false;
    const r = q.resolve(today);
    return r.start === start && r.end === end;
  })?.label;

  const hint = !start
    ? "Tap a day to set the start"
    : !end
      ? "Now tap the last day"
      : tooLong
        ? `Ranges are capped at ${MAX_RANGE_DAYS} days`
        : `${span} ${span === 1 ? "day" : "days"} selected`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={onClose}
          accessibilityLabel="Close date picker"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.s4 }]}
        >
          <View style={styles.grabber} />

          {/* ── Header ───────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Custom range</Text>
              <Text style={styles.subtitle}>
                Any two dates — the report rebuilds around them.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>

          {/* The body scrolls so that on a short screen the calendar gives way
              rather than pushing Apply below the fold. */}
          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── From / To ────────────────────────────────────────────────── */}
            <View style={styles.endpointRow}>
              <EndpointCard
                label="From"
                value={start}
                active={editing === "start"}
                onPress={() => {
                  feel.select();
                  setEditing("start");
                  if (start) setView(monthOf(start));
                }}
              />
              <Text style={styles.endpointArrow}>→</Text>
              <EndpointCard
                label="To"
                value={end}
                active={editing === "end"}
                onPress={() => {
                  feel.select();
                  setEditing("end");
                  if (end) setView(monthOf(end));
                }}
              />
            </View>

            {/* ── Quick ranges ─────────────────────────────────────────────── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
            >
              {QUICK_RANGES.map((q) => {
                const active = activeQuick === q.label;
                return (
                  <Pressable
                    key={q.label}
                    onPress={() => applyQuick(q)}
                    style={({ pressed }) => [
                      styles.quickChip,
                      active && styles.quickChipActive,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        active && styles.quickChipTextActive,
                      ]}
                    >
                      {q.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* ── Month navigation ─────────────────────────────────────────── */}
            <View style={styles.monthNav}>
              <Pressable
                onPress={() => stepMonth(-1)}
                hitSlop={8}
                style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <Text style={styles.navGlyph}>‹</Text>
              </Pressable>
              <Text style={styles.monthTitle}>
                {MONTH_NAMES[view.month]} {view.year}
              </Text>
              <Pressable
                onPress={() => stepMonth(1)}
                hitSlop={8}
                disabled={atCurrentMonth}
                style={({ pressed }) => [
                  styles.navBtn,
                  atCurrentMonth && styles.navBtnDisabled,
                  pressed && !atCurrentMonth && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <Text
                  style={[
                    styles.navGlyph,
                    atCurrentMonth && styles.navGlyphDisabled,
                  ]}
                >
                  ›
                </Text>
              </Pressable>
            </View>

            {/* ── Calendar ─────────────────────────────────────────────────── */}
            <View style={styles.weekdayRow}>
              {WEEKDAY_INITIALS.map((w, i) => (
                <Text key={i} style={styles.weekdayText}>
                  {w}
                </Text>
              ))}
            </View>
            <View style={styles.grid}>
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.week}>
                  {week.map((key, di) => (
                    <DayCell
                      key={key ?? `blank-${wi}-${di}`}
                      dayKeyStr={key}
                      columnFirst={di === 0}
                      columnLast={di === 6}
                      today={today}
                      start={start}
                      end={end}
                      onPress={pickDay}
                    />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* ── Footer (pinned) ──────────────────────────────────────────── */}
          <View style={styles.footer}>
            <Text style={[styles.hint, tooLong && styles.hintWarn]}>{hint}</Text>
            <View style={styles.footerBtns}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!canApply || !start || !end) return;
                  // The one commit on the sheet — heavier than the ticks that
                  // built the range up.
                  feel.press();
                  onApply(start, end);
                }}
                disabled={!canApply}
                style={({ pressed }) => [
                  styles.applyBtn,
                  !canApply && styles.applyBtnDisabled,
                  pressed && canApply && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.applyText,
                    !canApply && styles.applyTextDisabled,
                  ]}
                >
                  Apply
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** One end of the range, doubling as the control that re-targets the next tap. */
function EndpointCard({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.endpoint,
        active && styles.endpointActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? "not set"}`}
    >
      <Text style={[styles.endpointLabel, active && styles.endpointLabelActive]}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={[styles.endpointValue, !value && styles.endpointValueEmpty]}
        numberOfLines={1}
      >
        {value ? formatDayKeyShort(value) : "Select"}
      </Text>
      <Text style={styles.endpointYear}>{value ? value.slice(0, 4) : " "}</Text>
    </Pressable>
  );
}

/**
 * A single day. The selection band is painted on the square cell (so adjacent
 * days join up into a continuous run) while the circle sits on top of it —
 * that's what makes a range read as one shape instead of 30 loose dots.
 */
function DayCell({
  dayKeyStr,
  columnFirst,
  columnLast,
  today,
  start,
  end,
  onPress,
}: {
  dayKeyStr: string | null;
  columnFirst: boolean;
  columnLast: boolean;
  today: string;
  start: string | null;
  end: string | null;
  onPress: (key: string) => void;
}) {
  if (!dayKeyStr) return <View style={styles.cell} />;

  const future = dayKeyStr > today;
  const isStart = dayKeyStr === start;
  const isEnd = dayKeyStr === end;
  const isEdge = isStart || isEnd;
  const hasSpan = !!start && !!end && start !== end;
  const inside = hasSpan && dayKeyStr > start! && dayKeyStr < end!;
  const banded = hasSpan && (inside || isEdge);
  const isToday = dayKeyStr === today;

  return (
    <Pressable
      disabled={future}
      onPress={() => onPress(dayKeyStr)}
      style={[
        styles.cell,
        banded && styles.cellBanded,
        // Round the band wherever the run stops — at an endpoint or at the
        // edge of the week row.
        banded && (isStart || columnFirst) && styles.cellBandStart,
        banded && (isEnd || columnLast) && styles.cellBandEnd,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: isEdge, disabled: future }}
      accessibilityLabel={dayKeyStr}
    >
      <View
        style={[
          styles.dayCircle,
          isEdge && styles.dayCircleActive,
          isToday && !isEdge && styles.dayCircleToday,
        ]}
      >
        <Text
          style={[
            styles.dayText,
            future && styles.dayTextFuture,
            inside && styles.dayTextInside,
            isToday && !isEdge && styles.dayTextToday,
            isEdge && styles.dayTextActive,
          ]}
        >
          {Number(dayKeyStr.slice(8))}
        </Text>
      </View>
    </Pressable>
  );
}

const CELL_HEIGHT = 42;
const CIRCLE = 36;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  backdropFill: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    maxHeight: "92%",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.s3,
  },
  pressed: {
    opacity: 0.7,
  },
  // flexShrink lets the body give up height first, keeping the footer visible.
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s2,
  },
  headerText: {
    flexShrink: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  closeGlyph: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "700",
  },

  endpointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    marginTop: space.s4,
  },
  endpoint: {
    flex: 1,
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  endpointActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  endpointLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  endpointLabelActive: {
    color: colors.primary,
  },
  endpointValue: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
    marginTop: 2,
  },
  endpointValueEmpty: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  endpointYear: {
    fontSize: 11,
    color: colors.textMuted,
  },
  endpointArrow: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: "700",
  },

  quickRow: {
    gap: space.s2,
    paddingVertical: space.s4,
    paddingRight: space.s4,
  },
  quickChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  quickChipActive: {
    backgroundColor: colors.navySoft,
  },
  quickChipText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.textMuted,
  },
  quickChipTextActive: {
    color: colors.primary,
  },

  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s2,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnDisabled: {
    backgroundColor: "transparent",
  },
  navGlyph: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: colors.text,
  },
  navGlyphDisabled: {
    color: colors.borderStrong,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },

  weekdayRow: {
    flexDirection: "row",
    paddingBottom: space.s1,
  },
  weekdayText: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
  },
  grid: {
    // Bleed the selection band to the sheet's edges so a full week reads as
    // one continuous run rather than stopping short of the margin.
    marginHorizontal: -space.s1,
  },
  week: {
    flexDirection: "row",
  },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  cellBanded: {
    backgroundColor: colors.primarySoft,
  },
  cellBandStart: {
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  cellBandEnd: {
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
  dayCircle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleActive: {
    backgroundColor: colors.primary,
    ...shadow.card,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: 14.5,
    fontWeight: "600",
    color: colors.text,
  },
  dayTextInside: {
    color: colors.primary,
    fontWeight: "700",
  },
  dayTextToday: {
    color: colors.primary,
    fontWeight: "800",
  },
  dayTextActive: {
    color: colors.textInverse,
    fontWeight: "800",
  },
  dayTextFuture: {
    color: colors.borderStrong,
  },

  footer: {
    paddingTop: space.s4,
    marginTop: space.s2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: space.s3,
  },
  hint: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
  },
  hintWarn: {
    color: colors.ncAmber,
  },
  footerBtns: {
    flexDirection: "row",
    gap: space.s3,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  applyBtn: {
    flex: 2,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    ...shadow.card,
  },
  applyBtnDisabled: {
    backgroundColor: colors.surfaceMuted,
    shadowOpacity: 0,
    elevation: 0,
  },
  applyText: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  applyTextDisabled: {
    color: colors.textMuted,
  },
});
