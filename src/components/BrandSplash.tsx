/**
 * The boot screen — what fills the gap between the native splash and the first
 * real screen.
 *
 * That gap is not small: fonts load, then Firebase resolves the session, and
 * until this existed all of it was spent on a bare spinner on grey. The app
 * showed its logo, threw it away, and came back a second later — which reads
 * as the app having restarted rather than having started.
 *
 * Two components share one stage:
 *
 *  - `BootSplash` is the launch itself. `app/_layout.tsx` lays ONE of them
 *    over the whole app, so it survives the fonts arriving and the navigator
 *    mounting underneath it, and leaves by dissolving into the first screen.
 *  - `BrandSplash` is the same picture standing still — what a screen returns
 *    while it waits on something after launch.
 *
 * The choices that keep the handoff from the native splash invisible:
 *
 *  - The background is the splash's own navy, NOT the app canvas, so the
 *    native splash dissolving into this frame changes nothing on screen.
 *  - It draws the SAME `logo.png` the native splash does, at the same width —
 *    `imageWidth` on `expo-splash-screen` in app.json, which MUST equal
 *    `LOGO_W` here. The plugin's own default is 100, so leaving it unset
 *    doubles the logo at the handoff. Not the vector `BrandLogo` either: the
 *    two lockups are built from one geometry but land on slightly different
 *    metrics, and a mark that shifts a few px at the handoff is exactly the
 *    stutter this screen exists to remove.
 *  - The wordmark therefore comes from the ARTWORK, not from a `<Text>`. This
 *    screen's first job is to cover the window where Plus Jakarta Sans has not
 *    loaded yet, and type set here would render in the system fallback face.
 *  - **The first frame is the native splash exactly**: the logo dead centre
 *    and nothing else. The loader hangs off the logo absolutely so it cannot
 *    push it off centre, and only then does the logo lift to make room.
 *
 * And the motion:
 *
 *  - **The loader is the mark's own sparkle**, three of them twinkling in
 *    turn, rather than the OS spinner — the one moving thing on the screen
 *    should belong to the brand.
 *  - **One beat drives every sparkle on every instance**, ref-counted like the
 *    skeleton pulse in `Skeleton.tsx`. The launch overlay sits on top of a
 *    screen that is often showing a `BrandSplash` of its own; two loops would
 *    drift, and the dissolve between them would show it.
 *  - **Everything is on the native driver.** The JS thread is busy with the
 *    very work this screen is waiting for.
 *  - **Nothing here ever delays the app.** There is no minimum display time;
 *    the exit starts from wherever the entrance had got to.
 *  - **Reduce Motion stops the twinkle and the zoom**, and leaves the fades.
 */
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { sparklePath } from "@/components/BrandLogo";

const LOGO = require("../../assets/brand/logo.png");

/** The splash's background, matched to `expo-splash-screen` in app.json. */
const SPLASH_BG = "#00336F";
/** The mark is painted white on the navy, so the loader is too. */
const ON_SPLASH = "#ffffff";

/** `imageWidth` on `expo-splash-screen` in app.json; the artwork is 701x532. */
const LOGO_W = 200;
const LOGO_H = Math.round(LOGO_W / (701 / 532));

/** How far the logo rises to make room for the loader beneath it. */
const LIFT = 14;
/** Hold the native splash's exact frame for a beat before anything moves. */
const SETTLE_DELAY_MS = 120;
const SETTLE_MS = 420;
const EXIT_MS = 320;

const SPARKLE = 14;
const SPARKLE_PATH = sparklePath(10, 10, 10);
/** One full pass across the three sparkles. */
const BEAT_MS = 1200;
/** Where in the beat each sparkle peaks. */
const PEAKS = [0.25, 0.45, 0.65];

/** Shared driver: 0 → 1 is one pass across the sparkles. */
const beat = new Animated.Value(0);
const sparkleStyles = PEAKS.map((p) => {
  const inputRange = [0, p - 0.2, p, p + 0.2, 1];
  return {
    opacity: beat.interpolate({
      inputRange,
      outputRange: [0.35, 0.35, 1, 0.35, 0.35],
    }),
    transform: [
      {
        scale: beat.interpolate({
          inputRange,
          outputRange: [0.6, 0.6, 1, 0.6, 0.6],
        }),
      },
      {
        // A four-point star is the same shape every quarter turn, so the
        // twist reads as a twinkle and the loop restarts with no seam.
        rotate: beat.interpolate({
          inputRange,
          outputRange: ["0deg", "0deg", "45deg", "90deg", "90deg"],
        }),
      },
    ],
  };
});

