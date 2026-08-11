/**
 * KpiCard — a single headline metric with a delta pill comparing the current
 * period to the previous equivalent one. Pure presentational; the numbers and
 * delta are computed by the ported aggregation helpers in `reportsData.ts`.
 *
 * Every tile has the same three-part shape — label, one big value, delta pill
 * — with an optional `subtitle` between the value and the pill. That ordering
 * is the point: a tile that carries two numbers (a total and a count) still
 * has exactly one headline, so the grid scans down a single column of figures
 * instead of asking which half of "3 · ₹7,200.00" was the answer.
 */
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { Delta } from "./reportsData";

interface KpiCardProps {
  label: string;
  /** Already-formatted display value (money via formatMoney, or a count). */
  value: string;
  /** Optional second line under the value — a count qualifying the total. */
  subtitle?: string;
  delta: Delta;
}

const ARROW: Record<Delta["direction"], string> = {
  up: "↗",
  down: "↘",
  neutral: "→",
};

export function KpiCard({ label, value, subtitle, delta }: KpiCardProps) {
  const tone =
    delta.direction === "up"
      ? styles.pillUp
      : delta.direction === "down"
      ? styles.pillDown
      : styles.pillNeutral;
  const toneText =
    delta.direction === "up"
      ? styles.pillTextUp
      : delta.direction === "down"
      ? styles.pillTextDown
      : styles.pillTextNeutral;

  const magnitude = Math.abs(delta.percent);
  const percentLabel = `${magnitude.toFixed(1)}%`;

  // One label for the whole tile: colour and an arrow glyph are the only thing
  // carrying direction visually, and a screen reader gets neither. Read as a
  // sentence so the metric, its qualifier and its trend arrive together
  // instead of as four unrelated stops.
  const direction =
    delta.direction === "up" ? "up" : delta.direction === "down" ? "down" : "flat";
  const a11yLabel = [
    label,
    value,
    subtitle,
    delta.direction === "neutral"
      ? "no change"
      : `${direction} ${percentLabel} versus the previous period`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={a11yLabel}
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {/* `adjustsFontSizeToFit` shrinks a long total to the tile rather than
          wrapping it, so two tiles side by side keep the same baseline; the
          `numberOfLines` cap is what makes that shrink instead of reflow. */}
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {subtitle}
        </Text>
      ) : null}
      <View style={[styles.pill, tone]}>
        <Text style={[styles.pillText, toneText]}>
          {ARROW[delta.direction]} {percentLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    ...shadow.card,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
  },
  value: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    marginTop: space.s2,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: 2,
  },
  pill: {
    alignSelf: "flex-start",
    marginTop: space.s3,
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillUp: {
    backgroundColor: colors.trendUpSoft,
  },
  pillDown: {
    backgroundColor: colors.trendDownSoft,
  },
  pillNeutral: {
    backgroundColor: colors.surfaceMuted,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextUp: {
    color: colors.trendUp,
  },
  pillTextDown: {
    color: colors.trendDown,
  },
  pillTextNeutral: {
    color: colors.textMuted,
  },
});
