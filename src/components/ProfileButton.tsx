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
 *
 * It draws the signed-in user's INITIAL, not a person glyph:
 *
 * - These are shared floor tablets. The question staff actually have is
 *   "which login is this one on", and an initial answers it for free, in the
 *   corner, on every screen. A silhouette answers nothing — it is the same
 *   picture whoever is signed in.
 * - A top-right avatar → account is the most-learned pattern in mobile
 *   software, so the door costs no teaching even though the room behind it is
 *   mostly settings.
 * - It was an outlined person-in-a-circle inside a bordered pill: two
 *   concentric rings, and an outline that goes mushy at arm's length. The
 *   solid disc is the same treatment every other filled control here gets.
 *
 * Bills used to draw this exact disc a second time, on the LEFT of the same
 * header row, purely as decoration — so the circle that looked most like
 * "you" did nothing and the one that was the button looked like a label. That
 * one is gone; this is the only avatar in the app.
 */
import { StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { PressableScale } from "@/components/PressableScale";
import { useAuth } from "@/features/auth/AuthContext";
import { colors, radius } from "@/theme/theme";

/** First letter of a name, or null when there is nothing to show yet. */
function initialOf(name?: string | null) {
  const ch = (name ?? "").trim().charAt(0);
  return ch ? ch.toUpperCase() : null;
}

export function ProfileButton() {
  const { profile } = useAuth();
  const initial = initialOf(profile?.name);

  return (
    <PressableScale
      style={styles.btn}
      // Account is another screen, not a control on this one.
      haptic="press"
      activeScale={0.94}
      onPress={() => router.push("/account")}
      accessibilityRole="button"
      accessibilityLabel={
        profile?.name
          ? `Account and settings, signed in as ${profile.name}`
          : "Account and settings"
      }
      hitSlop={8}
    >
      {/* The disc is the same size and colour either way, so nothing shifts
          when the profile document lands a moment after first paint. */}
      {initial ? (
        <Text style={styles.initial}>{initial}</Text>
      ) : (
        <Ionicons name="person" size={20} color={colors.textInverse} />
      )}
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
    backgroundColor: colors.primary,
    // No optical nudge here. It used to carry `marginTop: space.s1` to sit
    // against a title's cap-height — right in the one header where it is the
    // lone right-hand control, wrong in the three where it sits beside a pill
    // button or the KITCHEN tag, which it then hung 4px below. That nudge is
    // ScreenHeader's job now, applied to the whole trailing cluster at once.
  },
  initial: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textInverse,
    // The glyph's own leading would sit the letter a hair low in a circle
    // this small; nulling it lets `justifyContent` do the centring.
    includeFontPadding: false,
  },
});
