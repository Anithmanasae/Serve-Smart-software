/**
 * Product analytics (PostHog).
 *
 * One shared client for the whole app. When EXPO_PUBLIC_POSTHOG_KEY is not set
 * the client is null and every helper here is a no-op, so dev builds without a
 * key (and anyone cloning the repo) run unchanged.
 *
 * Privacy: we identify people by Firebase uid and attach role + restaurant id
 * only — no names, emails or phone numbers are sent.
 */
import PostHog from "posthog-react-native";
import type { Role } from "@/types/models";

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const posthog: PostHog | null = KEY
  ? new PostHog(KEY, {
      host: HOST,
      // Batch a little so a busy service doesn't send a request per tap.
      flushAt: 20,
      flushInterval: 10000,
    })
  : null;

/** Event names in one place so dashboards don't break on a typo. */
export type AnalyticsEvent =
  | "restaurant_registered"
  | "staff_signup_submitted"
  | "kot_sent"
  | "bill_generated"
  | "bill_settled";

export function capture(
  event: AnalyticsEvent,
  properties?: Record<string, string | number | boolean | null>
): void {
  posthog?.capture(event, properties ?? undefined);
}

/** Record a screen view — expo-router has no auto screen capture. */
export function captureScreen(pathname: string): void {
  void posthog?.screen(pathname);
}

/** Link this device's events to a signed-in staff member. */
export function identifyUser(uid: string, role: Role, restaurantId: string): void {
  if (!posthog) return;
  posthog.identify(uid, { role, restaurant_id: restaurantId });
  // Also stamp every future event so it can be filtered per restaurant/role.
  void posthog.register({ role, restaurant_id: restaurantId });
}

/** On sign-out: forget the person so the next login on this phone is separate. */
export function resetAnalytics(): void {
  posthog?.reset();
}
