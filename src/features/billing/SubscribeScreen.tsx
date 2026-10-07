/**
 * The paywall. Two people arrive here, and it has to talk to each differently:
 *
 *   a NEW owner     registered a minute ago; the restaurant was born awaiting
 *                   its first subscription (`awaitingSubscription`). They have
 *                   lost nothing and are being offered a free trial.
 *   a LAPSED owner  had a subscription that ended, or was locked by hand.
 *                   Everything they built is still there.
 *
 * Telling the first one their "access has ended" is false, and it is the worst
 * possible sentence to put above a request for a payment method.
 *
 * ## Why this screen barely does anything
 *
 * It does not unlock the app. It cannot: `firestore.rules` forbids every
 * client from changing `expiresAt`. All it does is get a purchase token to the
 * server and then WAIT — `AuthContext` is already watching the restaurant doc,
 * so when the server writes the paid-through date `profile` turns non-null and
 * the redirect at the top of the render sends the owner in. Same mechanism
 * that unlocks a device when you run `activateTenant.js` by hand, and the
 * reason there is no local "paid" state here to get out of sync.
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
 * - **The charge is stated beside the button, in full.** "Free for 3 days,
 *   then ₹X per month until you cancel" is Google's subscription policy, not
 *   a nicety: the terms have to be where the buyer taps, and an app that hides
 *   them behind the word "free" gets pulled.
 * - **Owner only.** Staff never reach this route; they see the ordinary
 *   "ask your manager" copy on `/pending`. A waiter who could subscribe could
 *   also subscribe by accident, on their own card.
 * - **A new owner gets Sign out, not Back.** `/pending` sends them straight
 *   here, so Back would bounce off it and land on this screen again. The only
 *   real way out of a paywall you have not passed is to leave.
 * - **Falls back to the contact flow.** If this build has no billing module,
 *   or Play returns nothing, the screen offers the WhatsApp path that worked
 *   before billing existed rather than dead-ending.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/features/auth/AuthContext";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { BrandSplash } from "@/components/BrandSplash";
import { PressableScale } from "@/components/PressableScale";
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
import { colors, fonts, radius, shadow, space } from "@/theme/theme";

/** What one subscription buys. Every line is something the app does today —
 *  a paywall that promises a feature the owner then cannot find has spent the
 *  trust it was asking for. */
const INCLUDED = [
  "Tables, orders and kitchen tickets",
  "Bills, GST and daily sales reports",
  "Menu, offers and receipt printing",
  "One subscription covers every device and staff login",
] as const;

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

/** "P1M" → "Monthly" — the name on the plan card. */
function planName(period: string): string {
  switch (period) {
    case "P1W":
      return "Weekly";
    case "P1M":
      return "Monthly";
    case "P3M":
      return "Quarterly";
    case "P6M":
      return "Half-yearly";
    case "P1Y":
      return "Yearly";
    default:
      return "Subscription";
  }
}

