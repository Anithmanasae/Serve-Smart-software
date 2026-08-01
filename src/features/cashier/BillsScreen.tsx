/**
 * Bills (Cashier) — SADA POS, React Native port.
 *
 * Landing list for the cashier: bills a waiter has requested / finalized bills
 * in progress (`useActiveBills`), plus open orders split by kitchen progress
 * (`useBillableOrders`): kitchen-done orders under "Ready to bill" (tappable —
 * calls the ported `generateBill`, then opens the resulting bill) and orders
 * the kitchen is still working on under "Preparing…" (greyed out, NOT
 * tappable — food first, pay after). All data is live; every write goes
 * through `cashierApi` — this screen never touches Firestore or does money
 * math.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney } from "@/lib/money";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { Bill, Order, Table } from "@/types/models";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { generateBill } from "./cashierApi";
import {
  useActiveBills,
  useAllTables,
  useBillableOrders,
} from "./useCashierData";
import { BillDetail } from "./BillDetail";

type BillRow = { kind: "bill"; bill: Bill & { id: string } };
type OrderRow = { kind: "order"; order: Order & { id: string } };
type PreparingRow = { kind: "preparing"; order: Order & { id: string } };
type Row = BillRow | OrderRow | PreparingRow;

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  cashier: "Cashier",
  waiter: "Waiter",
  kitchen: "Kitchen",
};

/** ms -> "5m ago" / "1h 20m ago" / "just now". */
function timeAgo(fromMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - fromMs) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

export function BillsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, firebaseUser, role } = useAuth();
  const cashierUid = profile?.uid ?? firebaseUser?.uid ?? "";
  const cashierName = profile?.name ?? "Cashier";
  const roleLabel = role ? ROLE_LABELS[role] ?? role : "";

  const { gstEnabled } = useSettings();

  const { data: bills, loading: billsLoading } = useActiveBills();
  const {
    data: orders,
    preparing,
    loading: ordersLoading,
  } = useBillableOrders();
  const { data: tables } = useAllTables();

  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const tableLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tables as (Table & { id: string })[]) {
      map.set(t.id, t.label ?? `T${t.number}`);
    }
    return map;
  }, [tables]);

  function orderLabel(o: Order): string {
    if (o.tableId) return tableLabelById.get(o.tableId) ?? "Table";
    return o.orderType === "delivery" ? "Delivery" : "Takeaway";
  }

  const sections = useMemo(() => {
    const billRows: Row[] = [...bills]
      .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
      .map((bill) => ({ kind: "bill", bill }));
    const orderRows: Row[] = [...orders]
      .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
      .map((order) => ({ kind: "order", order }));
    const preparingRows: Row[] = [...preparing]
      .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))
      .map((order) => ({ kind: "preparing", order }));

    return [
      { title: "Bills", data: billRows },
      { title: "Ready to bill", data: orderRows },
      { title: "Preparing…", data: preparingRows },
    ].filter((s) => s.data.length > 0);
  }, [bills, orders, preparing]);

  const now = Date.now();
  const loading = billsLoading || ordersLoading;

  async function handleGenerate(order: Order & { id: string }) {
    if (generatingId) return;
    setGeneratingId(order.id);
    try {
      const billId = await generateBill(
        order,
        cashierUid,
        orderLabel(order),
        gstEnabled
      );
      setSelectedBillId(billId);
    } catch (e) {
      Alert.alert("Could not bill", e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header — cashier identity */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {cashierName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Bills</Text>
          <Text style={styles.subtitle}>
            {cashierName}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </Text>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) =>
          item.kind === "bill"
            ? `b:${item.bill.id}`
            : item.kind === "order"
              ? `o:${item.order.id}`
              : `p:${item.order.id}`
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + space.s6 },
        ]}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) =>
          item.kind === "bill" ? (
            <BillCard
              bill={item.bill}
              now={now}
              onPress={() => setSelectedBillId(item.bill.id)}
            />
          ) : item.kind === "order" ? (
            <OrderCard
              order={item.order}
              label={orderLabel(item.order)}
              now={now}
              busy={generatingId === item.order.id}
              disabled={generatingId !== null}
              onPress={() => handleGenerate(item.order)}
            />
          ) : (
            <PreparingCard
              order={item.order}
              label={orderLabel(item.order)}
              now={now}
            />
          )
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? "Loading bills…" : "No bills to settle right now."}
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

