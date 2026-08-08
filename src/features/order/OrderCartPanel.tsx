/**
 * "Current Order" — every line on the order, the money, and the two commit
 * buttons (Send KOT / Generate Bill).
 *
 * One component, two homes: on a phone it is the body of the bottom sheet
 * (`variant="sheet"`), on a tablet it is the permanently-docked right pane
 * (`variant="pane"`). The waiter must never be shown two carts that can drift
 * apart, so only the chrome differs — the lines, the totals and the buttons
 * are the same code either way.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { formatMoney } from "@/lib/money";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import type { OrderItem } from "@/types/models";
import { OrderLineRow } from "./OrderLineRow";

interface OrderCartPanelProps {
  variant: "sheet" | "pane";
  lines: OrderItem[];
  /** "T4" / "Takeaway" — pane only; the sheet's screen already shows it. */
  tableLabel?: string;
  /** Sum of line quantities, for the pane header count. */
  itemCount: number;
  /** GROSS of offers, per the bill model. */
  subtotal: number;
  offerDiscount: number;
  /** subtotal − offerDiscount: what the guest actually owes pre-tax. */
  payable: number;
  pendingCount: number;
  busy: boolean;
  orderLocked: boolean;
  /** Counter flow: this user may bill a takeaway order here. */
  canBillHere: boolean;
  onQty: (lineId: string, qty: number) => void;
  onNotes: (lineId: string, notes: string) => void;
  onSendKot: () => void;
  onGenerateBill: () => void;
  /** Sheet only — dismisses back to the menu grid. */
  onClose?: () => void;
}

export function OrderCartPanel({
  variant,
  lines,
  tableLabel,
  itemCount,
  subtotal,
  offerDiscount,
  payable,
  pendingCount,
  busy,
  orderLocked,
  canBillHere,
  onQty,
  onNotes,
  onSendKot,
  onGenerateBill,
  onClose,
}: OrderCartPanelProps) {
  const isPane = variant === "pane";

  return (
    <View style={isPane ? styles.pane : styles.sheetBody}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Current Order</Text>
          {isPane ? (
            <Text style={styles.subtitle}>
              {tableLabel}
              {itemCount > 0
                ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}`
                : ""}
            </Text>
          ) : null}
        </View>
        {onClose ? (
          <PressableScale hitSlop={8} haptic="dismiss" onPress={onClose}>
            <Text style={styles.addItemsLink}>＋ Add Items</Text>
          </PressableScale>
        ) : null}
      </View>

      <ScrollView
        style={isPane ? styles.paneScroll : styles.sheetScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {lines.length === 0 ? (
          isPane ? (
            // The pane is always on screen, so its empty state has to say what
            // to do rather than just report that nothing is there.
            <View style={styles.empty}>
              <Feather name="shopping-bag" size={26} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>No items yet</Text>
              <Text style={styles.emptySub}>
                Pick a category, then tap ＋ on a dish to start the order.
              </Text>
            </View>
          ) : (
            <Text style={styles.emptySub}>No items yet.</Text>
          )
        ) : (
          lines.map((line) => (
            <OrderLineRow
              key={line.lineId}
              line={line}
              onQty={(qty) => onQty(line.lineId, qty)}
              onNotes={(notes) => onNotes(line.lineId, notes)}
            />
          ))
        )}
      </ScrollView>

      {/* The sheet's own container already pads for the gesture bar; the pane
          reaches the bottom of the window and has to pad for itself. */}
      <View style={[styles.footer, isPane && styles.footerPane]}>
        {/* The saving is stated as its own line, never folded silently into
            the total — it is the thing the guest is meant to hear. */}
        {offerDiscount > 0 ? (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Item total</Text>
              <Text style={styles.subtotalValue}>{formatMoney(subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.savingLabel}>Offer savings</Text>
              <Text style={styles.savingValue}>
                −{formatMoney(offerDiscount)}
              </Text>
            </View>
          </>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(payable)}</Text>
        </View>

        <PressableScale
          // A full-width bar needs a far gentler squeeze than a 32px stepper.
          activeScale={0.98}
          // These two commit money and fire the kitchen, so they land heavier
          // than an ordinary tap on touch-down; `onSendKot`/`onGenerateBill`
          // then answer with a confirm or a reject once the write resolves.
          haptic="press"
          style={[
            styles.sendBtn,
            (pendingCount === 0 || busy) && styles.btnDisabled,
          ]}
          onPress={onSendKot}
          disabled={pendingCount === 0 || busy}
        >
          <Text style={styles.btnText}>
            ➤ Send KOT{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Text>
        </PressableScale>

        {canBillHere && lines.length > 0 ? (
          <PressableScale
            activeScale={0.98}
            haptic="press"
            style={[
              styles.billBtn,
              (pendingCount > 0 || busy) && styles.btnDisabled,
            ]}
            onPress={onGenerateBill}
            disabled={pendingCount > 0 || busy}
          >
            <Text style={styles.btnText}>
              {orderLocked
                ? "View Bill"
                : pendingCount > 0
                  ? "Send KOT before billing"
                  : `Generate Bill · ${formatMoney(payable)}`}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Docked tablet pane: a full-height white card hugging the right edge.
  pane: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderBottomLeftRadius: radius.xxl,
    paddingHorizontal: space.s4,
    paddingTop: space.s4,
    ...shadow.float,
  },
  sheetBody: {
    flexShrink: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    paddingBottom: space.s2,
  },
  headerText: {
    flexShrink: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  addItemsLink: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  // The pane's list takes all the height left between header and footer; the
  // sheet's grows only as far as its own maxHeight allows.
  paneScroll: {
    flex: 1,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s6,
    paddingHorizontal: space.s4,
    gap: space.s2,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  footer: {
    paddingTop: space.s3,
    gap: space.s3,
  },
  footerPane: {
    paddingBottom: space.s4,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s1,
  },
  totalLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  totalValue: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.text,
  },
  subtotalValue: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textMuted,
  },
  savingLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.saveGreen,
  },
  savingValue: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    color: colors.saveGreen,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.glow,
  },
  billBtn: {
    backgroundColor: colors.primaryDark,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: colors.textInverse,
    fontFamily: fonts.extrabold,
    fontSize: 16,
  },
});
