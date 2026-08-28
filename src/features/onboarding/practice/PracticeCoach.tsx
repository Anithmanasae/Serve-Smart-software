/**
 * The instruction that hangs over the practice run.
 *
 * One card, one sentence, one thing to do next. It is the only part of this
 * screen that is not the real app, so it works hard to stay out of the way of
 * the parts that are.
 *
 * ## The load-bearing decisions
 *
 * - **It never covers the control it is talking about.** It docks to the TOP,
 *   because every control this run points at — a table tile, a dish card, the
 *   cart bar, COMPLETE, the payment buttons — sits in the lower two-thirds of
 *   a phone where a thumb can reach it. Covering "Send to Kitchen" while
 *   telling somebody to send to the kitchen is the failure mode of every
 *   coach mark ever shipped.
 * - **It re-enters when the instruction changes.** The card animating is the
 *   only signal that the last tap landed and this is a NEW thing to do; a
 *   silent text swap in place reads as a typo being corrected.
 * - **The way out is always visible.** An owner who has understood it by step
 *   two must be able to leave at step two. A tutorial that can only be
 *   escaped by finishing it is a tutorial people learn to dread.
 * - **The counter says how many are left, not how many exist.** The number of
 *   steps differs by more than half between configurations, and "3 of 4" on a
 *   quick-billing stall is a different promise from "3 of 6" in a restaurant.
 */
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { ScreenEnter } from "@/components/ScreenEnter";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";

export interface PracticeCoachProps {
  /** Drives the re-entry animation — pass the step id. */
  stepKey: string;
  title: string;
  body: string;
  /** 1-based, for "Step 2 of 5". */
  index: number;
  total: number;
  onSkip: () => void;
}

export function PracticeCoach({
  stepKey,
  title,
  body,
  index,
  total,
  onSkip,
}: PracticeCoachProps) {
  return (
    <ScreenEnter replayKey={stepKey} distance={-10} duration={240}>
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {index} / {total}
            </Text>
          </View>
          <View style={styles.pips}>
            {Array.from({ length: total }, (_, i) => (
              <View
                key={i}
                style={[styles.pip, i < index && styles.pipOn]}
              />
            ))}
          </View>
          <PressableScale
            containerStyle={styles.skipHit}
            style={styles.skip}
            activeScale={0.95}
            haptic="dismiss"
            onPress={onSkip}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Leave the walkthrough"
          >
            <Text style={styles.skipText}>Skip</Text>
            <MaterialCommunityIcons
              name="close"
              size={13}
              color={colors.textMuted}
            />
          </PressableScale>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.offerBorder,
    ...shadow.float,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    marginBottom: space.s2,
  },
  badge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.s3,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.primary,
  },
  pips: { flex: 1, flexDirection: "row", gap: 4, alignItems: "center" },
  pip: {
    flex: 1,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
  },
  pipOn: { backgroundColor: colors.primary },
  skipHit: {},
  skip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: space.s1,
    paddingHorizontal: space.s2,
  },
  skipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: colors.text,
  },
  body: {
    marginTop: 3,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
