/**
 * "Continue with Google" — the button, shared by `/signup` and `/login`.
 *
 * One component for both screens on purpose. A sign-in method that looks like
 * one thing on the way in and another on the way back is a method people stop
 * trusting, and the two screens are exactly where someone compares what they
 * did last time with what they are being offered now. Only the label differs.
 *
 * The look is Google's, not ours: white surface, hairline border, the
 * four-colour G, and the words "Continue with Google". That is a brand
 * requirement rather than a design choice — this is the one control in Smart
 * Serve that is deliberately NOT navy, because a navy button with a G on it
 * reads as our own button doing something Google-ish.
 *
 * The mark is drawn as SVG rather than shipped as a PNG so it stays crisp on a
 * 10" tablet and costs no asset to keep in step.
 */
import Svg, { Path } from "react-native-svg";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { feel } from "@/lib/feedback";
import { colors, fonts, radius, space } from "@/theme/theme";

/** The official Google "G", on a 48×48 grid. */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

export function GoogleButton({
  label = "Continue with Google",
  /** Shown while this button's own flow is running. */
  busy = false,
  /** True while ANY sign-in on the screen is running — including this one. */
  disabled = false,
  onPress,
}: {
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      // `press` rather than `tap`: this opens Google's account sheet over the
      // app, which is the same kind of event as opening one of our own.
      onPressIn={feel.press}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <GoogleMark />
      <Text style={styles.text}>{busy ? "Opening Google…" : label}</Text>
      {/* Keeps the label optically centred against the mark on the left. */}
      <View style={styles.markSpacer} />
    </Pressable>
  );
}

/**
 * "or" between the two ways in.
 *
 * A rule with a word on it, not a heading: the email form underneath is not a
 * lesser option, it is the other one, and it stays the only one that works on
 * a build with no Google support.
 */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const MARK_SIZE = 20;

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: space.s4,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  // Google's own guidance is a dark neutral on white, never our navy — the
  // button belongs to them.
  text: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  markSpacer: { width: MARK_SIZE },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    marginVertical: space.s2,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
  },
});
