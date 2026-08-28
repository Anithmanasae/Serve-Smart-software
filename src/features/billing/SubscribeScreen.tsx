/**
 * The paywall — shown to an owner whose trial has ended.
 *
 * ## Why this screen barely does anything
 *
 * It does not unlock the app. It cannot: `firestore.rules` forbids every
 * client from writing `expiresAt`. All it does is get a purchase token to the
 * server and then WAIT — `AuthContext` is already watching the restaurant doc,
 * so when the server writes the paid-through date this screen's `profile`
 * turns non-null and the router leaves for the floor by itself. Same mechanism
 * that already unlocks a device when you run `activateTenant.js` by hand.
 *
 * That is why there is no "you're in!" navigation here, and no local "paid"
 * state to get out of sync. The restaurant document is the only truth.
 *
 * ## The load-bearing decisions
 *
 * - **Restore runs on mount, before the owner can press anything.** The two
 *   ways to arrive here with a live subscription already paid for are a
 *   reinstall and a verification that failed on a bad network right after
 *   paying. Both are indistinguishable from "never paid" until you ask Play,
 *   and an owner who has paid must never be shown a price again.
 * - **Prices come from Play, formatted by Play.** Never hardcode "₹799" — Play
 *   knows the buyer's country, currency and tax. A price rendered by us is a
 *   price that will one day disagree with the one they are charged.
 * - **Owner only.** Staff never reach this route; they see the ordinary
 *   "ask your manager" copy on `/pending`. A waiter who could subscribe could
 *   also subscribe by accident, on their own card.
 * - **Falls back to the existing contact flow.** If this build has no billing
 *   module, or Play returns nothing, the screen offers the WhatsApp path that
 *   worked before billing existed rather than dead-ending.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import {
  CONTACT_NAME,
  activationRequestMessage,
  hasContact,
  openContactChat,
} from "@/config/contact";
import {
  closeBilling,
  getOffers,
  isBillingAvailable,
  restore,
  subscribe,
  type SubscriptionOffer,
} from "@/lib/billing";
import { feel } from "@/lib/feedback";
import { colors, radius, shadow, space } from "@/theme/theme";

/** "P1M" → "per month". Play returns ISO 8601 durations. */
function periodLabel(period: string): string {
  switch (period) {
    case "P1W":
      return "per week";
    case "P1M":
      return "per month";
    case "P3M":
      return "every 3 months";
    case "P6M":
      return "every 6 months";
    case "P1Y":
      return "per year";
    default:
      return "";
  }
}

export function SubscribeScreen() {
  const { restaurantId, restaurantName, firebaseUser } = useAuth();
  const [offers, setOffers] = useState<SubscriptionOffer[] | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = isBillingAvailable();

  useEffect(() => {
    let cancelled = false;
    if (!available || !restaurantId) {
      setOffers([]);
      return;
    }
    (async () => {
      // Restore FIRST. If this owner already has a live subscription, the
      // server writes the date, AuthContext sees it, and this screen is gone
      // before the price list finishes loading.
      try {
        await restore(restaurantId);
      } catch {
        // Nothing to restore is the common case, and not an error.
      }
      const list = await getOffers();
      if (!cancelled) setOffers(list);
    })();
    return () => {
      cancelled = true;
      closeBilling();
    };
  }, [available, restaurantId]);

  const onBuy = useCallback(
    async (offer: SubscriptionOffer) => {
      if (!restaurantId) return;
      setError(null);
      setBusyToken(offer.offerToken);
      try {
        const res = await subscribe(restaurantId, offer.offerToken);
        if (res === null) {
          // Dismissed Play's sheet — an ordinary outcome, say nothing.
          return;
        }
        if (!res.ok) {
          feel.error();
          setError(res.reason ?? "That didn't go through. Please try again.");
          return;
        }
        // Success is NOT navigated from here. The server has written the
        // paid-through date; AuthContext's restaurant listener picks it up and
        // the app leaves this screen on its own, on every device at once.
        feel.success();
      } catch (e) {
        feel.error();
        setError(
          e instanceof Error
            ? e.message
            : "Something went wrong. Your payment is safe — try again.",
        );
      } finally {
        setBusyToken(null);
      }
    },
    [restaurantId],
  );

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

  const loading = offers === null;
  const nothingToSell = !loading && offers.length === 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.icon}>⌛</Text>
        <Text style={styles.title}>Your free trial has ended</Text>
        <Text style={styles.body}>
          Your menu, tables and settings are all still saved — nothing has been
          deleted. Subscribe to pick up exactly where you left off.
        </Text>

        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.hint}>Checking with Google Play…</Text>
          </View>
        )}

        {!loading &&
          offers.map((offer) => (
            <Pressable
              key={offer.offerToken}
              style={({ pressed }) => [
                styles.buyBtn,
                pressed && styles.pressed,
                busyToken !== null && styles.disabled,
              ]}
              onPress={() => onBuy(offer)}
              onPressIn={feel.press}
              disabled={busyToken !== null}
            >
              <Text style={styles.buyText}>
                {busyToken === offer.offerToken
                  ? "Opening Google Play…"
                  : `${offer.formattedPrice} ${periodLabel(offer.billingPeriod)}`}
              </Text>
            </Pressable>
          ))}

        {error && <Text style={styles.error}>{error}</Text>}

        {!loading && !nothingToSell && (
          <Text style={styles.hint}>
            Billed through Google Play. Cancel any time from the Play Store.
            This screen unlocks by itself once payment goes through.
          </Text>
        )}

        {/* The pre-billing path, kept as the fallback. An owner on an older
            build, or one Play cannot sell to, must still have a way in. */}
        {nothingToSell && hasContact && (
          <>
            <Pressable
              style={({ pressed }) => [styles.buyBtn, pressed && styles.pressed]}
              onPress={onContact}
              onPressIn={feel.press}
            >
              <Text style={styles.buyText}>Contact {CONTACT_NAME}</Text>
            </Pressable>
            <Text style={styles.hint}>
              Once activated, this screen unlocks by itself.
            </Text>
          </>
        )}

        {nothingToSell && !hasContact && (
          <Text style={styles.hint}>
            Subscriptions aren&apos;t available on this version of the app.
            Please update Smart Serve from the Play Store.
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          onPressIn={feel.dismiss}
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: space.s6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s6,
    alignItems: "center",
    gap: space.s3,
    ...shadow.card,
  },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center" },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  loading: { alignItems: "center", gap: space.s2, paddingVertical: space.s4 },
  buyBtn: {
    marginTop: space.s2,
    alignSelf: "stretch",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    paddingHorizontal: space.s6,
    alignItems: "center",
  },
  buyText: { color: colors.textInverse, fontWeight: "800", fontSize: 16 },
  disabled: { opacity: 0.6 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  backBtn: { marginTop: space.s3, padding: space.s3 },
  backText: { color: colors.textMuted, fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
