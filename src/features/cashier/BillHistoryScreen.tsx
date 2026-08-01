/**
 * Bill history — settled (paid) bills, newest first, grouped by business day.
 *
 * Reached from the Account screen. Tapping a bill opens the same `BillDetail`
 * sheet the cashier uses to settle: for a paid bill it renders read-only with
 * the reprint tile still active, so the cashier can print a customer a copy
 * of an old bill. All data is live via `usePaidBills`; this screen never
 * touches Firestore or does money math.
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { formatMoney } from "@/lib/money";
import { dayKey, formatTimeIST } from "@/lib/date";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { Bill, PaymentMode } from "@/types/models";
import { BillDetail } from "./BillDetail";
import { usePaidBills } from "./useCashierData";

const MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI / QR",
  card: "Card",
};

/** "2026-07-07" -> "Today" / "Yesterday" / "7 Jul 2026". */
function dayLabel(key: string): string {
  if (key === dayKey()) return "Today";
  if (key === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000)))
    return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

export function BillHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { data: bills, loading } = usePaidBills();
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  // Query is already paidAt-descending; bucket into IST business days.
  const sections = useMemo(() => {
    const byDay = new Map<string, (Bill & { id: string })[]>();
    for (const bill of bills) {
      if (!bill.paidAt) continue;
      const key = dayKey(bill.paidAt.toDate());
      const bucket = byDay.get(key);
      if (bucket) bucket.push(bill);
      else byDay.set(key, [bill]);
    }
    return [...byDay.entries()].map(([key, data]) => ({
      title: dayLabel(key),
      total: data.reduce((sum, b) => sum + b.grandTotal, 0),
      data,
    }));
  }, [bills]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Bill History</Text>
          <Text style={styles.subtitle}>Settled bills · last 30 days</Text>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + space.s6 },
        ]}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionTotal}>
              {formatMoney(section.total)}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => setSelectedBillId(item.id)}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardTitleText}>{item.tableLabel}</Text>
              <Text style={styles.cardTotal}>
                {formatMoney(item.grandTotal)}
              </Text>
            </View>
            <View style={styles.cardBottom}>
              <Text style={styles.cardMeta}>
                {item.paidAt ? formatTimeIST(item.paidAt.toDate()) : ""}
                {item.paymentMode
                  ? ` · ${MODE_LABELS[item.paymentMode]}`
                  : ""}
              </Text>
              <Text style={styles.cardMeta}>
                {item.printedCount > 0
                  ? `Printed ${item.printedCount}×`
                  : "Not printed"}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? "Loading history…" : "No settled bills yet."}
          </Text>
        }
      />

      <Modal
        visible={selectedBillId !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelectedBillId(null)}
      >
        {selectedBillId && (
          <View style={{ flex: 1, paddingTop: insets.top }}>
            <BillDetail
              billId={selectedBillId}
              onClose={() => setSelectedBillId(null)}
            />
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  backBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: { fontSize: 14, fontWeight: "600", color: colors.text },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  list: { paddingHorizontal: space.s4, gap: space.s3 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: space.s3,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionTotal: { fontSize: 13, fontWeight: "700", color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    gap: space.s2,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitleText: { fontSize: 16, fontWeight: "700", color: colors.text },
  cardTotal: { fontSize: 16, fontWeight: "800", color: colors.primary },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardMeta: { fontSize: 13, color: colors.textMuted },

  empty: {
    textAlign: "center",
    color: colors.textMuted,
    marginTop: space.s6,
    fontSize: 14,
  },
});
