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
 *   price that will one day disagree with the one they are charged. The big
 *   figure only drops a trailing ".00" from Play's own string; the per-day
 *   line is arithmetic on Play's number and is hidden outside rupees.
 * - **The charge is stated beside the button.** "Start 3 days free" and,
 *   directly under it, "Then ₹X per month. Cancel anytime." is Google's
 *   subscription policy, not a nicety: the terms have to be where the buyer
 *   taps, and an app that hides them behind the word "free" gets pulled. That
 *   line carries Play's price string untouched.
 * - **The button is pinned; everything above it scrolls.** On a short phone
 *   the list may run long, and the one control that matters must not be the
 *   thing that falls off the bottom.
 * - **One plan shows no plan picker.** A radio button with a single option is
 *   a question with one answer. The picker appears when Play returns two.
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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatMoney } from "@/lib/money";
import {
  colors,
  currency,
  fonts,
  radius,
  shadow,
  space,
} from "@/theme/theme";
import { capture } from "@/lib/analytics";

/** What one subscription buys, as two columns read across. Every line is
 *  something the app does today — a paywall that promises a feature the owner
 *  then cannot find has spent the trust it was asking for. "Unlimited" is
 *  true because nothing in the app or the rules caps staff or devices; if a
 *  cap is ever added, these two lines go first. */
