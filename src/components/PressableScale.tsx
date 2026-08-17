/**
 * A Pressable that springs its content down to a smaller scale while held, for
 * tactile buttons (steppers, CTAs).
 *
 * The haptic fires on **touch-down**, together with the scale spring, not
 * after `onPress` has run. That pairing is the whole trick: the finger is
 * still moving, so the pulse reads as the button giving way under it rather
 * than as a delayed report that something happened. Firing it from the
 * handler instead puts the pulse behind a re-render (and sometimes behind a
 * network write), which is exactly what makes a haptic layer feel bolted on.
 *
 * Buttons that *open* something should say so — `haptic="press"` for a sheet
 * or a screen, `haptic="select"` for a chip or tab, `haptic={false}` where the
 * caller plays a more specific feel itself.
 */
import { type ReactNode, useCallback, useRef } from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { feel } from "@/lib/feedback";

interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  /** Style applied to the animated inner view (the visible surface). */
  style?: StyleProp<ViewStyle>;
  /**
   * Style for the OUTER touchable, which is the box the parent's layout sees.
   * Needed only when that box has to participate in a layout of its own —
   * `flex: 1` to fill a grid cell, say. Scaling the visible surface must not
   * change the space the control occupies, which is why the two are separate.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** Scale to spring to while pressed (default 0.9). */
  activeScale?: number;
  /** Feel played on touch-down; `false` to stay silent. Default `"tap"`. */
  haptic?: keyof typeof feel | false;
  children?: ReactNode;
}

export function PressableScale({
  style,
  containerStyle,
  activeScale = 0.9,
  haptic = "tap",
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = useCallback(
    (toValue: number) =>
      Animated.spring(scale, {
        toValue,
        useNativeDriver: true,
        speed: 50,
        bounciness: 8,
      }).start(),
    [scale]
  );

  return (
    <Pressable
      style={containerStyle}
      onPressIn={(e) => {
        spring(activeScale);
        if (haptic) feel[haptic]();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        spring(1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
