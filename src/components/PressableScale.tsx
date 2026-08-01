/**
 * A Pressable that springs its content down to a smaller scale while held, for
 * tactile buttons (steppers, CTAs). Presentation only — it forwards the press
 * to `onPress`; callers own any haptics/logic.
 */
import { type ReactNode, useCallback, useRef } from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  /** Style applied to the animated inner view (the visible surface). */
  style?: StyleProp<ViewStyle>;
  /** Scale to spring to while pressed (default 0.9). */
  activeScale?: number;
  children?: ReactNode;
}

export function PressableScale({
  style,
  activeScale = 0.9,
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
      onPressIn={(e) => {
        spring(activeScale);
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
