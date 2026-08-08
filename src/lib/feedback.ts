/**
 * Micro-interaction feedback: the app's haptic vocabulary, plus an eased
 * layout transition for list-shape changes (rows added/removed, cards
 * entering/leaving a board).
 *
 * ## Why this isn't just `Haptics.impactAsync`
 *
 * Smart Serve runs on Android tablets, and on Android `impactAsync` /
 * `notificationAsync` drive the raw `Vibrator` with a hand-rolled waveform —
 * the whole motor is switched on for a fixed duration and amplitude. That is
 * the cheap buzz you feel in a budget app, and no amount of picking between
 * `Light` and `Medium` fixes it, because they are the same blunt instrument at
 * two durations. expo-haptics says as much in its own docs.
 *
 * `performAndroidHapticsAsync` instead routes to the platform's
 * `View.performHapticFeedback` with a `HapticFeedbackConstants` value, so the
 * OS renders the effect on its own tuned composition primitives — crisp ticks
 * and clicks rather than a motor blast. It also needs no `VIBRATE` permission
 * and honours the user's system-wide touch-feedback setting, which is why
 * there's no in-app mute switch: the OS already owns that choice.
 *
 * So every feel below is defined twice — as an Android constant (with a
 * fallback chain, since the good constants only exist on API 30/34+) and as
 * the iOS generator that matches it.
 *
 * ## The vocabulary
 *
 * Reach for the *meaning*, never the strength. If two things feel the same
 * they are telling the user they are the same thing, which is how a haptic
 * layer turns into noise.
 *
 *   feel.select()          moving through choices — chips, tabs, filters
 *   feel.tick()            the same, but repeatable — a held stepper
 *   feel.tap()             an ordinary button, on touch-down
 *   feel.press()           something opens — a sheet, a modal, a screen
 *   feel.dismiss()         that same something closes
 *   feel.toggleOn/Off()    a switch changed state, and you feel which way
 *   feel.success()         a write committed — KOT fired, bill settled
 *   feel.warn()            caution — a destructive confirm is on screen
 *   feel.heavy()           a destructive thing actually happened
 *   feel.error()           it failed, or the app refused
 */
import { LayoutAnimation, Platform, UIManager } from "react-native";
import * as Haptics from "expo-haptics";

const { AndroidHaptics: A, ImpactFeedbackStyle: Impact, NotificationFeedbackType: Notify } =
  Haptics;

// Classic-architecture Android needs the explicit opt-in; no-op elsewhere.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * One entry of the vocabulary.
 *
 * `android` is a preference order, not a single value: `SEGMENT_TICK` and
 * friends only exist from API 34, `CONFIRM`/`REJECT`/`TOGGLE_*` from API 30,
 * and expo throws for a constant the device doesn't have. Each chain
 * therefore ends on one of the five constants present on every API level
 * (`CLOCK_TICK`, `CONTEXT_CLICK`, `KEYBOARD_TAP`, `LONG_PRESS`, `VIRTUAL_KEY`),
 * so an older tablet degrades to a coarser *but still native* effect instead
 * of falling off a cliff back to the buzzer.
 *
 * `minGap` is the coalescing window — see `shouldFire`.
 */
interface Feel {
  android: Haptics.AndroidHaptics[];
  /**
   * The `expo-haptics` generator call. This is the iOS path — where it maps
   * straight onto `UIFeedbackGenerator` and is the right API — and doubles as
   * the last-resort Android fallback described in `performAndroid`.
   */
  generator: () => Promise<void>;
  minGap: number;
}

/** Frequent, low-stakes feels collapse if they land on top of each other. */
const GAP_LIGHT = 45;
/** A press and its outcome are distinct events; never swallow the outcome. */
const GAP_NONE = 0;