const INCLUDED_LEFT = [
  "Unlimited staff",
  "Tables & takeaway",
  "POS billing",
  "Daily sales report",
] as const;
const INCLUDED_RIGHT = [
  "Unlimited devices",
  "Kitchen KOT",
  "Receipt printing",
  "24/7 customer support",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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

/** "P1M" → "/ month" — the unit beside the big price. */
function periodUnit(period: string): string {
  switch (period) {
    case "P1W":
      return "/ week";
    case "P1M":
      return "/ month";
    case "P3M":
      return "/ 3 months";
    case "P6M":
      return "/ 6 months";
    case "P1Y":
      return "/ year";
    default:
      return "";
  }
}

/** "P1M" → 30. Only for the per-day line, so a month is a round thirty. */
function periodDays(period: string): number {
  switch (period) {
    case "P1W":
      return 7;
    case "P1M":
      return 30;
    case "P3M":
      return 90;
    case "P6M":
      return 180;
    case "P1Y":
      return 365;
    default:
      return 0;
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

/** "P3D" → "11 October": the day the trial ends and the first charge lands. */
function firstChargeLabel(period: string): string {
  const m = /^P(\d+)([DWM])$/.exec(period);
  if (!m) return "";
  const n = Number(m[1]);
  const d = new Date();
  if (m[2] === "M") d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n * (m[2] === "W" ? 7 : 1));
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function priceLine(offer: SubscriptionOffer): string {
  return `${offer.formattedPrice} ${periodLabel(offer.billingPeriod)}`.trim();
}

/** "₹500.00" → "₹500". Play's string with a zero fraction dropped and nothing
 *  else touched, for the two places a price is set large. */
function shortPrice(offer: SubscriptionOffer): string {
  return offer.formattedPrice.replace(/[.,]00$/, "");
}

function isRupees(offer: SubscriptionOffer): boolean {
  return offer.currencyCode === currency.code;
}

/** "Less than ₹17 a day". Empty outside rupees — `formatMoney` only speaks
 *  ₹ — and when Play gave us no number to divide. */
function perDayLine(offer: SubscriptionOffer): string {
  const days = periodDays(offer.billingPeriod);
  if (!isRupees(offer) || !days || offer.priceMicros <= 0) return "";
  // Micros are millionths of a rupee; paise are hundredths.
  const paisePerDay = offer.priceMicros / 10000 / days;
  const rupees = Math.ceil(paisePerDay / 100 - 1e-9);
  // Rounded UP, so "less than" stays true — unless it divided exactly.
  const exact = Math.abs(paisePerDay - rupees * 100) < 1e-6;
  return `${exact ? "Just" : "Less than"} ${formatMoney(rupees * 100)} a day`;
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
  const [attempt, setAttempt] = useState(0);

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
  }, [available, restaurantId, attempt]);

  // An empty price list is as often a slow Play Store as a real "cannot
  // sell", and without this the only way to ask again was to restart the app.
  const onRetry = useCallback(() => {
    setOffers(null);
    setAttempt((n) => n + 1);
  }, []);

  const chosen = offers?.find((o) => o.offerToken === selected) ?? null;
  const trialPeriod = chosen?.trialPeriod ?? null;
  const firstCharge = useMemo(
    () => (trialPeriod ? firstChargeLabel(trialPeriod) : ""),
    [trialPeriod],
  );

  const onBuy = useCallback(async () => {
    if (!restaurantId || !chosen) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      capture("subscription_purchase_started");
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
        capture("subscription_purchase_failed");
        feel.error();
        setError(res.reason ?? "That didn't go through. Please try again.");
        return;
      }
      // Success is NOT navigated from here. The server has written the
      // paid-through date; AuthContext's restaurant listener picks it up and
      // the redirect below takes over, on every device at once.
      capture("subscription_purchased", { has_trial: !!chosen.trialPeriod });
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
  const trial = trialPeriod ? trialLabel(trialPeriod) : "";
  const perDay = chosen ? perDayLine(chosen) : "";

  const heading = awaitingSubscription
    ? `${restaurantName ?? "Your restaurant"} is ready`
    : "Welcome back";
  const lede = awaitingSubscription
    ? "Everything you need to run your restaurant from your phone."
    : `Subscribe to open ${restaurantName ?? "your restaurant"} again.`;

  return (
    <SafeAreaView style={styles.root}>
      {/* Capped so a tablet shows a column, not a banner. */}
      <View style={styles.column}>
        <View style={styles.top}>
          {awaitingSubscription ? (
            <PressableScale
              haptic="warn"
              onPress={() => signOut()}
              style={styles.topBtn}
            >
              <Text style={styles.topText}>Sign out</Text>
            </PressableScale>
          ) : (
            <PressableScale
              haptic="dismiss"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/pending")
              }
              style={styles.topBtn}
            >
              <Text style={styles.topText}>Back</Text>
            </PressableScale>
          )}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.head}>
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.lede}>{lede}</Text>
          </View>

          {loading && (
            <View style={styles.hero}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.hint}>Checking with Google Play…</Text>
            </View>
          )}

          {chosen && (
            <View style={styles.hero}>
              <View style={styles.amountRow}>
                <Text style={styles.amount}>{shortPrice(chosen)}</Text>
                <Text style={styles.amountUnit}>
                  {periodUnit(chosen.billingPeriod)}
                </Text>
              </View>
              {!!perDay && (
                <View style={styles.perDay}>
                  <Text style={styles.perDayText}>{perDay}</Text>
                </View>
              )}
            </View>
          )}

          {!loading &&
            offers.length > 1 &&
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

          <View style={styles.included}>
            <Text style={styles.label}>Everything included</Text>
            {/* Two columns sized to their own text and centred as one block,
                so the list sits under its heading instead of hanging left. */}
            <View style={styles.includedCols}>
              {[INCLUDED_LEFT, INCLUDED_RIGHT].map((col) => (
                <View key={col[0]} style={styles.includedCol}>
                  {col.map((line) => (
                    <View key={line} style={styles.includedRow}>
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={colors.saveGreen}
                      />
                      <Text style={styles.includedText}>{line}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>

          {chosen && !!trial && !!firstCharge && (
            <View style={styles.trial}>
              <Text style={[styles.label, styles.trialLabel]}>
                How your free trial works
              </Text>
              <View style={styles.step}>
                <View style={styles.rail}>
                  <View style={[styles.mark, styles.markOn]}>
                    <Ionicons
                      name="lock-open"
                      size={16}
                      color={colors.textInverse}
                    />
                  </View>
                  <View style={styles.railLine} />
                </View>
                <View style={[styles.stepBody, styles.stepBodyFirst]}>
                  <Text style={styles.stepTitle}>Today</Text>
                  <Text style={styles.stepSub}>Everything unlocked</Text>
                </View>
                <View style={styles.freePill}>
                  <Text style={styles.freePillText}>
                    {isRupees(chosen) ? formatMoney(0) : "Free"}
                  </Text>
                </View>
              </View>
              <View style={styles.step}>
                <View style={styles.rail}>
                  <View style={styles.mark}>
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color={colors.primary}
                    />
                  </View>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{firstCharge}</Text>
                  <Text style={styles.stepSub}>Your plan starts</Text>
                </View>
                <Text style={styles.stepAmount}>{shortPrice(chosen)}</Text>
              </View>
            </View>
          )}

          {!awaitingSubscription && (
            <Text style={styles.saved}>
              Your menu, tables and bills are saved.
            </Text>
          )}
        </ScrollView>

        <View style={[styles.foot, loading && styles.footEmpty]}>
          {error &&<Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.hint}>{notice}</Text>}

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
              <Text style={styles.hint}>
                {trial ? `Then ${priceLine(chosen)}. ` : `${priceLine(chosen)}. `}
                <Text style={styles.hintStrong}>Cancel anytime.</Text>
              </Text>
            </>
          )}

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

          {nothingToSell && available && (
            <PressableScale
              haptic="tap"
              onPress={onRetry}
              style={styles.topBtn}
              accessibilityRole="button"
            >
              <Text style={styles.topText}>Try again</Text>
            </PressableScale>
          )}

          {nothingToSell && !hasContact && (
            <Text style={styles.hint}>
              Subscriptions aren&apos;t available on this version of the app.
              Please update Smart Serve from the Play Store.
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  column: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" },
  top: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: space.s2,
  },
  topBtn: { padding: space.s3 },
  topText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  scroll: { flex: 1 },
  body: {
    // Centred when it is shorter than the screen (no trial card on a tall
    // phone), so the gap is shared above and below instead of pooling in a
    // blank half-screen over the button.
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: space.s5,
    paddingBottom: space.s5,
    gap: space.s5,
  },
  head: { gap: space.s1 },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.4,
    color: colors.text,
    textAlign: "center",
  },
  lede: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: "center",
  },
  // The price is the hero: centred, in its own tinted panel.
  hero: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.offerBorder,
    borderRadius: radius.xl,
    paddingVertical: space.s5,
    paddingHorizontal: space.s4,
    alignItems: "center",
    gap: space.s2,
  },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: space.s2 },
  amount: {
    fontFamily: fonts.extrabold,
    fontSize: 48,
    lineHeight: 56,
    letterSpacing: -1.2,
    color: colors.primary,
  },
  amountUnit: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.primary,
  },
  perDay: {
    backgroundColor: colors.saveGreen,
    borderRadius: radius.pill,
    paddingVertical: space.s1,
    paddingHorizontal: space.s3,
  },
  perDayText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textInverse,
  },
  label: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.textMuted,
    textAlign: "center",
  },
  included: { gap: space.s3 },
  includedCols: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space.s4,
  },
  includedCol: { gap: space.s3, flexShrink: 1 },
  includedRow: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  includedText: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  trial: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.s4,
  },
  trialLabel: { textAlign: "left", marginBottom: space.s3 },
  step: { flexDirection: "row", gap: space.s3 },
  rail: { width: 32, alignItems: "center" },
  mark: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: { backgroundColor: colors.saveGreen },
  railLine: { flex: 1, width: 2, backgroundColor: colors.offerBorder },
  stepBody: { flex: 1 },
  // The gap between the two steps lives here, so the rail's line has a
  // height to stretch across.
  stepBodyFirst: { paddingBottom: space.s4 },
  stepTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
  },
  stepSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  freePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.saveGreenSoft,
    borderRadius: radius.pill,
    paddingVertical: space.s1,
    paddingHorizontal: space.s3,
  },
  freePillText: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.saveGreen,
  },
  stepAmount: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    paddingVertical: space.s1,
  },
  saved: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.s4,
  },
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
  foot: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: space.s5,
    paddingTop: space.s4,
    paddingBottom: space.s4,
    gap: space.s3,
  },
  // Nothing to pin until Play has answered — no rule across an empty bar.
  footEmpty: { borderTopWidth: 0, paddingTop: 0 },
  ctaOuter: { alignSelf: "stretch" },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    paddingHorizontal: space.s6,
    alignItems: "center",
    ...shadow.glow,
  },
  ctaText: {
    fontFamily: fonts.extrabold,
    fontSize: 17,
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
  hintStrong: { fontFamily: fonts.bold, color: colors.text },
});