/** "P3D" → "3 days". Only the shapes a trial can take in Play Console. */
function trialLabel(period: string): string {
  const m = /^P(\d+)([DWM])$/.exec(period);
  if (!m) return "";
  const n = Number(m[1]);
  const unit = { D: "day", W: "week", M: "month" }[m[2] as "D" | "W" | "M"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function priceLine(offer: SubscriptionOffer): string {
  return `${offer.formattedPrice} ${periodLabel(offer.billingPeriod)}`.trim();
}

/** The full terms of the selected plan, as one sentence. */
function termsLine(offer: SubscriptionOffer): string {
  const trial = offer.trialPeriod ? trialLabel(offer.trialPeriod) : "";
  const lead = trial
    ? `Free for ${trial}, then ${priceLine(offer)}`
    : priceLine(offer);
  return `${lead} until you cancel. Billed by Google Play — cancel any time in the Play Store.`;
}

export function SubscribeScreen() {
  const {
    restaurantId,
    restaurantName,
    firebaseUser,
    profile,
    config,
    gate,
    gatedRole,
    loading: authLoading,
    awaitingSubscription,
    signOut,
  } = useAuth();
  const [offers, setOffers] = useState<SubscriptionOffer[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said in the hint colour, not the error colour: an order Play is still
  // waiting to be paid for is not something the owner did wrong.
  const [notice, setNotice] = useState<string | null>(null);
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
      if (cancelled) return;
      setOffers(list);
      // Lead with the plan that starts free, if Play is offering one.
      setSelected((list.find((o) => o.trialPeriod) ?? list[0])?.offerToken ?? null);
    })();
    return () => {
      cancelled = true;
      closeBilling();
    };
  }, [available, restaurantId]);

  const chosen = offers?.find((o) => o.offerToken === selected) ?? null;

  const onBuy = useCallback(async () => {
    if (!restaurantId || !chosen) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await subscribe(restaurantId, chosen.offerToken);
      if (res === null) {
        // Dismissed Play's sheet — an ordinary outcome, say nothing.
        return;
      }
      if (res.pending) {
        setNotice(res.reason ?? null);
        return;
      }
      if (!res.ok) {
        feel.error();
        setError(res.reason ?? "That didn't go through. Please try again.");
        return;
      }
      // Success is NOT navigated from here. The server has written the
      // paid-through date; AuthContext's restaurant listener picks it up and
      // the redirect below takes over, on every device at once.
      feel.success();
    } catch (e) {
      feel.error();
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Your payment is safe — try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [restaurantId, chosen]);

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

  if (authLoading) return <BrandSplash />;
  // Unlocked — by this purchase, by one made on another device, or by hand.
  // This is the ONLY way out of the screen on success.
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;
  if (!firebaseUser) return <Redirect href="/login" />;
  // Staff, or an account gated for any reason a payment cannot fix.
  if (gate !== "expired" || gatedRole !== "cashier") {
    return <Redirect href="/pending" />;
  }

  const loading = offers === null;
  const nothingToSell = !loading && offers.length === 0;
  const trial = chosen?.trialPeriod ? trialLabel(chosen.trialPeriod) : "";
  const place = restaurantName ?? "Your restaurant";

  const heading = awaitingSubscription
    ? `${place} is ready`
    : "Welcome back";
  const lede = awaitingSubscription
    ? trial
      ? `Try everything free for ${trial}. You won't be charged until the trial ends.`
      : "Subscribe to open your restaurant and take your first order."
    : "Your subscription has ended. Your menu, tables and settings are all still saved — subscribe to pick up exactly where you left off.";

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Ionicons
              name={awaitingSubscription ? "sparkles" : "lock-open-outline"}
              size={26}
              color={colors.primary}
            />
          </View>
          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.lede}>{lede}</Text>

          <View style={styles.included}>
            {INCLUDED.map((line) => (
              <View key={line} style={styles.includedRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.saveGreen}
                />
                <Text style={styles.includedText}>{line}</Text>
              </View>
            ))}
          </View>

          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.hint}>Checking with Google Play…</Text>
            </View>
          )}

          {!loading &&
            offers.map((offer) => {
              const on = offer.offerToken === selected;
              return (
                <PressableScale
                  key={offer.offerToken}
                  haptic="select"
                  activeScale={0.98}
                  disabled={busy}
                  onPress={() => setSelected(offer.offerToken)}
                  containerStyle={styles.planOuter}
                  style={[styles.plan, on && styles.planOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons
                    name={on ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={on ? colors.primary : colors.borderStrong}
                  />
                  <View style={styles.planBody}>
                    <Text style={styles.planName}>
                      {planName(offer.billingPeriod)}
                    </Text>
                    <Text style={styles.planPrice}>{priceLine(offer)}</Text>
                  </View>
                  {offer.trialPeriod && (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>
                        {trialLabel(offer.trialPeriod)} free
                      </Text>
                    </View>
                  )}
                </PressableScale>
              );
            })}

          {chosen && (
            <>
              <PressableScale
                haptic="press"
                activeScale={0.97}
                disabled={busy}
                onPress={onBuy}
                containerStyle={styles.ctaOuter}
                style={[styles.cta, busy && styles.disabled]}
              >
                <Text style={styles.ctaText}>
                  {busy
                    ? "Opening Google Play…"
                    : trial
                      ? `Start ${trial} free`
                      : "Subscribe"}
                </Text>
              </PressableScale>
              <Text style={styles.hint}>{termsLine(chosen)}</Text>
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.hint}>{notice}</Text>}

          {/* The pre-billing path, kept as the fallback. An owner on an older
              build, or one Play cannot sell to, must still have a way in. */}
          {nothingToSell && hasContact && (
            <>
              <PressableScale
                haptic="press"
                activeScale={0.97}
                onPress={onContact}
                containerStyle={styles.ctaOuter}
                style={styles.cta}
              >
                <Text style={styles.ctaText}>Contact {CONTACT_NAME}</Text>
              </PressableScale>
              <Text style={styles.hint}>
                Subscriptions aren&apos;t available on this device right now.
                Once we activate your restaurant, this screen unlocks by
                itself.
              </Text>
            </>
          )}

          {nothingToSell && !hasContact && (
            <Text style={styles.hint}>
              Subscriptions aren&apos;t available on this version of the app.
              Please update Smart Serve from the Play Store.
            </Text>
          )}

          {awaitingSubscription ? (
            <PressableScale
              haptic="warn"
              onPress={() => signOut()}
              style={styles.footBtn}
            >
              <Text style={styles.footText}>Sign out</Text>
            </PressableScale>
          ) : (
            <PressableScale
              haptic="dismiss"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/pending")
              }
              style={styles.footBtn}
            >
              <Text style={styles.footText}>Back</Text>
            </PressableScale>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: space.s5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.s6,
    gap: space.s3,
    // Cap the width so a tablet shows a card, not a banner.
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    ...shadow.card,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    color: colors.text,
    textAlign: "center",
  },
  lede: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
  },
  included: { gap: space.s2, paddingVertical: space.s2 },
  includedRow: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  includedText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  loading: { alignItems: "center", gap: space.s2, paddingVertical: space.s4 },
  planOuter: { alignSelf: "stretch" },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  planOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  planBody: { flex: 1 },
  planName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  planPrice: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  chip: {
    backgroundColor: colors.saveGreenSoft,
    borderRadius: radius.pill,
    paddingVertical: space.s1,
    paddingHorizontal: space.s3,
  },
  chipText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.saveGreen,
  },
  ctaOuter: { alignSelf: "stretch", marginTop: space.s2 },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    paddingHorizontal: space.s6,
    alignItems: "center",
  },
  ctaText: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textInverse,
  },
  disabled: { opacity: 0.6 },
  error: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
    textAlign: "center",
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: "center",
  },
  footBtn: { alignSelf: "center", padding: space.s3 },
  footText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textMuted,
  },
});