let onScreen = 0;
let loop: Animated.CompositeAnimation | null = null;
/** Asked for once per launch, then cached — same policy as the skeletons. */
let reduceMotion: boolean | null = null;

async function startBeat(): Promise<void> {
  if (reduceMotion === null) {
    reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(
      () => false
    );
  }
  // The awaited probe means the last splash may have unmounted since the
  // call, or a second one may have started the loop already.
  if (reduceMotion || loop !== null || onScreen === 0) return;
  loop = Animated.loop(
    Animated.timing(beat, {
      toValue: 1,
      duration: BEAT_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
  );
  loop.start();
}

function useBeat(): void {
  useEffect(() => {
    onScreen += 1;
    if (onScreen === 1) void startBeat();
    return () => {
      onScreen -= 1;
      if (onScreen > 0) return;
      loop?.stop();
      loop = null;
      beat.setValue(0);
    };
  }, []);
}

/** A splash that is neither arriving nor leaving. */
const SETTLED = new Animated.Value(1);
const STAYING = new Animated.Value(0);

/**
 * The picture itself. `settle` runs 0 → 1 as the logo lifts and the loader
 * arrives; `exit` runs 0 → 1 as the whole stage dissolves.
 */
function SplashStage({
  settle,
  exit,
}: {
  settle: Animated.Value;
  exit: Animated.Value;
}) {
  useBeat();

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: exit.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
          }),
        },
      ]}
    >
      <View style={styles.lockup}>
        <Animated.View
          style={{
            // Gone by 60% of the exit, so the navy outlives the logo and the
            // first screen is never seen through a ghost of the mark.
            opacity: exit.interpolate({
              inputRange: [0, 0.6, 1],
              outputRange: [1, 0, 0],
            }),
            transform: [
              {
                translateY: settle.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -LIFT],
                }),
              },
              {
                scale: exit.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, reduceMotion ? 1 : 1.14],
                }),
              },
            ],
          }}
        >
          <Image
            source={LOGO}
            style={styles.logo}
            contentFit="contain"
            // The lockup is ink on transparency; letting it fade in would
            // flash a hole where the native splash just had the logo.
            transition={0}
            cachePolicy="memory-disk"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.loader,
            {
              opacity: Animated.multiply(
                settle,
                exit.interpolate({
                  inputRange: [0, 0.3, 1],
                  outputRange: [1, 0, 0],
                })
              ),
              transform: [
                {
                  translateY: settle.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {sparkleStyles.map((style, i) => (
            <Animated.View key={i} style={style}>
              <Svg width={SPARKLE} height={SPARKLE} viewBox="0 0 20 20">
                <Path d={SPARKLE_PATH} fill={ON_SPLASH} />
              </Svg>
            </Animated.View>
          ))}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** The splash standing still — a screen's answer to "not ready yet". */
export function BrandSplash() {
  return <SplashStage settle={SETTLED} exit={STAYING} />;
}

/**
 * The launch. Mounted once, over everything, by `app/_layout.tsx`.
 *
 * `leaving` turns true when the first real screen is in place underneath;
 * `onGone` fires when the dissolve has finished and this can be unmounted.
 * Touches pass through from the moment it starts to leave — the screen below
 * is already live, and a tap swallowed by a fading logo is a tap lost.
 */
export function BootSplash({
  leaving,
  onGone,
}: {
  leaving: boolean;
  onGone: () => void;
}) {
  const settle = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(settle, {
      toValue: 1,
      duration: SETTLE_MS,
      delay: SETTLE_DELAY_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [settle]);

  useEffect(() => {
    if (!leaving) return;
    Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
      // Finished or interrupted, the overlay must still come off.
    }).start(() => onGone());
  }, [leaving, exit, onGone]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={leaving ? "none" : "auto"}
    >
      <SplashStage settle={settle} exit={exit} />
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
  // Exactly the logo's box, so the logo — not the logo plus its loader — is
  // what gets centred.
  lockup: {
    width: LOGO_W,
    height: LOGO_H,
  },
  logo: {
    width: LOGO_W,
    height: LOGO_H,
  },
  loader: {
    position: "absolute",
    top: LOGO_H + LIFT,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
});
