/**
 * Local notifications — the app's only way to say anything to an owner who
 * has closed it.
 *
 * ## Why LOCAL and not push
 *
 * Everything worth saying in the first few days is something the DEVICE
 * already knows: setup finished, no bill has been rung up yet, the first days
 * are running out. A remote push would need an FCM sender, a per-device token
 * registry, a Cloud Function that re-derives each tenant's state, and a
 * billing plan to run it on — all to deliver a message the tablet could have
 * scheduled for itself the moment setup completed. So it does.
 *
 * A local notification is handed to Android's AlarmManager at schedule time,
 * which means it fires whether or not the app is running and whether or not
 * there is a network. The trade is that its TEXT is fixed when it is
 * scheduled — which is why `nudges.ts` re-schedules the whole ladder whenever
 * the state it talks about changes, rather than trying to write one message
 * that stays true forever.
 *
 * Remote push is still the right answer for ONE thing — telling a kitchen
 * about an order while their app is backgrounded (see the TODOs in
 * `kotAlerts` / `newKotAlerts`). That needs a server because the device
 * genuinely does not know. This module is deliberately not that: putting a
 * re-engagement nudge and a "your food is ready" alert on one code path is
 * how the first one's noise budget eats the second one's credibility.
 *
 * ## The load-bearing decisions
 *
 * - **`expo-notifications` is a NATIVE module**, so this only works in a
 *   build made after it landed. Every entry point is wrapped and degrades to
 *   a silent no-op, exactly the way `kitchenChime` and `printerService` do.
 *   A `require` rather than a static import, for the same reason as there: a
 *   static import is hoisted and throws before any try/catch of ours can run.
 * - **Two channels, not one.** Android lets a user mute a channel without
 *   muting the app. "Getting started" is `LOW` (no sound, no heads-up) and is
 *   the only one this app schedules today; "Orders" is reserved at `HIGH` for
 *   the push work later. A nudge sharing a channel with a service alert is
 *   how the service alert gets turned off.
 * - **Permission is never requested on launch.** Android 13+ shows a system
 *   dialog for `POST_NOTIFICATIONS`, and a dialog that appears before the
 *   user knows what the app is gets denied — permanently, since a second
 *   `requestPermissionsAsync` no longer prompts. It is asked once, from the
 *   end of the setup wizard, where "we'll remind you what's next" is an
 *   obvious sentence. A denial is not an error anywhere.
 * - **Every notification we schedule is tagged** with `data.kind`, so
 *   `cancelTagged` clears ours without touching anything a future feature
 *   scheduled.
 */
import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";

/** The bits of `expo-notifications` this app uses. */
type NotificationsModule = typeof import("expo-notifications");

let mod: NotificationsModule | null | undefined;
let channelsReady = false;

/** Android channel ids. Stable strings — renaming one orphans the user's
 *  per-channel choice and silently re-enables what they had muted. */
export const CHANNEL_GETTING_STARTED = "getting-started";
export const CHANNEL_ORDERS = "orders";

/** Present on every notification this app schedules, so ours are cancellable
 *  as a group and a tap can be routed to the right screen. */
export interface NudgePayload {
  /** Which ladder this belongs to — the cancel key. */
  kind: "activation";
  /** In-app path to open when it is tapped. */
  route?: string;
  /** Which rung, for not double-scheduling and for reading a log. */
  step?: string;
}

function notifications(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  // Expo Go, SDK 53+: on Android the mere IMPORT throws. The package index
  // pulls in DevicePushTokenAutoRegistration, which registers a push-token
  // listener at module scope, and push was removed from Expo Go — so the
  // listener throws before any of our code runs. Metro reports a throw during
  // module init as a FATAL (the red box) instead of rethrowing it, so the
  // try/catch below never gets the chance to swallow it. Don't reach for the
  // module at all there; it is the same "this build can't do it" no-op as a
  // device with no native module, just detected one step earlier.
  if (Platform.OS === "android" && isRunningInExpoGo()) {
    mod = null;
    return mod;
  }
  try {
    mod = (require("expo-notifications") as NotificationsModule) ?? null;
  } catch {
    mod = null;
  }
  return mod;
}

