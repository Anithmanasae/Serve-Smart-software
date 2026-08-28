/**
 * The screen has nothing to show — say what that means and what to do next.
 *
 * Every list in this app used to answer emptiness with a single grey line:
 * "No tables to show.", "No bills to settle right now.", "Nothing here."
 * Each of those is accurate and each is a dead end, which is fine for a
 * cashier on their four hundredth shift and fatal for an owner on their first
 * five minutes — a stranger reads an empty screen as a broken one.
 *
 * So the shape is fixed: a glyph, a line that says what is true, a line that
 * says why, and — where there is genuinely something to do — one button that
 * does it. Nothing has two buttons: an empty screen is the worst possible
 * place to ask someone to choose.
 *
 * The muted variant is for a list that is empty because the shift is going
 * well (no bills waiting, no tickets on the pass). That is good news and
 * should not be dressed up as a task.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { colors, fonts, radius, space } from "@/theme/theme";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  /** One sentence. What this screen will hold, or why it is empty. */
  body?: string;
  action?: { label: string; onPress: () => void };
  /** Empty because nothing is pending, not because nothing is set up. */
  tone?: "invite" | "calm";
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  tone = "invite",
  style,
}: EmptyStateProps) {
  const calm = tone === "calm";
  return (
    <View style={[styles.root, style]}>
      <View style={[styles.badge, calm && styles.badgeCalm]}>
        <MaterialCommunityIcons
          name={icon}
          size={26}
          color={calm ? colors.textMuted : colors.primary}
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? (
        <PressableScale
          style={styles.btn}
          containerStyle={styles.btnHit}
          activeScale={0.97}
          haptic="press"
          onPress={action.onPress}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{action.label}</Text>
          <MaterialCommunityIcons
            name="arrow-right"
            size={16}
            color={colors.textInverse}
          />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s6,
    paddingHorizontal: space.s5,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  badgeCalm: { backgroundColor: colors.surfaceMuted },
  title: {
    marginTop: space.s4,
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: colors.text,
    textAlign: "center",
  },
  body: {
    marginTop: space.s2,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 300,
  },
  btnHit: { marginTop: space.s5 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.s5,
    paddingVertical: space.s3,
  },
  btnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textInverse,
  },
});
