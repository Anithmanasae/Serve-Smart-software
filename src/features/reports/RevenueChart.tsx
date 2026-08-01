/**
 * RevenueChart — an area/line chart of per-day revenue for the selected range,
 * drawn with react-native-svg (no web/DOM SVG). Green line with a soft green
 * gradient fill, matching the SADA theme. Data comes from `revenueSeries`.
 */
import { useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import { colors, space } from "@/theme/theme";
import { formatMoney } from "@/lib/money";
import type { RevenuePoint } from "./reportsData";

interface RevenueChartProps {
  points: RevenuePoint[];
}

const HEIGHT = 160;
const PAD_TOP = space.s3;
const PAD_BOTTOM = space.s3;
const PAD_X = space.s2;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday abbreviation from a yyyy-mm-dd key (UTC-parsed, tz-safe). */
function weekdayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAYS[dow];
}

export function RevenueChart({ points }: RevenueChartProps) {
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== width) setWidth(w);
  };

  const hasData = points.some((p) => p.revenue > 0);

  // Chart drawing area.
  const innerW = Math.max(width - PAD_X * 2, 1);
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxRevenue = Math.max(1, ...points.map((p) => p.revenue));

  const n = points.length;
  const xFor = (i: number) =>
    PAD_X + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yFor = (revenue: number) =>
    PAD_TOP + innerH - (revenue / maxRevenue) * innerH;

  // Build the line and area paths.
  let linePath = "";
  let areaPath = "";
  if (width > 0 && n > 0) {
    points.forEach((p, i) => {
      const x = xFor(i);
      const y = yFor(p.revenue);
      linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    });
    const baseline = PAD_TOP + innerH;
    areaPath =
      `M${xFor(0)},${baseline}` +
      points.map((p, i) => ` L${xFor(i)},${yFor(p.revenue)}`).join("") +
      ` L${xFor(n - 1)},${baseline} Z`;
  }

  // Label sampling: at most ~7 labels so a 30-day range stays legible.
  const maxLabels = 7;
  const step = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <View onLayout={onLayout}>
      <View style={styles.chartArea}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.primary} stopOpacity={0.22} />
                <Stop offset="1" stopColor={colors.primary} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {hasData && <Path d={areaPath} fill="url(#revFill)" />}
            <Path
              d={linePath}
              stroke={colors.primary}
              strokeWidth={2.5}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {n <= 14 &&
              points.map((p, i) => (
                <Circle
                  key={p.date}
                  cx={xFor(i)}
                  cy={yFor(p.revenue)}
                  r={2.5}
                  fill={colors.surface}
                  stroke={colors.primary}
                  strokeWidth={1.5}
                />
              ))}
          </Svg>
        )}
        {!hasData && width > 0 && (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <Text style={styles.emptyText}>No revenue in this period</Text>
          </View>
        )}
      </View>

      {/* X-axis day labels */}
      <View style={styles.labelsRow}>
        {points.map((p, i) =>
          i % step === 0 || i === n - 1 ? (
            <Text key={p.date} style={[styles.axisLabel, { left: xFor(i) }]}>
              {weekdayLabel(p.date)}
            </Text>
          ) : null
        )}
      </View>

      {/* Peak-day caption */}
      {hasData && (
        <Text style={styles.peakCaption}>
          Peak {formatMoney(maxRevenue)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartArea: {
    height: HEIGHT,
    justifyContent: "center",
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  labelsRow: {
    height: 16,
    marginTop: space.s1,
    position: "relative",
  },
  axisLabel: {
    position: "absolute",
    fontSize: 11,
    color: colors.textMuted,
    transform: [{ translateX: -12 }],
    width: 24,
    textAlign: "center",
  },
  peakCaption: {
    marginTop: space.s1,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "right",
  },
});
