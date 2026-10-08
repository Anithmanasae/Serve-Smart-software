/**
 * The picture on the welcome card — a phone showing a week of sales going up.
 *
 * It is DRAWN, not a screenshot. A raster of the Insights screen would be out
 * of date the first time that screen was restyled, would need one file per
 * density, and would be the only image in the app that could not pick up the
 * theme. Views and one small Svg stay sharp on a phone and a counter tablet
 * alike.
 *
 * It shows a graph rather than a floor of tables because of who is looking: a
 * restaurant owner deciding whether to bother. Tables and tickets are how the
 * app works; a busy week is why they would want it.
 *
 * Every figure here is an ILLUSTRATION and none of it is read from anywhere —
 * this card is shown before there is an account, let alone a bill. That is
 * also why the whole thing is hidden from screen readers: read aloud, "sales
 * up 32%" is a claim about a restaurant that has not opened the app yet.
 *
 * `allowFontScaling={false}` throughout: this is a picture that happens to be
 * made of text, and a system font scale of 1.3 would push the figures out of
 * a 120dp phone.
 */
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { sparklePath } from "@/components/BrandLogo";
import { formatMoney } from "@/lib/money";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";

// The backdrop is drawn in this box and scaled to the hero's real width, so
// the halo and sparkles keep their places around the phone on any screen.
const STAGE_W = 320;
const STAGE_H = 270;

const PHONE_W = 120;
const PHONE_H = 252;
const BEZEL = 4;
const SCREEN_PAD = 7;

// The chart is sized from the phone, which is fixed, so it can be too.
const CHART_PAD = 6;
const CHART_W = PHONE_W - 2 * (BEZEL + SCREEN_PAD + CHART_PAD);
const CHART_H = Math.round(CHART_W * 0.52);

// Monday to Sunday in a 100 × 52 box. One dip on Wednesday: a line that only
// ever goes up reads as clip-art rather than as a week somebody traded.
const LINE = "M2 44 L18 40 L34 41 L50 30 L66 25 L82 14 L96 6";
const AREA = `${LINE} L96 52 L2 52 Z`;

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function WelcomeHero() {
  return (
    <View
      style={styles.stage}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      >
        <Defs>
          <RadialGradient id="welcomeHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.offerBorder} stopOpacity={0.7} />
            <Stop offset="0.6" stopColor={colors.primarySoft} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.primarySoft} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={160} cy={135} r={130} fill="url(#welcomeHalo)" />
        <Path d={sparklePath(42, 20, 8)} fill={colors.primary} opacity={0.85} />
        <Path d={sparklePath(284, 40, 5)} fill={colors.primary} opacity={0.55} />
        <Path d={sparklePath(58, 250, 4.5)} fill={colors.primary} opacity={0.45} />
      </Svg>

      <View style={styles.phone}>
        <View style={[styles.sideBtn, styles.powerBtn]} />
        <View style={[styles.sideBtn, styles.volumeBtn]} />

        <View style={styles.screen}>
          <View style={styles.statusBar}>
            <Text style={styles.statusTime} allowFontScaling={false}>
              9:41
            </Text>
            <View style={styles.camera} />
            <View style={styles.statusSys}>
              <MaterialCommunityIcons name="signal" size={7} color={colors.text} />
              <MaterialCommunityIcons name="battery" size={8} color={colors.text} />
            </View>
          </View>

          <View style={styles.appHead}>
            <Text style={styles.appTitle} allowFontScaling={false}>
              Insights
            </Text>
            <View style={styles.avatar} />
          </View>

          <View>
            <Text style={styles.salesLabel} allowFontScaling={false}>
              This week's sales
            </Text>
            <View style={styles.salesRow}>
              <Text style={styles.salesFigure} allowFontScaling={false}>
                {formatMoney(28450000)}
              </Text>
              <View style={styles.upPill}>
                <MaterialCommunityIcons
                  name="arrow-up"
                  size={7}
                  color={colors.trendUp}
                />
                <Text style={styles.upText} allowFontScaling={false}>
                  32%
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.chartCard}>
            <Svg width={CHART_W} height={CHART_H} viewBox="0 0 100 52">
              <Defs>
                <LinearGradient id="welcomeArea" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.primary} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path
                d="M0 14H100 M0 28H100 M0 42H100"
                stroke={colors.border}
                strokeWidth={0.6}
                fill="none"
              />
              <Path d={AREA} fill="url(#welcomeArea)" />
              <Path
                d={LINE}
                fill="none"
                stroke={colors.primary}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Today, ringed: the eye should land where the line ends. */}
              <Circle cx={96} cy={6} r={5} fill={colors.primary} opacity={0.18} />
              <Circle
                cx={96}
                cy={6}
                r={2.6}
                fill={colors.primary}
                stroke={colors.surface}
                strokeWidth={1.1}
              />
            </Svg>
            <View style={styles.days}>
              {DAYS.map((d, i) => (
                <Text
                  key={i}
                  style={[styles.day, i === DAYS.length - 1 && styles.dayToday]}
                  allowFontScaling={false}
                >
                  {d}
                </Text>
              ))}
            </View>
          </View>

          <View style={styles.kpis}>
            <Kpi label="Bills" value="512" />
            <Kpi label="Avg bill" value={formatMoney(55600)} />
          </View>

          <View style={styles.grow} />

          <View style={styles.tabBar}>
            <View style={styles.tabDot} />
            <View style={styles.tabDot} />
            <View style={styles.tabDot} />
            <View style={[styles.tabDot, styles.tabDotOn]} />
          </View>
          <View style={styles.homeBar} />
        </View>
      </View>

      <FloatCard
        style={styles.growthCard}
        icon="trending-up"
        tint={colors.trendUp}
        tintSoft={colors.trendUpSoft}
        title="Sales up 32%"
        detail="vs last week"
      />
      <FloatCard
        style={styles.bestCard}
        icon="star-outline"
        tint={colors.primary}
        tintSoft={colors.primarySoft}
        title="Best day yet"
        detail={`Sunday · ${formatMoney(5840000)}`}
      />
    </View>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel} allowFontScaling={false}>
        {label}
      </Text>
      <Text style={styles.kpiValue} allowFontScaling={false}>
        {value}
      </Text>
    </View>
  );
}