/** Whether this build can post a local notification at all. */
export function notificationsAvailable(): boolean {
  return Platform.OS !== "web" && notifications() != null;
}

/**
 * Create the Android channels. Idempotent — `setNotificationChannelAsync`
 * updates an existing channel's name but cannot re-raise an importance the
 * user lowered, which is the correct behaviour.
 */
async function ensureChannels(): Promise<void> {
  const N = notifications();
  if (!N || channelsReady || Platform.OS !== "android") return;
  channelsReady = true;
  try {
    await N.setNotificationChannelAsync(CHANNEL_GETTING_STARTED, {
      name: "Getting started",
      description: "Occasional tips while you set up Smart Serve.",
      importance: N.AndroidImportance.LOW,
      showBadge: false,
    });
    await N.setNotificationChannelAsync(CHANNEL_ORDERS, {
      name: "Orders",
      description: "New orders, and food that is ready to go out.",
      importance: N.AndroidImportance.HIGH,
      showBadge: true,
    });
  } catch {
    // A device that refuses channels still delivers to the default one.
  }
}

/** Are we already allowed to post? Never prompts. */
export async function hasNotificationPermission(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    const { granted } = await N.getPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/**
 * Ask for permission, once, at a moment where the reason is on screen.
 *
 * Calling it again after a denial is harmless but pointless — the OS will not
 * show a dialog a second time, so this resolves `false` without the user
 * seeing anything.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    await ensureChannels();
    const existing = await N.getPermissionsAsync();
    if (existing.granted) return true;
    if (existing.canAskAgain === false) return false;
    const { granted } = await N.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

export interface ScheduledNudge {
  /** Short — Android truncates the title around 40 characters. */
  title: string;
  body: string;
  /** When it fires. Anything already past is dropped rather than fired now. */
  at: Date;
  data: NudgePayload;
}

/**
 * Replace every notification carrying `data.kind === kind` with `next`.
 *
 * Cancel-then-schedule rather than a diff: the ladder is a handful of entries,
 * and re-deriving it from current state is the only way a message whose text
 * depends on that state can stay true.
 */
export async function replaceScheduled(
  kind: NudgePayload["kind"],
  next: readonly ScheduledNudge[]
): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    await ensureChannels();
    await cancelTagged(kind);
    const now = Date.now();
    for (const n of next) {
      if (n.at.getTime() <= now) continue;
      await N.scheduleNotificationAsync({
        content: {
          title: n.title,
          body: n.body,
          data: n.data as unknown as Record<string, unknown>,
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: n.at,
          ...(Platform.OS === "android"
            ? { channelId: CHANNEL_GETTING_STARTED }
            : null),
        },
      });
    }
  } catch {
    // Nudges are a nicety. Never let one break the screen that scheduled it.
  }
}

/** Cancel every pending notification this app tagged with `kind`. */
export async function cancelTagged(kind: NudgePayload["kind"]): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    const pending = await N.getAllScheduledNotificationsAsync();
    for (const p of pending) {
      const data = p.content?.data as NudgePayload | undefined;
      if (data?.kind === kind) {
        await N.cancelScheduledNotificationAsync(p.identifier);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Route a tapped notification. Returns an unsubscribe, or a no-op on a build
 * without the native module.
 *
 * Also covers the COLD start: a tap that LAUNCHED the app is never delivered
 * to a listener, it is waiting in `getLastNotificationResponseAsync`. Missing
 * that case is why "tapping the notification just opens the app wherever it
 * was" is such a common bug.
 */
export function onNotificationTap(
  handler: (payload: NudgePayload) => void
): () => void {
  const N = notifications();
  if (!N) return () => {};
  let live = true;
  try {
    N.getLastNotificationResponseAsync()
      .then((res) => {
        const data = res?.notification?.request?.content?.data as
          | NudgePayload
          | undefined;
        if (live && data?.kind) handler(data);
      })
      .catch(() => {});
    const sub = N.addNotificationResponseReceivedListener((res) => {
      const data = res?.notification?.request?.content?.data as
        | NudgePayload
        | undefined;
      if (data?.kind) handler(data);
    });
    return () => {
      live = false;
      sub.remove();
    };
  } catch {
    return () => {
      live = false;
    };
  }
}
