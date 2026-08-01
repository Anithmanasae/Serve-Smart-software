/**
 * KpiCard — a single headline metric with a delta pill comparing the current
 * period to the previous equivalent one. Pure presentational; the numbers and
 * delta are computed by the ported aggregation helpers in `reportsData.ts`.
 */
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { Delta } from "./reportsData";

interface KpiCardProps {
  label: string;
  /** Already-formatted display value (money via formatMoney, or a count). */
  value: string;
  delta: Delta;
}

const ARROW: Record<Delta["direction"], string> = {
  up: "↗",
  down: "↘",
  neutral: "→",
};

export function KpiCard({ label, value, delta }: KpiCardProps) {
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

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
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
  pill: {
    alignSelf: "flex-start",
    marginTop: space.s3,
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillUp: {
    backgroundColor: colors.primarySoft,
  },
  pillDown: {
    backgroundColor: "#fdecec",
  },
  pillNeutral: {
    backgroundColor: colors.surfaceMuted,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextUp: {
    color: colors.primary,
  },
  pillTextDown: {
    color: colors.danger,
  },
  pillTextNeutral: {
    color: colors.textMuted,
  },
});