function statusMeta(status: Bill["status"]): { label: string; bg: string; fg: string } {
  switch (status) {
    case "requested":
      return { label: "Requested", bg: colors.navySoft, fg: colors.navyText };
    case "finalized":
      return { label: "In progress", bg: colors.primarySoft, fg: colors.primary };
    case "paid":
      return { label: "Paid", bg: colors.surfaceMuted, fg: colors.textMuted };
    default:
      return { label: status, bg: colors.surfaceMuted, fg: colors.textMuted };
  }
}

function BillCard({
  bill,
  now,
  onPress,
}: {
  bill: Bill & { id: string };
  now: number;
  onPress: () => void;
}) {
  const meta = statusMeta(bill.status);
  const createdMs = bill.createdAt?.toMillis() ?? null;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitleText}>{bill.tableLabel}</Text>
        <View style={[styles.pill, { backgroundColor: meta.bg }]}>
          <Text style={[styles.pillText, { color: meta.fg }]}>{meta.label}</Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTotal}>{formatMoney(bill.grandTotal)}</Text>
        {createdMs !== null && (
          <Text style={styles.cardTime}>{timeAgo(createdMs, now)}</Text>
        )}
      </View>
    </Pressable>
  );
}

function OrderCard({
  order,
  label,
  now,
  busy,
  disabled,
  onPress,
}: {
  order: Order & { id: string };
  label: string;
  now: number;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const createdMs = order.createdAt?.toMillis() ?? null;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        disabled && !busy && styles.cardDim,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitleText}>{label}</Text>
        <View style={styles.readyBtn}>
          {busy ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.readyBtnText}>Bill →</Text>
          )}
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTotal}>{formatMoney(order.subtotal)}</Text>
        {createdMs !== null && (
          <Text style={styles.cardTime}>{timeAgo(createdMs, now)}</Text>
        )}
      </View>
    </Pressable>
  );
}

/** Kitchen still cooking: visible so the cashier knows the table exists, but
 *  greyed out and not tappable — it cannot be billed until every ticket is
 *  completed (it then moves to "Ready to bill" automatically). */
function PreparingCard({
  order,
  label,
  now,
}: {
  order: Order & { id: string };
  label: string;
  now: number;
}) {
  const createdMs = order.createdAt?.toMillis() ?? null;
  return (
    <View style={[styles.card, styles.cardDim]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitleText}>{label}</Text>
        <View style={[styles.pill, { backgroundColor: colors.navySoft }]}>
          <Text style={[styles.pillText, { color: colors.navyText }]}>
            Preparing…
          </Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTotal}>{formatMoney(order.subtotal)}</Text>
        {createdMs !== null && (
          <Text style={styles.cardTime}>{timeAgo(createdMs, now)}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingHorizontal: space.s4,
    paddingTop: space.s4,
    paddingBottom: space.s3,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700", color: colors.textInverse },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 2 },

  list: { paddingHorizontal: space.s4 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space.s4,
    marginBottom: space.s2,
  },
  empty: {
    textAlign: "center",
    color: colors.textMuted,
    padding: space.s6,
    fontSize: 14,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.s3,
    ...shadow.card,
  },
  cardDim: { opacity: 0.6 },
  cardPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitleText: { fontSize: 17, fontWeight: "700", color: colors.text },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: space.s3,
  },
  cardTotal: { fontSize: 18, fontWeight: "700", color: colors.text },
  cardTime: { fontSize: 12, color: colors.textMuted },

  pill: {
    paddingHorizontal: space.s2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: 11, fontWeight: "700" },

  readyBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    minWidth: 64,
    alignItems: "center",
  },
  readyBtnText: { fontSize: 13, fontWeight: "700", color: colors.textInverse },
});
