/**
 * One burst of confetti over whatever it is laid on top of.
 *
 * ## The load-bearing decisions
 *
 * - **Every piece hangs off ONE `Animated.Value` on the native driver.** A
 *   value per piece is forty timers on the JS thread, on the cheapest tablet
 *   this app is sold to, at the exact moment the screen underneath is
 *   animating in. One value interpolated forty ways costs the same as one.
 * - **Plain `Animated`, no library.** A confetti package is a native module
 *   or a Lottie file, and neither is worth a dependency for two seconds of
 *   paper.
 * - **It never takes a touch** (`pointerEvents="none"`). The button under it
 *   has to work from the first frame; a celebration that swallows the tap on
 *   "continue" is a celebration people learn to resent.
 * - **Reduce Motion means no burst at all**, not a gentler one. Whatever it
 *   is laid over must already say what happened without it.
 * - **It plays once and unmounts itself.** Spent pieces left in the tree are
 *   forty invisible views composited for as long as the screen stays up.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { colors } from "@/theme/theme";

const PIECES = 44;
const DURATION = 2200;
const PALETTE = [
  colors.primary,
  colors.accentBlue,
  colors.statusGreen,
  colors.statusIndigo,
  colors.statusRed,
  colors.ncAmberBorder,
];

interface Piece {
  color: string;
  width: number;
  height: number;
  round: boolean;
  /** Where it ends up sideways, from the launch point. */
  dx: number;
  /** How high it is thrown before it turns. */
  peak: number;
  /** How far below the launch point it has fallen by the end. */
  fall: number;
  spin: number;
  /** Fraction of the run it waits before leaving — what makes it a burst
   *  rather than a single sheet moving as one. */
  delay: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function Confetti({
  delay = 0,
  originY = 0.3,
}: {
  /** ms to wait before the burst — lets the thing being celebrated land. */
  delay?: number;
  /** Launch height, as a fraction of the window from the top. */
  originY?: number;
}) {
  const { width, height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [spent, setSpent] = useState(false);

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const size = rand(6, 11);
        const round = i % 5 === 0;
        return {
          color: PALETTE[i % PALETTE.length],
          width: size,
          height: round ? size : size * rand(0.4, 0.7),
          round,
          dx: rand(-0.55, 0.55) * width,
          peak: rand(0.08, 0.26) * height,
          fall: rand(0.45, 0.8) * height,
          spin: rand(2, 6) * (i % 2 === 0 ? 1 : -1),
          delay: rand(0, 0.12),
        };
      }),
    [width, height]
  );

  useEffect(() => {
    let live = true;
    let run: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return;
        if (reduce) {
          setSpent(true);
          return;
        }
        run = Animated.timing(t, {
          toValue: 1,
          duration: DURATION,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        });
        run.start(({ finished }) => {
          if (finished && live) setSpent(true);
        });
      });
    return () => {
      live = false;
      run?.stop();
    };
  }, [t, delay]);

  if (spent) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        const d = p.delay;
        const span = 1 - d;
        return (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                left: width / 2 - p.width / 2,
                top: height * originY,
                width: p.width,
                height: p.height,
                borderRadius: p.round ? p.width / 2 : 1.5,
                backgroundColor: p.color,
                opacity: t.interpolate({
                  inputRange: [0, d, d + 0.02, d + span * 0.75, 1],
                  outputRange: [0, 0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateX: t.interpolate({
                      inputRange: [0, d, 1],
                      outputRange: [0, 0, p.dx],
                    }),
                  },
                  {
                    // Up fast, hang, then down — four straight segments are
                    // enough to read as an arc at this speed.
                    translateY: t.interpolate({
                      inputRange: [
                        0,
                        d,
                        d + span * 0.12,
                        d + span * 0.26,
                        1,
                      ],
                      outputRange: [0, 0, -p.peak * 0.8, -p.peak, p.fall],
                    }),
                  },
                  {
                    rotate: t.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0deg", `${p.spin * 360}deg`],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute" },
});
