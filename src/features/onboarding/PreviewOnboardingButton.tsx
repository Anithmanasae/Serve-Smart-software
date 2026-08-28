/**
 * TEMPORARY — ONBOARDING_PREVIEW.
 *
 * A test-only button on the signup screen that opens the first-run wizard
 * from the top, as many times as you like, without registering a restaurant
 * each time. Deliberately drawn as scaffolding — dashed, muted, small — so it
 * can never be mistaken for part of the product on a customer's device.
 *
 * TO REMOVE when testing is done: delete this file, delete
 * `app/setup-preview.tsx`, and delete the two lines in `app/signup.tsx`
 * tagged `ONBOARDING_PREVIEW`. `grep -rn ONBOARDING_PREVIEW` finds all of it.
 */
import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { feel } from "@/lib/feedback";
import { colors, fonts, radius, space } from "@/theme/theme";

export function PreviewOnboardingButton() {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={() => router.push("/setup-preview")}
      onPressIn={feel.press}
      accessibilityRole="button"
      accessibilityLabel="Preview onboarding, test only"
    >
      <Text style={styles.text}>▶  Preview onboarding · test only</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
    marginTop: space.s2,
  },
  pressed: { opacity: 0.6 },
  text: {
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textMuted,
  },
});
