/**
 * Bill detail — SADA POS Cashier, React Native port.
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
import { tapFeedback } from "@/lib/feedback";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { PaymentMode } from "@/types/models";
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
import { reprintBill, settleBill } from "./cashierApi";
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
  const { data: bill, loading: billLoading } = useBill(billId);
  const { data: order } = useOrder(bill?.orderId ?? null);
  const { data: restaurant } = useRestaurantProfile();
  const { profile: cashierProfile } = useAuth();

  const isPaid = bill?.status === "paid";

  // Local UI selections (bill.paymentMode is null until settled).
  const [selectedMode, setSelectedMode] = useState<PaymentMode | null>(null);
  const [busy, setBusy] = useState<null | "settle" | "print">(null);
  const [justPrinted, setJustPrinted] = useState(false);

  // WhatsApp send: number-entry dialog state.
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState("");

  // Reflect the settled mode once a bill is paid.
  useEffect(() => {
    if (bill?.paymentMode) setSelectedMode(bill.paymentMode);
  }, [bill?.paymentMode]);

  const canSettle = useMemo(
    () => !!bill && !!order && !isPaid && !!selectedMode && busy === null,
    [bill, order, isPaid, selectedMode, busy]
  );

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onSettle() {
    if (!bill || !order || !selectedMode) return;
    tapFeedback();
    void run("settle", async () => {
      await settleBill(bill, order, selectedMode);
      onClose();
    });
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
      Alert.alert("Printing unavailable", PRINTING_UNAVAILABLE_MESSAGE);
      return;
    }
    tapFeedback();
    setBusy("print");
    setJustPrinted(false);
    void (async () => {
      try {
        const paperWidth = await getPaperWidth();
        const receipt = encodeReceipt({
          profile: restaurant ?? { name: "SADA POS" },
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
        });
        await printToSavedPrinter(receipt.bytes);
        await reprintBill(bill.id, bill.printedCount);
        setJustPrinted(true);
      } catch (e) {
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
      Alert.alert(
        "Invalid number",
        "Enter the customer's 10-digit mobile number, or leave it blank to pick the contact inside WhatsApp."
      );
      return;
    }
    tapFeedback();
    const text = encodeURIComponent(
      formatWhatsAppReceipt({
        profile: restaurant ?? { name: "SADA POS" },
        bill,
        order,
        paymentLabel: bill.paymentMode
          ? paymentLabel(bill.paymentMode)
          : selectedMode
            ? paymentLabel(selectedMode)
            : null,
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
            {isPaid ? `Paid via ${paymentLabel(bill.paymentMode!)}` : "Open bill"}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          onPress={onClose}
          hitSlop={8}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* ── Items ───────────────────────────────────────────────────────── */}
        {order && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Items</Text>
            {order.items
              .filter((i) => !i.voided)
              .map((i) => (
                <View style={styles.row} key={i.lineId}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {i.name} <Text style={styles.itemQty}>× {i.qty}</Text>
                  </Text>
                  <Text style={styles.rowValue}>
                    {formatMoney(i.price * i.qty)}
                  </Text>
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

          {/* Bills created with the GST switch off carry zero tax — omit the row. */}
          {bill.gstTotal > 0 && (
            <Row label="GST (5%)" value={formatMoney(bill.gstTotal)} />
          )}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Grand Total</Text>
            <Text style={styles.totalValue}>{formatMoney(bill.grandTotal)}</Text>
          </View>
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
                  onPress={() => !isPaid && setSelectedMode(t.mode)}
                  disabled={isPaid}
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
        </View>

        {/* ── Send Receipt ────────────────────────────────────────────────── */}
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
                tapFeedback();
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

        {/* ── Settle / Paid state ─────────────────────────────────────────── */}
        {isPaid ? (
          <View style={styles.paidBanner}>
            <Text style={styles.paidBannerText}>
              Paid via {paymentLabel(bill.paymentMode!)}
            </Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.settleBtn,
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
                {selectedMode
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
        onRequestClose={() => setWaOpen(false)}
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
                onPress={() => setWaOpen(false)}
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

  settleBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space.s4,
    alignItems: "center",
    ...shadow.card,
  },
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
  waBtnPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textInverse,
  },
});
