/**
 * The boot screen — what fills the gap between the native splash and the first
 * real screen.
 *
 * That gap is not small: fonts load, then Firebase resolves the session, and
 * until this existed all of it was spent on a bare spinner on grey. The app
 * showed its logo, threw it away, and came back a second later — which reads
 * as the app having restarted rather than having started.
 *
 * Three deliberate choices keep the handoff invisible:
 *
 *  - The background is the splash's own navy, NOT the app canvas, so the
 *    native splash dissolving into this frame changes nothing on screen.
 *  - It draws the SAME `logo.png` the native splash does, at the same 200px
 *    `expo-splash-screen` sizes it to. Not the vector `BrandLogo`: the two
 *    lockups are built from one geometry but land on slightly different
 *    metrics, and a mark that shifts a few px at the handoff is exactly the
 *    stutter this screen exists to remove.
 *  - The wordmark therefore comes from the ARTWORK, not from a `<Text>`. This
 *    screen's first job is to cover the window where Plus Jakarta Sans has not
 *    loaded yet, and type set here would render in the system fallback face —
 *    the exact flash `_layout` holds the spinner to avoid.
 */
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Image } from "expo-image";

const LOGO = require("../../assets/brand/logo.png");

/** The splash's background, matched to `expo-splash-screen` in app.json. */
const SPLASH_BG = "#00336F";
/** The mark is painted white on the navy, so the spinner is too. */
const ON_SPLASH = "#ffffff";

/** `expo-splash-screen`'s default logo width; the artwork is 701x532. */
const LOGO_W = 200;
const LOGO_H = Math.round(LOGO_W / (701 / 532));

export function BrandSplash() {
  return (
    <View style={styles.root}>
      <Image
        source={LOGO}
        style={styles.logo}
        contentFit="contain"
        // The lockup is ink on transparency; letting it fade in would flash a
        // hole where the native splash just had the logo.
        transition={0}
        cachePolicy="memory-disk"
      />
      <ActivityIndicator size="small" color={ON_SPLASH} style={styles.spinner} />
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
  logo: {
    width: LOGO_W,
    height: LOGO_H,
  },
  spinner: {
    marginTop: 28,
  },
});
