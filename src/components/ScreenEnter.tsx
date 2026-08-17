/**
 * Settles a screen's content into place on mount — a short rise and fade.
 *
 * It exists because keeping the tab bar on a table's order cost that screen its
 * push animation: a table is a hidden tab now (see `app/(app)/(tabs)/_layout`),
 * and tabs cross-fade. A bare cross-fade says "you swapped modules", which is
 * the wrong sentence for having deliberately opened a table. This adds the
 * missing half — the content arrives from slightly below, so the trip still
 * reads as going INTO something — without a second navigator transition, which
 * is what made it turn twice before.
 *
 * Deliberately small numbers. 14dp and 260ms is under the threshold where a
 * waiter waits for it; a bigger move on a screen opened forty times a shift
 * becomes forty small delays. It is a settle, not an entrance.
 *
 * Native-driven (opacity + transform only), so it does not compete with the
 * menu grid mounting on the JS thread.
 *
 * `replayKey` restarts it — pass the table id, so moving from one table to
 * another re-animates rather than sitting still because the screen happened to
 * stay mounted.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

export function ScreenEnter({
  children,
  style,
  replayKey,
  distance = 14,
  duration = 260,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Change this to play the animation again on an already-mounted screen. */
  replayKey?: string | number;
  /** How far below its resting place the content starts, in dp. */
  distance?: number;
  duration?: number;
}) {
  // One driver for both properties: they are one movement, and separate values
  // are how a fade and a slide drift out of step.
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration,
      // Decelerate: fast at the start, easing into rest. Matches the springs
      // the buttons use — nothing in this app arrives at a constant speed.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, replayKey, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [
            {
              translateY: t.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
