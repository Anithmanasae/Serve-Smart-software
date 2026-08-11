/**
 * Bill detail — Smart Serve Cashier, React Native port.
 *
 * Renders a single bill: the itemized order lines (what the customer bought,
 * amount per line, item total below), the money summary (all values from the
 * Bill doc via `formatMoney` — never recomputed here), payment-method tiles,
 * receipt tiles, and the Settle action. Every write goes through the ported
 * `cashierApi` (`settleBill`, `reprintBill`); this screen never touches
 * Firestore or does money math.
 *
 * A paid bill is read-only: totals + "Paid via …" are shown, the settle
 * controls are locked, but a reprint is still allowed.
 *
 * NON-CHARGEABLE is offered here as an alternative to a payment method, not as
 * one of them: picking it collects a reason, prints/settles at ₹0 payable, and
 * keeps the bill out of sales entirely. The bill's real total stays on screen
 * throughout — the cashier should always see what is being given away.
 *
 * CANCELLING a settled bill (the bad-food refund) lives here too, but only on
 * a bill paid TODAY and only for cashier/admin — past days are closed. It sits
 * below the paid banner rather than among the actions, takes a reason, and asks
 * once more before `voidBill` backs the sale out of the day's figures.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { formatMoney } from "@/lib/money";
import { useResponsive } from "@/lib/responsive";
import { dayKey, formatTimeIST } from "@/lib/date";
import { feel } from "@/lib/feedback";
import { colors, radius, shadow, space } from "@/theme/theme";
import {
  NC_REASONS,
  NC_REASON_LABELS,
  VOID_REASONS,
  VOID_REASON_LABELS,
  type NcReason,
  type PaymentMode,
  type VoidReason,
} from "@/types/models";
import { useAuth } from "@/features/auth/AuthContext";
import { useRestaurantProfile } from "@/features/settings/useRestaurantProfile";
import { encodeReceipt, formatBillNumber } from "@/lib/printer/escpos";
import {
  PRINTING_UNAVAILABLE_MESSAGE,
  getPaperWidth,
  isPrintingAvailable,
  printToSavedPrinter,
} from "@/lib/printer/printerService";
import {
  formatWhatsAppReceipt,
  normalizeIndianMobile,
} from "@/lib/receiptText";
import { reprintBill, settleBill, voidBill } from "./cashierApi";
import { useBill, useOrder } from "./useCashierData";

const PAYMENT_TILES: { mode: PaymentMode; label: string; icon: string }[] = [
  { mode: "cash", label: "Cash", icon: "💵" },
  { mode: "upi", label: "UPI / QR", icon: "🔳" },
  { mode: "card", label: "Card", icon: "💳" },
];

function paymentLabel(mode: PaymentMode): string {
  return PAYMENT_TILES.find((t) => t.mode === mode)?.label ?? mode;
}

export function BillDetail({
  billId,
  onClose,
}: {
  billId: string;
  onClose: () => void;
}) {
  const { isTablet } = useResponsive();
  const { data: bill, loading: billLoading } = useBill(billId);
  const { data: order } = useOrder(bill?.orderId ?? null);
  const { data: restaurant } = useRestaurantProfile();
  const { profile: cashierProfile, role } = useAuth();

  const isPaid = bill?.status === "paid";
  const isVoid = bill?.status === "void";
  /** Settled one way or the other — the bill is read-only from here. */
  const isSettled = isPaid || isVoid;

  // Local UI selections (bill.paymentMode is null until settled).
  const [selectedMode, setSelectedMode] = useState<PaymentMode | null>(null);
  const [busy, setBusy] = useState<null | "settle" | "print" | "void">(null);
  const [justPrinted, setJustPrinted] = useState(false);

  // Cancel (void) a settled bill: the reason sheet's draft state.
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidDraftReason, setVoidDraftReason] = useState<VoidReason | null>(null);
  const [voidDraftNote, setVoidDraftNote] = useState("");

  // Non-chargeable: `ncSel` is the confirmed choice, the rest is the sheet.
  const [ncSel, setNcSel] = useState<{ reason: NcReason; note: string } | null>(
    null
  );
  const [ncOpen, setNcOpen] = useState(false);
  const [ncDraftReason, setNcDraftReason] = useState<NcReason | null>(null);
  const [ncDraftNote, setNcDraftNote] = useState("");

  // WhatsApp send: number-entry dialog state.
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState("");

  // Reflect the settled mode once a bill is paid.
  useEffect(() => {
    if (bill?.paymentMode) setSelectedMode(bill.paymentMode);
  }, [bill?.paymentMode]);

  /** Comped — either already settled that way, or picked and not yet settled. */
  const isNc = bill?.nonChargeable === true || ncSel !== null;
  const ncReason = bill?.ncReason ?? ncSel?.reason ?? null;
  const ncReasonLabel = ncReason ? NC_REASON_LABELS[ncReason] : null;

  const voidReasonLabel = bill?.voidReason
    ? VOID_REASON_LABELS[bill.voidReason]
    : null;

  /**
   * Cancelling is offered only for a bill settled TODAY, and only to the people
   * who can settle. The rules enforce both independently — this just keeps the
   * button off screen when it would only fail.
   */
  const canVoid = useMemo(
    () =>
      isPaid &&
      (role === "cashier" || role === "admin") &&
      !!bill?.paidAt &&
      dayKey(bill.paidAt.toDate()) === dayKey(),
    [isPaid, role, bill?.paidAt]
  );

  const canSettle = useMemo(
    () =>
      !!bill &&
      !!order &&
      !isPaid &&
      (!!selectedMode || ncSel !== null) &&
      busy === null,
    [bill, order, isPaid, selectedMode, ncSel, busy]
  );

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      feel.error();
      Alert.alert("Action failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onSettle() {
    if (!bill || !order) return;
    // NC wins when both are somehow set — it is the deliberate, explicit act.
    const settlement = ncSel
      ? ({ kind: "nc", reason: ncSel.reason, note: ncSel.note } as const)
      : selectedMode
        ? ({ kind: "paid", mode: selectedMode } as const)
        : null;
    if (!settlement) return;
    feel.press();
    void run("settle", async () => {
      await settleBill(bill, order, settlement);
      // Taking payment is the end of the whole flow and the sheet closes
      // straight after, so the confirm is the only acknowledgement the
      // cashier gets that the money actually landed.
      feel.success();
      onClose();
    });
  }

  /** Open the reason sheet, seeded with whatever was picked before. */
  function onPickNc() {
    if (isPaid || busy) return;
    feel.press(); // the reason sheet comes up
    setNcDraftReason(ncSel?.reason ?? null);
    setNcDraftNote(ncSel?.note ?? "");
    setNcOpen(true);
  }

  /** Confirm the comp. A reason is mandatory — it is the only trace of WHY a
   *  meal left the building for free, so the button stays dead without one. */
  function onConfirmNc() {
    if (!ncDraftReason) return;
    feel.tap(); // a choice recorded, not money moved — settle still has to run
    setNcSel({ reason: ncDraftReason, note: ncDraftNote.trim().slice(0, 140) });
    setSelectedMode(null); // a comp is not a payment method
    setNcOpen(false);
  }

  /** Back out of a comp that hasn't been settled yet. */
  function onClearNc() {
    feel.dismiss();
    setNcSel(null);
    setNcOpen(false);
  }

  /** Open the cancel-reason sheet on a settled bill. */
  function onPickVoid() {
    if (!canVoid || busy) return;
    feel.press();
    setVoidDraftReason(null);
    setVoidDraftNote("");
    setVoidOpen(true);
  }

  /**
   * Confirm the cancellation. A reason is mandatory — it is the only record of
   * WHY money went back — and the Alert is the last stop before the sale comes
   * out of the day's figures, which cannot be undone from the app.
   */
  function onConfirmVoid() {
    if (!bill || !voidDraftReason || !cashierProfile) return;
    const reason = voidDraftReason;
    const note = voidDraftNote.trim().slice(0, 140);
    // Caution, not confirmation: the next thing on screen is the last stop
    // before money comes back out of the day's takings.
    feel.warn();
    setVoidOpen(false);
    Alert.alert(
      "Cancel this bill?",
      `${formatMoney(bill.grandTotal)} will be removed from today's sales and refunded to the customer. This can't be undone.`,
      [
        { text: "Keep bill", style: "cancel" },
        {
          text: "Cancel bill",
          style: "destructive",
          onPress: () => {
            void run("void", async () => {
              await voidBill(bill, cashierProfile.uid, reason, note);
              // A solid thud rather than the settle's confirm: the sale is
              // reversed, which is done — but it is not good news.
              feel.heavy();
              onClose();
            });
          },
        },
      ]
    );
  }

  /**
   * Real thermal print: encode the live bill + order + restaurant profile to
   * ESC/POS and send it to the saved Bluetooth printer. Only after the bytes
   * are accepted does `reprintBill` bump the printed counter. In Expo Go the
   * native Bluetooth module doesn't exist, so we explain instead of crashing.
   */
  function onPrint() {
    if (!bill || !order || busy) return;
    if (!isPrintingAvailable()) {
      feel.error();
      Alert.alert("Printing unavailable", PRINTING_UNAVAILABLE_MESSAGE);
      return;
    }
    feel.tap();
    setBusy("print");
    setJustPrinted(false);
    void (async () => {
      try {
        const paperWidth = await getPaperWidth();
        const receipt = encodeReceipt({
          profile: restaurant ?? { name: "Brew Brothers" },
          bill,
          order,
          cashierName: cashierProfile?.name ?? "-",
          paperWidth,
          // Before settling, print the mode the cashier has picked (if any).
          paymentLabel: bill.paymentMode
            ? paymentLabel(bill.paymentMode)
            : selectedMode
              ? paymentLabel(selectedMode)
              : null,
          nonChargeable: isNc,
          ncReasonLabel,
        });
        await printToSavedPrinter(receipt.bytes);
        await reprintBill(bill.id, bill.printedCount);
        // The paper is out of the printer before this lands — the confirm is
        // what tells a cashier facing the customer that it worked.
        feel.success();
        setJustPrinted(true);
      } catch (e) {
        feel.error();
        Alert.alert(
          "Couldn't print",
          (e instanceof Error ? e.message : String(e)) +
            "\n\nCheck Account > Printer Settings."
        );
      } finally {
        setBusy(null);
      }
    })();
  }

  /**
   * WhatsApp receipt: build the plain-text bill and hand it to WhatsApp via
   * deep link. With a number the customer's chat opens directly; left blank,
   * WhatsApp shows its own contact picker. If the app isn't installed we fall
   * back to the wa.me web link.
   */
  function onSendWhatsApp() {
    if (!bill || !order) return;
    const raw = waPhone.trim();
    const phone = raw ? normalizeIndianMobile(raw) : null;
    if (raw && !phone) {
      feel.error(); // a rejected number should feel rejected
      Alert.alert(
        "Invalid number",
        "Enter the customer's 10-digit mobile number, or leave it blank to pick the contact inside WhatsApp."
      );
      return;
    }
    feel.press(); // handing off to another app
    const text = encodeURIComponent(
      formatWhatsAppReceipt({
        profile: restaurant ?? { name: "Brew Brothers" },
        bill,
        order,
        paymentLabel: bill.paymentMode
          ? paymentLabel(bill.paymentMode)
          : selectedMode
            ? paymentLabel(selectedMode)
            : null,
        nonChargeable: isNc,
        ncReasonLabel,
      })
    );
    setWaOpen(false);
    void (async () => {
      try {
        await Linking.openURL(
          `whatsapp://send?text=${text}${phone ? `&phone=${phone}` : ""}`
        );
      } catch {
        try {
          await Linking.openURL(`https://wa.me/${phone ?? ""}?text=${text}`);
        } catch {
          feel.error();
          Alert.alert(
            "Couldn't open WhatsApp",
            "Install WhatsApp on this device to send bills."
          );
        }
      }
    })();
  }

  if (billLoading || !bill) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Loading bill…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Sheet header */}
      <View style={styles.topBar}>
        <View style={styles.topBarText}>
          <Text style={styles.topBarTitle}>{bill.tableLabel}</Text>
          <Text style={styles.topBarSub}>
            {bill.billNumber !== undefined
              ? `Bill No ${formatBillNumber(bill.billNumber)} · `
              : ""}
            {isVoid
              ? "Cancelled"
              : !isPaid
                ? "Open bill"
                : bill.nonChargeable
                  ? "Non-Chargeable"
                  : `Paid via ${paymentLabel(bill.paymentMode!)}`}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          onPress={onClose}
          onPressIn={feel.dismiss}
          hitSlop={8}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          // A receipt is a narrow document. Stretched across a tablet the
          // item names and their amounts stop reading as pairs.
          isTablet && styles.bodyReadingWidth,
        ]}
      >
        {/* ── Items ───────────────────────────────────────────────────────── */}
        {order && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Items</Text>
            {order.items
              .filter((i) => !i.voided)
              .map((i) => (
                <View key={i.lineId}>
                  <View style={styles.row}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {i.name} <Text style={styles.itemQty}>× {i.qty}</Text>
                    </Text>
                    <Text style={styles.rowValue}>
                      {formatMoney(i.price * i.qty)}
                    </Text>
                  </View>
                  {/* Named under the line it discounted, so a guest querying
                      the total can see exactly where the money came off. */}
                  {(i.offerDiscount ?? 0) > 0 ? (
                    <View style={styles.row}>
                      <Text style={styles.offerLine} numberOfLines={1}>
                        🏷 {i.offerName ?? "Offer"}
                      </Text>
                      <Text style={styles.offerValue}>
                        −{formatMoney(i.offerDiscount ?? 0)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowValue}>Item Total</Text>
              <Text style={styles.rowValue}>{formatMoney(bill.subtotal)}</Text>
            </View>
          </View>
        )}

        {/* ── Summary ─────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>

          <Row label="Subtotal" value={formatMoney(bill.subtotal)} />

          {/* Offers come off before tax, so the row sits above GST — the order
              on screen is the order of the arithmetic. */}
          {(bill.offerDiscount ?? 0) > 0 && (
            <View style={styles.row}>
              <Text style={styles.offerTotalLabel}>Offer savings</Text>
              <Text style={styles.offerTotalValue}>
                −{formatMoney(bill.offerDiscount ?? 0)}
              </Text>
            </View>
          )}

          {/* Bills created with the GST switch off carry zero tax — omit the row. */}
          {bill.gstTotal > 0 && (
            <Row label="GST (5%)" value={formatMoney(bill.gstTotal)} />
          )}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Grand Total</Text>
            <Text
              style={[
                styles.totalValue,
                (isNc || isVoid) && styles.totalValueStruck,
              ]}
            >
              {formatMoney(bill.grandTotal)}
            </Text>
          </View>

          {/* The comped bill keeps its real total above — the cashier should
              always see the size of what's being given away — with the ₹0
              payable stated separately underneath. */}
          {isNc && (
            <>
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Amount Payable</Text>
                <Text style={styles.ncPayableValue}>{formatMoney(0)}</Text>
              </View>
              <Text style={styles.ncFootnote}>
                Non-chargeable{ncReasonLabel ? ` · ${ncReasonLabel}` : ""} — not
                counted in sales.
              </Text>
            </>
          )}
        </View>

        {/* ── Payment Method ──────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Method</Text>
          <View style={styles.tileRow}>
            {PAYMENT_TILES.map((t) => {
              const active = selectedMode === t.mode;
              return (
                <Pressable
                  key={t.mode}
                  style={({ pressed }) => [
                    styles.tile,
                    active && styles.tileActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    if (isSettled) return;
                    // Picking how the guest pays is choosing between options;
                    // the commit is the Settle button underneath.
                    if (!active) feel.select();
                    setSelectedMode(t.mode);
                    setNcSel(null); // picking a payment undoes a pending comp
                  }}
                  disabled={isSettled}
                >
                  <Text style={styles.tileIcon}>{t.icon}</Text>
                  <Text
                    style={[styles.tileLabel, active && styles.tileLabelActive]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Non-chargeable sits apart from the three tiles on purpose: it is
              not a way of paying, it is the decision not to charge. */}
          {!isSettled && (
            <Pressable
              style={({ pressed }) => [
                styles.ncBtn,
                ncSel !== null && styles.ncBtnActive,
                pressed && styles.pressed,
              ]}
              onPress={onPickNc}
              disabled={busy !== null}
            >
              <Text style={styles.tileIcon}>🎁</Text>
              <View style={styles.ncBtnText}>
                <Text
                  style={[
                    styles.ncBtnLabel,
                    ncSel !== null && styles.ncBtnLabelActive,
                  ]}
                >
                  Non-Chargeable (NC)
                </Text>
                <Text style={styles.ncBtnMeta} numberOfLines={1}>
                  {ncSel
                    ? `${NC_REASON_LABELS[ncSel.reason]}${
                        ncSel.note ? ` · ${ncSel.note}` : ""
                      } — tap to change`
                    : "No payment collected · excluded from sales"}
                </Text>
              </View>
            </Pressable>
          )}
        </View>

        {/* ── Send Receipt ────────────────────────────────────────────────── */}
        {/* Withheld on a cancelled bill: handing the customer a receipt for a
            sale that has been refunded is the one thing worse than no receipt. */}
        {!isVoid && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Send Receipt</Text>
          <View style={styles.tileRow}>
            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              onPress={onPrint}
              disabled={busy !== null}
            >
              <Text style={styles.tileIcon}>🖨</Text>
              <Text style={styles.tileLabel}>Thermal Printer</Text>
              <Text style={styles.tileMeta}>
                {busy === "print"
                  ? "Printing…"
                  : justPrinted
                    ? "Printed ✓"
                    : `Printed ${bill.printedCount}×`}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              onPress={() => {
                feel.press();
                setWaPhone("");
                setWaOpen(true);
              }}
              disabled={busy !== null}
            >
              <Text style={styles.tileIcon}>💬</Text>
              <Text style={styles.tileLabel}>WhatsApp</Text>
              <Text style={styles.tileMeta}>Send bill</Text>
            </Pressable>
          </View>
        </View>
        )}

        {/* ── Settle / Paid / Cancelled state ─────────────────────────────── */}
        {isVoid ? (
          <View style={styles.voidBanner}>
            <Text style={styles.voidBannerText}>
              Bill Cancelled{voidReasonLabel ? ` · ${voidReasonLabel}` : ""}
            </Text>
            <Text style={styles.voidBannerMeta}>
              {formatMoney(bill.grandTotal)} refunded
              {bill.voidedAt ? ` · ${formatTimeIST(bill.voidedAt.toDate())}` : ""}
            </Text>
            {!!bill.voidNote && (
              <Text style={styles.voidBannerMeta}>{bill.voidNote}</Text>
            )}
          </View>
        ) : isPaid ? (
          <>
            <View style={[styles.paidBanner, isNc && styles.ncBanner]}>
              <Text style={[styles.paidBannerText, isNc && styles.ncBannerText]}>
                {isNc
                  ? `Non-Chargeable${ncReasonLabel ? ` · ${ncReasonLabel}` : ""}`
                  : `Paid via ${paymentLabel(bill.paymentMode!)}`}
              </Text>
              {isNc && (
                <Text style={styles.ncBannerMeta}>
                  {formatMoney(bill.grandTotal)} comped
                  {bill.ncNote ? ` · ${bill.ncNote}` : ""}
                </Text>
              )}
            </View>

            {/* The one way back out of a settled bill — deliberately plain and
                unpressable-looking, and gone entirely the next business day. */}
            {canVoid && (
              <Pressable
                style={({ pressed }) => [
                  styles.voidBtn,
                  pressed && styles.pressed,
                ]}
                onPress={onPickVoid}
                disabled={busy !== null}
              >
                {busy === "void" ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <>
                    <Text style={styles.voidBtnText}>Cancel this bill</Text>
                    <Text style={styles.voidBtnMeta}>
                      Refund the customer and remove this sale from today
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.settleBtn,
              ncSel !== null && styles.settleBtnNc,
              !canSettle && styles.settleBtnDisabled,
              pressed && styles.pressedScale,
            ]}
            onPress={onSettle}
            disabled={!canSettle}
          >
            {busy === "settle" ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.settleBtnText}>
                {ncSel
                  ? `Mark Non-Chargeable · ${formatMoney(0)}`
                  : selectedMode
                    ? `Settle ${formatMoney(bill.grandTotal)}`
                    : "Select a payment method"}
              </Text>
            )}
          </Pressable>
        )}
      </ScrollView>

      {/* ── WhatsApp number dialog ─────────────────────────────────────────── */}
      <Modal
        visible={waOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          feel.dismiss();
          setWaOpen(false);
        }}
      >
        <View style={styles.waOverlay}>
          <View style={styles.waSheet}>
            <Text style={styles.waTitle}>Send bill on WhatsApp</Text>
            <Text style={styles.waHint}>
              Customer's mobile number — or leave blank to pick the contact
              inside WhatsApp.
            </Text>
            <TextInput
              style={styles.waInput}
              value={waPhone}
              onChangeText={setWaPhone}
              keyboardType="phone-pad"
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.textMuted}
              maxLength={14}
              autoFocus
            />
            <View style={styles.waActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnGhost,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  feel.dismiss();
                  setWaOpen(false);
                }}
              >
                <Text style={styles.waBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnPrimary,
                  pressed && styles.pressedScale,
                ]}
                onPress={onSendWhatsApp}
              >
                <Text style={styles.waBtnPrimaryText}>Open WhatsApp</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Non-chargeable reason sheet ────────────────────────────────────── */}
      <Modal
        visible={ncOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          feel.dismiss();
          setNcOpen(false);
        }}
      >
        <View style={styles.waOverlay}>
          <View style={styles.waSheet}>
            <Text style={styles.waTitle}>Mark as Non-Chargeable</Text>
            <Text style={styles.waHint}>
              {formatMoney(bill.grandTotal)} will not be collected and will not
              appear in your sales. Pick a reason so it can be accounted for.
            </Text>

            <View style={styles.ncChips}>
              {NC_REASONS.map((r) => {
                const active = ncDraftReason === r;
                return (
                  <Pressable
                    key={r}
                    style={({ pressed }) => [
                      styles.ncChip,
                      active && styles.ncChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      if (!active) feel.select();
                      setNcDraftReason(r);
                    }}
                  >
                    <Text
                      style={[
                        styles.ncChipText,
                        active && styles.ncChipTextActive,
                      ]}
                    >
                      {NC_REASON_LABELS[r]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.waInput}
              value={ncDraftNote}
              onChangeText={setNcDraftNote}
              placeholder="Note (optional) — e.g. guest of owner"
              placeholderTextColor={colors.textMuted}
              maxLength={140}
            />

            <View style={styles.waActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnGhost,
                  pressed && styles.pressed,
                ]}
                onPress={
                  ncSel
                    ? onClearNc
                    : () => {
                        feel.dismiss();
                        setNcOpen(false);
                      }
                }
              >
                <Text style={styles.waBtnGhostText}>
                  {ncSel ? "Remove NC" : "Cancel"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnPrimary,
                  !ncDraftReason && styles.waBtnDisabled,
                  pressed && styles.pressedScale,
                ]}
                onPress={onConfirmNc}
                disabled={!ncDraftReason}
              >
                <Text style={styles.waBtnPrimaryText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Cancel-bill reason sheet ───────────────────────────────────────── */}
      <Modal
        visible={voidOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          feel.dismiss();
          setVoidOpen(false);
        }}
      >
        <View style={styles.waOverlay}>
          <View style={styles.waSheet}>
            <Text style={styles.waTitle}>Cancel this bill</Text>
            <Text style={styles.waHint}>
              {formatMoney(bill.grandTotal)} will be refunded to the customer and
              taken back out of today's sales. Pick a reason so it can be
              accounted for.
            </Text>

            <View style={styles.ncChips}>
              {VOID_REASONS.map((r) => {
                const active = voidDraftReason === r;
                return (
                  <Pressable
                    key={r}
                    style={({ pressed }) => [
                      styles.ncChip,
                      active && styles.voidChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      if (!active) feel.select();
                      setVoidDraftReason(r);
                    }}
                  >
                    <Text
                      style={[
                        styles.ncChipText,
                        active && styles.voidChipTextActive,
                      ]}
                    >
                      {VOID_REASON_LABELS[r]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.waInput}
              value={voidDraftNote}
              onChangeText={setVoidDraftNote}
              placeholder="Note (optional) — e.g. curry was cold, table 4"
              placeholderTextColor={colors.textMuted}
              maxLength={140}
            />

            <View style={styles.waActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnGhost,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  feel.dismiss();
                  setVoidOpen(false);
                }}
              >
                <Text style={styles.waBtnGhostText}>Keep bill</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.waBtn,
                  styles.waBtnDanger,
                  !voidDraftReason && styles.waBtnDisabled,
                  pressed && styles.pressedScale,
                ]}
                onPress={onConfirmVoid}
                disabled={!voidDraftReason}
              >
                <Text style={styles.waBtnPrimaryText}>Cancel bill</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
  pressedScale: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: space.s6,
  },
  loadingText: { marginTop: space.s3, color: colors.textMuted, fontSize: 14 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  topBarText: { flex: 1 },
  topBarTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  topBarSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  closeBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  closeBtnText: { fontSize: 14, fontWeight: "600", color: colors.text },

  body: { padding: space.s4, paddingBottom: space.s6, gap: space.s4 },
  bodyReadingWidth: { width: "100%", maxWidth: 720, alignSelf: "center" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s4,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: space.s3,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.s2,
  },
  rowLabel: { fontSize: 15, color: colors.text },
  rowValue: { fontSize: 15, fontWeight: "600", color: colors.text },
  itemName: { flex: 1, fontSize: 15, color: colors.text, marginRight: space.s3 },
  itemQty: { color: colors.textMuted, fontWeight: "600" },
  offerLine: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.saveGreen,
    marginRight: space.s3,
    paddingLeft: space.s3,
  },
  offerValue: { fontSize: 13, fontWeight: "700", color: colors.saveGreen },
  offerTotalLabel: { fontSize: 15, fontWeight: "600", color: colors.saveGreen },
  offerTotalValue: { fontSize: 15, fontWeight: "700", color: colors.saveGreen },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.s3,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 17, fontWeight: "700", color: colors.text },
  totalValue: { fontSize: 20, fontWeight: "800", color: colors.primary },
  // Comped: the real total stays visible but reads as "not being collected".
  totalValueStruck: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  ncPayableValue: { fontSize: 20, fontWeight: "800", color: colors.ncAmber },
  ncFootnote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: space.s2,
    lineHeight: 17,
  },

  tileRow: { flexDirection: "row", gap: space.s3 },
  tile: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: space.s4,
    paddingHorizontal: space.s2,
    alignItems: "center",
    gap: space.s1,
  },
  tileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  tileDisabled: { opacity: 0.5 },
  tileIcon: { fontSize: 22 },
  tileLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  tileLabelActive: { color: colors.primaryDark },
  tileMeta: { fontSize: 11, color: colors.textMuted },

  // The NC control: full width and visually apart from the payment tiles.
  ncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    marginTop: space.s3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.ncAmberBorder,
    backgroundColor: colors.surface,
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
  },
  ncBtnActive: {
    borderStyle: "solid",
    borderColor: colors.ncAmber,
    backgroundColor: colors.ncAmberSoft,
  },
  ncBtnText: { flex: 1 },
  ncBtnLabel: { fontSize: 14, fontWeight: "700", color: colors.text },
  ncBtnLabelActive: { color: colors.ncAmber },
  ncBtnMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  settleBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    alignItems: "center",
    ...shadow.card,
  },
  settleBtnNc: { backgroundColor: colors.ncAmber },
  settleBtnDisabled: { backgroundColor: colors.borderStrong },
  settleBtnText: { fontSize: 17, fontWeight: "700", color: colors.textInverse },

  paidBanner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  paidBannerText: { fontSize: 16, fontWeight: "700", color: colors.primaryDark },
  ncBanner: {
    backgroundColor: colors.ncAmberSoft,
    borderColor: colors.ncAmber,
  },
  ncBannerText: { color: colors.ncAmber },
  ncBannerMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  ncChips: { flexDirection: "row", flexWrap: "wrap", gap: space.s2 },
  ncChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ncChipActive: {
    borderColor: colors.ncAmber,
    backgroundColor: colors.ncAmberSoft,
  },
  ncChipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  ncChipTextActive: { color: colors.ncAmber },

  // Cancelled: red rather than amber. A comp is a choice the restaurant made
  // up front; a cancellation is money going back out after the fact.
  voidBtn: {
    marginTop: space.s3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    paddingVertical: space.s3,
    alignItems: "center",
  },
  voidBtnText: { fontSize: 15, fontWeight: "700", color: colors.danger },
  voidBtnMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  voidBanner: {
    backgroundColor: colors.statusRedSoft,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.danger,
  },
  voidBannerText: { fontSize: 16, fontWeight: "700", color: colors.danger },
  voidBannerMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  voidChipActive: {
    borderColor: colors.danger,
    backgroundColor: colors.statusRedSoft,
  },
  voidChipTextActive: { color: colors.danger },
  waBtnDanger: { backgroundColor: colors.danger },

  waOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: space.s5,
  },
  waSheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s5,
    gap: space.s3,
    ...shadow.card,
  },
  waTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  waHint: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  waInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  waActions: { flexDirection: "row", gap: space.s3, marginTop: space.s1 },
  waBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    alignItems: "center",
  },
  waBtnGhost: { backgroundColor: colors.surfaceMuted },
  waBtnGhostText: { fontSize: 15, fontWeight: "600", color: colors.text },
  waBtnPrimary: { backgroundColor: colors.primary },
  waBtnDisabled: { backgroundColor: colors.borderStrong },
  waBtnPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textInverse,
  },
});
