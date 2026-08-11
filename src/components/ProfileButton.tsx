/**
 * The way into Account, from the top-right of a module's own header.
 *
 * Account used to be the seventh tab. It did not belong there: the bottom bar
 * is for the modules a user *works in* during a shift, and Account is a place
 * you visit twice — once to set the printer up, once to sign out. Sitting in
 * the bar it cost a permanent slot and squeezed the five tabs that matter.
 *
 * It is a **stack screen now**, so it pushes and draws its own way back. This
 * button is therefore repeated in each tab screen's header rather than living
 * in one chrome component: every screen here paints its own header (the
 * navigator's is off), and a shared header would have to be retrofitted onto
 * six unrelated layouts to save six lines.
 *
 * Put it in the header's trailing position, and nowhere else — one door, in
 * one place, on every screen a role can land on.
 */
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { PressableScale } from "@/components/PressableScale";
import { colors, radius, space } from "@/theme/theme";

export function ProfileButton() {
  return (
    <PressableScale
      style={styles.btn}
      // Account is another screen, not a control on this one.
      haptic="press"
      activeScale={0.94}
      onPress={() => router.push("/account")}
      accessibilityRole="button"
      accessibilityLabel="Account and settings"
      hitSlop={8}
    >
      <Ionicons
        name="person-circle-outline"
        size={26}
        color={colors.text}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    // Optically centres the glyph against a title's cap-height rather than
    // against the whole text block, which includes the subtitle below it.
    marginTop: space.s1,
  },
});