function FloatCard({
  style,
  icon,
  tint,
  tintSoft,
  title,
  detail,
}: {
  style: object;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  tint: string;
  tintSoft: string;
  title: string;
  detail: string;
}) {
  return (
    <View style={[styles.floatCard, style]}>
      <View style={[styles.floatBadge, { backgroundColor: tintSoft }]}>
        <MaterialCommunityIcons name={icon} size={14} color={tint} />
      </View>
      <View>
        <Text style={styles.floatTitle} allowFontScaling={false}>
          {title}
        </Text>
        <Text style={styles.floatDetail} allowFontScaling={false}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    maxWidth: STAGE_W,
    height: STAGE_H,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },

  phone: {
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: radius.xxl,
    backgroundColor: colors.text,
    padding: BEZEL,
    ...shadow.float,
  },
  sideBtn: {
    position: "absolute",
    width: 2,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  powerBtn: { right: -2, top: 62, height: 26 },
  volumeBtn: { left: -2, top: 48, height: 38 },
  screen: {
    flex: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.bg,
    paddingHorizontal: SCREEN_PAD,
    paddingBottom: 5,
    gap: 6,
    overflow: "hidden",
  },

  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingHorizontal: 5,
  },
  statusTime: { fontFamily: fonts.bold, fontSize: 6.5, color: colors.text },
  statusSys: { flexDirection: "row", alignItems: "center", gap: 2 },
  camera: {
    position: "absolute",
    top: 5,
    left: "50%",
    marginLeft: -3.5,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
  },

  appHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  appTitle: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.text },
  avatar: {
    width: 13,
    height: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },

  salesLabel: {
    fontFamily: fonts.semibold,
    fontSize: 6.5,
    color: colors.textMuted,
  },
  salesRow: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  salesFigure: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: -0.3,
    color: colors.text,
  },
  upPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    backgroundColor: colors.trendUpSoft,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  upText: { fontFamily: fonts.extrabold, fontSize: 6.5, color: colors.trendUp },

  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: CHART_PAD,
    paddingBottom: 4,
    gap: 3,
    ...shadow.card,
  },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { fontFamily: fonts.semibold, fontSize: 5.5, color: colors.textMuted },
  dayToday: { fontFamily: fonts.extrabold, color: colors.primary },

  kpis: { flexDirection: "row", gap: 5 },
  kpi: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 6,
    ...shadow.card,
  },
  kpiLabel: { fontFamily: fonts.semibold, fontSize: 6, color: colors.textMuted },
  kpiValue: { fontFamily: fonts.extrabold, fontSize: 10, color: colors.text },

  grow: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: 5,
    ...shadow.card,
  },
  tabDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  tabDotOn: { backgroundColor: colors.primary },
  homeBar: {
    alignSelf: "center",
    width: 36,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.text,
    opacity: 0.75,
  },

  // `shadow.glow`, not `card`: on Android elevation is also draw order, and
  // these have to sit ABOVE the phone they overlap.
  floatCard: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.s2,
    paddingLeft: space.s2,
    paddingRight: 10,
    ...shadow.glow,
  },
  growthCard: { left: 0, top: 70 },
  bestCard: { right: 0, bottom: 78 },
  floatBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  floatTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 9.5,
    lineHeight: 12,
    color: colors.text,
  },
  floatDetail: {
    fontFamily: fonts.regular,
    fontSize: 8,
    lineHeight: 11,
    color: colors.textMuted,
  },
});
