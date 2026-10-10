/**
 * THE PAYOFF — the bill, with their name on it.
 *
 * The old celebration card put a number on screen ("YOUR FIRST BILL ₹120")
 * and asked the owner to be impressed by it. They were not, and they were
 * right not to be: they had invented that order thirty seconds earlier, so
 * the number proved nothing except that the app can add up. A figure someone
 * typed cannot be evidence.
 *
 * A RECEIPT can. It carries their restaurant's name, their address, their
 * tax treatment, their prices, a bill number and a table — the same artifact
 * their customer will be handed, laid out the same way the printer lays it
 * out. It is the first moment the software looks like it belongs to them
 * rather than to us, and it is the thing worth showing.
 *
 * ## The load-bearing decisions
 *
 * - **The totals are the REAL totals**, from `computeBill` — the same
 *   function the Firestore rules validate live bills against. If GST is off
 *   for this restaurant, there is no GST line here either. A demo receipt
 *   with plausible-looking made-up maths is how an owner discovers on day
 *   four that the app charges differently from what they were shown.
 * - **It says plainly that nothing was saved.** The owner has just watched
 *   money be taken. Leaving them to wonder whether ₹180 is now sitting in
 *   their figures is a small betrayal at the exact moment trust is being
 *   built, and "nothing was saved" is also the sentence that makes it safe to
 *   press the buttons again.
 * - **The way on is the real app, named.** The run ends by handing them the
 *   floor (or the order screen) — the place the next, real order starts.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Confetti } from "@/components/Confetti";
import { PressableScale } from "@/components/PressableScale";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { feel } from "@/lib/feedback";
import { formatMoney, type BillTotals } from "@/lib/money";
import type { OrderItem } from "@/types/models";

export interface PracticeReceiptProps {
  restaurantName: string | null;
  addressLine?: string | null;
  lines: OrderItem[];
  totals: BillTotals;
  tableLabel: string;
  paymentLabel: string | null;
  gstEnabled: boolean;
  /** This restaurant fires a kitchen ticket — the headline names the kitchen
   *  only for an owner who has just been through one. */
  kotEnabled: boolean;
  /**
   * How long the owner took, first screen to payment — or `null` when it is
   * not worth saying (they wandered off mid-run).
   *
   * This is the one figure on the page they did NOT type. The total is an
   * order they invented; the time is a measurement of them, and "a whole
   * order in 40 seconds" is the thing they came here unsure about.
   */
  seconds: number | null;
  onDone: () => void;
}