const FEELS = {
  select: {
    android: [A.Segment_Tick, A.Clock_Tick],
    generator: () => Haptics.selectionAsync(),
    minGap: GAP_LIGHT,
  },
  tick: {
    // Explicitly the "soft enough to repeat" constant: Android is allowed to
    // render nothing at all rather than be uncomfortable at speed.
    android: [A.Segment_Frequent_Tick, A.Clock_Tick],
    generator: () => Haptics.selectionAsync(),
    minGap: 30,
  },
  tap: {
    android: [A.Virtual_Key],
    generator: () => Haptics.impactAsync(Impact.Light),
    minGap: GAP_LIGHT,
  },
  press: {
    android: [A.Gesture_Start, A.Context_Click],
    generator: () => Haptics.impactAsync(Impact.Medium),
    minGap: GAP_LIGHT,
  },
  dismiss: {
    android: [A.Gesture_End, A.Context_Click],
    generator: () => Haptics.impactAsync(Impact.Soft),
    minGap: GAP_LIGHT,
  },
  toggleOn: {
    android: [A.Toggle_On, A.Virtual_Key],
    generator: () => Haptics.impactAsync(Impact.Rigid),
    minGap: GAP_LIGHT,
  },
  toggleOff: {
    android: [A.Toggle_Off, A.Virtual_Key],
    generator: () => Haptics.impactAsync(Impact.Soft),
    minGap: GAP_LIGHT,
  },
  success: {
    android: [A.Confirm, A.Virtual_Key],
    generator: () => Haptics.notificationAsync(Notify.Success),
    minGap: GAP_NONE,
  },
  warn: {
    android: [A.Long_Press],
    generator: () => Haptics.notificationAsync(Notify.Warning),
    minGap: GAP_NONE,
  },
  heavy: {
    android: [A.Long_Press],
    generator: () => Haptics.impactAsync(Impact.Heavy),
    minGap: GAP_NONE,
  },
  error: {
    android: [A.Reject, A.Long_Press],
    generator: () => Haptics.notificationAsync(Notify.Error),
    minGap: GAP_NONE,
  },
} satisfies Record<string, Feel>;

/** Constants this device has already rejected — never retried. */
const unsupported = new Set<Haptics.AndroidHaptics>();

/** A repeat of the *same* feel this close together is always a mistake. */
const REPEAT_WINDOW = 120;

let lastFireAt = 0;
let lastFeel = "";

/**
 * Collapse haptics that arrive on top of each other.
 *
 * A single tap can legitimately reach this module twice — the button plays
 * its own touch-down feel and the handler then reports what it did — and two
 * pulses inside one gesture read as a stutter, not as detail. Two rules:
 *
 * - The same feel twice inside `REPEAT_WINDOW` is always dropped. Nothing
 *   means "this happened, twice, 5ms apart", so a duplicate is a bug in the
 *   wiring and should be absorbed rather than played.
 * - Otherwise a feel waits out its own `minGap`. Outcomes (success, warning,
 *   error) set that to 0 so they are never swallowed by the press that
 *   caused them — an outcome has to survive whatever preceded it.
 */
function shouldFire(name: string, minGap: number): boolean {
  const now = Date.now();
  const since = now - lastFireAt;
  if (name === lastFeel && since < REPEAT_WINDOW) return false;
  if (minGap > 0 && since < minGap) return false;
  lastFireAt = now;
  lastFeel = name;
  return true;
}

/**
 * Walk the Android preference chain until one constant is accepted, caching
 * the rejections so an old device pays the failed call once per launch rather
 * than on every press.
 */
async function performAndroid(spec: Feel): Promise<void> {
  for (const type of spec.android) {
    if (unsupported.has(type)) continue;
    try {
      await Haptics.performAndroidHapticsAsync(type);
      return;
    } catch {
      unsupported.add(type);
    }
  }
  // Exhausting a chain that ends on an always-present constant means the
  // native `performHapticsAsync` isn't there at all — an OTA update running
  // new JS against an APK built before expo-haptics 57. Fall back to the old
  // Vibrator path: it is the coarse buzz this module exists to get away from,
  // but on that build the only alternative is no haptics whatsoever.
  await spec.generator();
}

function play(name: string, spec: Feel): void {
  if (!shouldFire(name, spec.minGap)) return;
  const run = Platform.OS === "android" ? performAndroid(spec) : spec.generator();
  // Haptics are decoration: a device without a motor, a denied system setting
  // or a backgrounded activity must never surface as an error to the caller.
  void run.catch(() => {});
}

type FeelName = keyof typeof FEELS;

/**
 * The app's haptic vocabulary. Pick by meaning — see the file header.
 *
 * Each entry is a bare function, so it can be handed straight to a prop
 * (`onPressIn={feel.tap}`) without a wrapper closure.
 */
export const feel = Object.fromEntries(
  (Object.keys(FEELS) as FeelName[]).map((name) => [
    name,
    () => play(name, FEELS[name]),
  ])
) as Record<FeelName, () => void>;

/**
 * `feel.toggleOn` or `feel.toggleOff` for the state being moved *to*, so the
 * hand can tell which way a switch went without looking at it.
 */
export function feelToggle(nextValue: boolean): void {
  if (nextValue) feel.toggleOn();
  else feel.toggleOff();
}

/** Ease the next layout change; call right before the state/write that
 *  reshapes a list so the reflow slides instead of jumping. */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}
