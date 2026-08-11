/**
 * The boot screen — what fills the gap between the native splash and the first
 * real screen.
 *
 * That gap is not small: fonts load, then Firebase resolves the session, and
 * until this existed all of it was spent on a bare spinner on grey. The app
 * showed its logo, threw it away, and came back a second later — which reads
 * as the app having restarted rather than having started.
 *
 * Two deliberate choices keep the handoff invisible:
 *
 *  - The background is the splash's own black, NOT the app canvas, so the
 *    native splash dissolving into this frame changes nothing on screen.
 *  - The name comes from the badge ARTWORK, not from a `<Text>`. This screen's
 *    first job is to cover the window where Plus Jakarta Sans has not loaded
 *    yet, and type set here would render in the system fallback face — the
 *    exact flash `_layout` holds the spinner to avoid.
 */
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Image } from "expo-image";

const BADGE = require("../../assets/brand/bb-badge.png");

/** The splash's background, matched to `expo-splash-screen` in app.json. */
const SPLASH_BG = "#0b0a08";
/** Picked off the badge's own lettering, so the spinner belongs to the logo. */
const GOLD = "#e9a93c";

export function BrandSplash() {
  return (
    <View style={styles.root}>
      <Image
        source={BADGE}
        style={styles.badge}
        contentFit="contain"
        transition={0}
        cachePolicy="memory-disk"
      />
      <ActivityIndicator size="small" color={GOLD} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SPLASH_BG,
  },
  badge: {
    width: 220,
    height: 220,
  },
  spinner: {
    marginTop: 28,
  },
});