export function PracticeReceipt({
  restaurantName,
  addressLine,
  lines,
  totals,
  tableLabel,
  paymentLabel,
  gstEnabled,
  kotEnabled,
  seconds,
  onDone,
}: PracticeReceiptProps) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 460,
      easing: Easing.out(Easing.back(1.3)),
      useNativeDriver: true,
    }).start();
    feel.success();
  }, [t]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>THAT IS THE WHOLE JOB</Text>
        <Text style={styles.headline}>
          {seconds != null
            ? `You just took a whole order in ${seconds} seconds.`
            : "You just took a whole order."}
        </Text>
        <Text style={styles.sub}>
          {kotEnabled
            ? "Order, kitchen, bill — and this comes out."
            : "Order, bill — and this comes out."}
        </Text>

        <Animated.View
          style={[
            styles.slip,
            {
              opacity: t,
              transform: [
                {
                  scale: t.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.slipName}>
            {restaurantName ?? "Your Restaurant"}
          </Text>
          {addressLine ? (
            <Text style={styles.slipAddr}>{addressLine}</Text>
          ) : null}

          <View style={styles.slipRule} />

          <View style={styles.slipMetaRow}>
            {/* Not a number. This run is replayable from Account for ever,
                and "Bill #1" in a restaurant on its four-hundredth is a
                figure the owner can check and find wrong. */}
            <Text style={styles.slipMeta}>Practice bill</Text>
            <Text style={styles.slipMeta}>{tableLabel}</Text>
          </View>

          <View style={styles.slipRule} />

          {lines.map((l) => (
            <View key={l.lineId} style={styles.slipRow}>
              <Text style={styles.slipQty}>{l.qty}</Text>
              <Text style={styles.slipItem} numberOfLines={1}>
                {l.name}
              </Text>
              <Text style={styles.slipAmt}>
                {formatMoney(l.price * l.qty)}
              </Text>
            </View>
          ))}

          <View style={styles.slipRule} />

          <View style={styles.slipRow}>
            <Text style={styles.slipItem}>Subtotal</Text>
            <Text style={styles.slipAmt}>{formatMoney(totals.subtotal)}</Text>
          </View>
          {/* No GST line at all when this restaurant does not charge it —
              the receipt has to match what they actually hand over. */}
          {gstEnabled && (
            <>
              <View style={styles.slipRow}>
                <Text style={styles.slipItem}>CGST</Text>
                <Text style={styles.slipAmt}>{formatMoney(totals.cgst)}</Text>
              </View>
              <View style={styles.slipRow}>
                <Text style={styles.slipItem}>SGST</Text>
                <Text style={styles.slipAmt}>{formatMoney(totals.sgst)}</Text>
              </View>
            </>
          )}

          <View style={styles.slipRule} />

          <View style={styles.slipRow}>
            <Text style={styles.slipTotalLabel}>TOTAL</Text>
            <Text style={styles.slipTotal}>
              {formatMoney(totals.grandTotal)}
            </Text>
          </View>
          {paymentLabel ? (
            <Text style={styles.slipPaid}>Paid by {paymentLabel}</Text>
          ) : null}

          <Text style={styles.slipThanks}>Thank you, come again</Text>
        </Animated.View>

        {/* Said plainly, and early enough to be reassuring rather than a
            correction. See the note at the top of this file. */}
        <View style={styles.safeNote}>
          <MaterialCommunityIcons
            name="shield-check-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.safeText}>
            That was practice — nothing was saved and your figures have not
            changed.
          </Text>
        </View>

        <PressableScale
          containerStyle={styles.ctaHit}
          style={styles.cta}
          activeScale={0.97}
          haptic="press"
          onPress={onDone}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Now do a real one</Text>
          <MaterialCommunityIcons
            name="arrow-right"
            size={18}
            color={colors.textInverse}
          />
        </PressableScale>
      </ScrollView>
      {/* After the slip has landed, so the paper is what is being celebrated
          rather than an empty page. Over everything, and takes no touches. */}
      <Confetti delay={260} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.s5, paddingBottom: space.s6, alignItems: "center" },

  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  headline: {
    marginTop: space.s2,
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    color: colors.text,
    textAlign: "center",
    maxWidth: 340,
  },
  sub: {
    marginTop: space.s2,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 320,
  },

  // Deliberately paper-like: square corners, mono figures, a narrow column.
  // It should read as the thing that comes out of the printer, not as another
  // card in the app.
  slip: {
    marginTop: space.s5,
    width: "100%",
    maxWidth: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: space.s4,
    paddingVertical: space.s5,
    ...shadow.float,
  },
  slipName: {
    fontFamily: fonts.extrabold,
    fontSize: 17,
    color: colors.text,
    textAlign: "center",
    letterSpacing: 0.4,
  },
  slipAddr: {
    marginTop: 2,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
  },
  slipRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: space.s3,
  },
  slipMetaRow: { flexDirection: "row", justifyContent: "space-between" },
  slipMeta: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  slipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingVertical: 2,
  },
  slipQty: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 18,
  },
  slipItem: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, color: colors.text },
  slipAmt: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.text },
  slipTotalLabel: {
    flex: 1,
    fontFamily: fonts.extrabold,
    fontSize: 14,
    letterSpacing: 0.6,
    color: colors.text,
  },
  slipTotal: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.text },
  slipPaid: {
    marginTop: space.s2,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "right",
  },
  slipThanks: {
    marginTop: space.s4,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
  },

  safeNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s2,
    marginTop: space.s5,
    maxWidth: 330,
  },
  safeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },

  ctaHit: { alignSelf: "stretch", marginTop: space.s5 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.s4,
    ...shadow.glow,
  },
  ctaText: { fontFamily: fonts.bold, fontSize: 15, color: colors.textInverse },
});
