/**
 * Skeleton placeholders — the shape of the content that is coming, drawn in
 * grey while it loads.
 *
 * Why these exist at all: every tab in this app mounts cold (`lazy` +
 * `freezeOnBlur` in `app/(app)/(tabs)/_layout.tsx`) and then waits on a
 * Firestore snapshot, so a centred spinner is the *first* thing a cashier sees
 * on Bills, Insights, the menu grid and the KDS board. A bone layout in the
 * shape of the real screen says what is arriving and roughly how much of it,
 * and the swap to real content moves nothing.
 *
 * The load-bearing decisions:
 *
 * - **One pulse drives every bone in the app.** A per-bone loop starts when
 *   its component mounts, so a grid of twelve cards breathes in twelve
 *   different phases and reads as noise rather than as one surface. A single
 *   module-level `Animated.Value` keeps them locked in step, and costs one
 *   native driver instead of twelve.
 * - **The loop runs only while bones are on screen**, ref-counted on mount, so
 *   nothing is animating behind a screen that finished loading.
 * - **Opacity, `useNativeDriver: true`.** The pulse never touches the JS
 *   thread — which matters precisely because that thread is busy with the
 *   snapshot the skeleton is waiting for. Never animate these off the driver.
 * - **Reduce Motion stops the pulse, not the skeleton.** The bones still hold
 *   the layout, they just stop breathing — same principle as haptics letting
 *   the OS own that choice.
 */
import { useEffect, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius } from "@/theme/theme";

/** Half-period of the breath. Slow enough to read as waiting, not as a blink. */
const PERIOD = 750;

/** Shared driver: 0 = solid bone, 1 = faded bone. */
const pulse = new Animated.Value(0);
const boneOpacity = pulse.interpolate({
  inputRange: [0, 1],
  outputRange: [1, 0.45],
});

let onScreen = 0;
let loop: Animated.CompositeAnimation | null = null;
/** Asked for once per launch, then cached — same policy as the haptics probe. */
let reduceMotion: boolean | null = null;

async function startPulse(): Promise<void> {
  if (reduceMotion === null) {
    reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(
      () => false
    );
  }
  // The awaited probe means the last bone may have unmounted since the call,
  // or a second bone may have started the loop already.
  if (reduceMotion || loop !== null || onScreen === 0) return;
  loop = Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: PERIOD,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: PERIOD,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ])
  );
  loop.start();
}

function usePulse(): Animated.AnimatedInterpolation<number> {
  useEffect(() => {
    onScreen += 1;
    if (onScreen === 1) void startPulse();
    return () => {
      onScreen -= 1;
      if (onScreen > 0) return;
      loop?.stop();
      loop = null;
      pulse.setValue(0);
    };
  }, []);
  return boneOpacity;
}

interface BoneProps {
  /** Omit to take the width the parent gives it. */
  width?: DimensionValue;
  /** Defaults to a line of body text. */
  height?: DimensionValue;
  /** Corner radius. Default suits text lines and small blocks. */
  round?: number;
  style?: StyleProp<ViewStyle>;
}

/** One grey block standing in for one piece of content. */
export function Bone({
  width,
  height = 12,
  round = radius.sm,
  style,
}: BoneProps) {
  const opacity = usePulse();
  return (
    <Animated.View
      // A bone is decoration for something that is not there yet: a screen
      // reader should hear the skeleton's single "Loading", not eleven boxes.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.bone,
        { width, height, borderRadius: round },
        style,
        { opacity },
      ]}
    />
  );
}

/**
 * Wraps a screen's bone layout. Collapses the whole placeholder into one
 * accessibility node so assistive tech hears "Loading" once instead of
 * walking a tree of empty boxes.
 */
export function Skeleton({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bone: { backgroundColor: colors.skeleton },
});
