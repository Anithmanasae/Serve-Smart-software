/**
 * Micro-interaction helpers: a light haptic tap confirming a POS action and
 * an eased layout transition for list-shape changes (rows added/removed,
 * cards entering/leaving a board).
 */
import { LayoutAnimation, Platform, UIManager } from "react-native";
import * as Haptics from "expo-haptics";

// Classic-architecture Android needs the explicit opt-in; no-op elsewhere.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Light impact on action confirm (add item, send KOT, KDS step, settle). */
export function tapFeedback(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Medium impact for a weightier tap (e.g. opening a table card or sheet). */
export function mediumTapFeedback(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Success notification for a completed action (e.g. firing a KOT). */
export function successFeedback(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {}
  );
}

/** Ease the next layout change; call right before the state/write that
 *  reshapes a list so the reflow slides instead of jumping. */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}
