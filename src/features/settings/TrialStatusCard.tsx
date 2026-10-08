/**
 * "Your access ends in 1 day 17 hours" — the countdown, plus a way to do
 * something about it.
 *
 * Renders NOTHING for a permanent restaurant: `accessEndsAt` is null and this
 * returns null. Otherwise it says one of three things:
 *
 *   renewing subscription   "Subscription active — Renews on 8 Nov". No
 *                           countdown and no alarm; the date moves by itself.
 *   cancelled subscription  the countdown, pointing at the Play Store.
 *   manual deadline         the countdown, pointing at us (activateTenant.js).
 *
 * The deadline itself comes from AuthContext, which resolves it from the
 * restaurant doc and the account doc together. This is display only —
 * firestore.rules is what actually stops the app working, against the server's
 * clock, so a device with a wrong date shows a wrong countdown but gains
 * nothing.
 */
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useAuth } from "@/features/auth/AuthContext";
import {
  CONTACT_NAME,
  activationRequestMessage,
  hasContact,
  openContactChat,
} from "@/config/contact";
import { feel } from "@/lib/feedback";
import { colors, space, radius, shadow } from "@/theme/theme";

/** Re-render once a minute so the countdown doesn't go stale on a screen the
 *  owner leaves open. Cheap: one setState per minute, and only while a
 *  deadline actually exists. */
const TICK_MS = 60_000;

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Your access has ended";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"} left`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}, ${minutes} min left`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

/** "8 Nov 2026" — a renewal date is read once, not watched tick down. */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TrialStatusCard() {
  const { accessEndsAt, restaurant, restaurantName, firebaseUser } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (accessEndsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [accessEndsAt]);

  // Permanent restaurant — nothing to say.
  if (accessEndsAt === null) return null;

  // A SUBSCRIPTION THAT RENEWS IS NOT RUNNING OUT.
  //
  // `accessEndsAt` is the end of the period already paid for, and for a
  // subscriber on auto-renew that date is about to move forward by itself.
  // Counting down to it put a red "2 minutes left — renew to keep working"
  // card in front of somebody who had just subscribed, and in real use would
  // do the same in the last days of every month. So a renewing subscription
  // gets a date and no alarm, and the countdown below is kept for the cases
  // where access really is ending: a cancelled subscription, or a manual
  // deadline.
  //
  // `subscription` is display-only and written by the billing functions; a
  // deadline set by hand with activateTenant.js leaves it stale, hence the
  // check that it still describes the deadline in force (the functions put
  // `expiresAt` at most a day past `paidThrough`).
  const subscription = restaurant?.subscription;
  const paidThroughMs = subscription?.paidThrough?.toMillis() ?? null;
  const describesDeadline =
    paidThroughMs !== null &&
    accessEndsAt >= paidThroughMs &&
    accessEndsAt - paidThroughMs <= 2 * 24 * 60 * 60 * 1000;

  if (subscription?.autoRenew && describesDeadline && paidThroughMs !== null) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.icon}>✨</Text>
          <View style={styles.headerText}>
            <Text style={styles.title}>Subscription active</Text>
            <Text style={styles.remaining}>
              {paidThroughMs > now
                ? `Renews on ${formatDate(paidThroughMs)}`
                : "Renewing now"}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          Billed by Google Play. To change or cancel, open the Play Store, tap
          your profile picture, then Payments and subscriptions.
        </Text>
      </View>
    );
  }

  // Cancelled, but paid up until the date below. The way back is the Play
  // Store, not a message to us — so no Contact button on this one.
  const cancelledSubscription = !!subscription && describesDeadline;

  const remaining = accessEndsAt - now;
  // Under a day, this stops being informational and starts being urgent.
  const urgent = remaining <= 24 * 60 * 60 * 1000;

  async function onContact() {
    const opened = await openContactChat(
      activationRequestMessage({
        restaurantName,
        email: firebaseUser?.email ?? null,
      }),
    );
    if (!opened) {
      Alert.alert(
        "Couldn't open WhatsApp",
        "Install WhatsApp, or contact us by phone to activate your restaurant.",
      );
    }
  }

  return (
    <View style={[styles.card, urgent && styles.cardUrgent]}>
      <View style={styles.header}>
        <Text style={styles.icon}>{urgent ? "⏳" : "✨"}</Text>
        <View style={styles.headerText}>
          <Text style={[styles.title, urgent && styles.titleUrgent]}>
            Your access
          </Text>
          <Text style={[styles.remaining, urgent && styles.remainingUrgent]}>
            {formatRemaining(remaining)}
          </Text>
        </View>
      </View>
      <Text style={styles.body}>
        {cancelledSubscription
          ? "Your subscription is set to end and won't renew. Everything you set up is saved and stays yours. To keep working without interruption, turn renewal back on in the Play Store under Payments and subscriptions."
          : "Everything you set up — your menu, tables and bills — is saved and stays yours. Renew any time to keep working without interruption."}
      </Text>
      {hasContact && !cancelledSubscription && (
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={onContact}
          onPressIn={feel.press}
        >
          <Text style={styles.buttonText}>Contact {CONTACT_NAME} to activate</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: space.s5,
    gap: space.s3,
    ...shadow.card,
  },
  cardUrgent: { borderColor: colors.danger },
  header: { flexDirection: "row", alignItems: "center", gap: space.s3 },
  icon: { fontSize: 28 },
  headerText: { flex: 1 },
  title: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.primary,
  },
  titleUrgent: { color: colors.danger },
  remaining: { fontSize: 18, fontWeight: "800", color: colors.text },
  remainingUrgent: { color: colors.danger },
  body: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    alignItems: "center",
  },
  buttonText: { color: colors.textInverse, fontWeight: "800", fontSize: 15 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
