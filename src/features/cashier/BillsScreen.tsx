/**
 * Bills (Cashier) — Smart Serve, React Native port.
 *
 * Landing list for the cashier: bills a waiter has requested / finalized bills
 * in progress (`useActiveBills`), plus open orders split by kitchen progress
 * (`useBillableOrders`): kitchen-done orders under "Ready to bill" (tappable —
 * calls the ported `generateBill`, then opens the resulting bill) and orders
 * the kitchen is still working on under "Preparing…" (greyed out, NOT
 * tappable — food first, pay after). All data is live; every write goes
 * through `cashierApi` — this screen never touches Firestore or does money
 * math.
 *
 * An order with NO ticket in the kitchen is neither of those things, and gets
 * its own section. It used to be lumped in with "Preparing…", which was both a
 * lie (nobody is cooking it — it was never sent) and a dead end (that card is
 * untappable, and nothing else in the app could reach the order either), so a
 * takeaway somebody started and walked away from sat on this screen forever
 * and the list only grew. Those cards carry Discard.
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
import { router } from "expo-router";
import { formatMoney } from "@/lib/money";
import { useResponsive } from "@/lib/responsive";
import { feel } from "@/lib/feedback";
import { Bone, Skeleton } from "@/components/Skeleton";
import { ProfileButton } from "@/components/ProfileButton";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, shadow, space } from "@/theme/theme";
import { BrandHeader } from "@/components/BrandHeader";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { Bill, Order, Table } from "@/types/models";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { useActivationContext } from "@/features/onboarding";
import {
  discardOrder,
  generateBill,
  hasLiveKitchenLines,
  wasEverSentToKitchen,
} from "./cashierApi";
import {
  useActiveBills,
  useAllTables,
  useBillableOrders,
} from "./useCashierData";
import { BillDetail } from "./BillDetail";

type BillRow = { kind: "bill"; bill: Bill & { id: string } };
type OrderRow = { kind: "order"; order: Order & { id: string } };
type PreparingRow = { kind: "preparing"; order: Order & { id: string } };
type UnsentRow = { kind: "unsent"; order: Order & { id: string } };
type Row = BillRow | OrderRow | PreparingRow | UnsentRow;

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
  const { isTablet } = useResponsive();
  const { profile, firebaseUser, role, config } = useAuth();
  const cashierUid = profile?.uid ?? firebaseUser?.uid ?? "";
  const cashierName = profile?.name ?? "Cashier";
  const roleLabel = role ? ROLE_LABELS[role] ?? role : "";

  const { gstEnabled } = useSettings();

  // A brand-new owner who has not billed anything yet. Null — and so false —
  // for every established restaurant; see `ActivationProvider`.
  const activation = useActivationContext();
  const preFirstBill = activation?.active === true && !activation.firstOrderDone;
  const orderEntryPath = config.tablesEnabled ? "/tables" : "/order";

  const { data: bills, loading: billsLoading } = useActiveBills();
  const {
    data: orders,
    preparing,
    loading: ordersLoading,
  } = useBillableOrders(config.kotEnabled);
  const { data: tables } = useAllTables();

  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  // The order whose discard confirm is on screen but unanswered — see
  // `handleDiscard`. Kept apart from `discardingId`, which drives the spinner
  // and only starts once the write is actually going.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    // "Preparing…" is only true of an order the kitchen actually holds. The
    // rest are notes somebody stopped writing, and they get to say so — and to
    // be thrown away.
    const byAge = [...preparing].sort(
      (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0)
    );
    const preparingRows: Row[] = byAge
      .filter((order) => hasLiveKitchenLines(order))
      .map((order) => ({ kind: "preparing", order }));
    const unsentRows: Row[] = byAge
      .filter((order) => !hasLiveKitchenLines(order))
      .map((order) => ({ kind: "unsent", order }));

    // Both kitchen sections come back empty in a quick-billing restaurant
    // (`isKitchenDone` is unconditionally true there, so nothing lands in
    // `preparing`), and the `.filter` below drops an empty section — so the
    // board reduces itself to Bills + Ready to bill without a branch here.
    return [
      { title: "Bills", data: billRows },
      { title: "Ready to bill", data: orderRows },
      { title: "Preparing…", data: preparingRows },
      { title: "Never sent to kitchen", data: unsentRows },
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
        gstEnabled,
        config.kotEnabled
      );
      feel.success(); // the bill exists; the settle sheet opens on top
      setSelectedBillId(billId);
    } catch (e) {
      feel.error();
      Alert.alert("Could not bill", e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingId(null);
    }
  }

  /**
   * Throw away an order the kitchen never saw.
   *
   * Behind a confirm because it is the one button on this screen that destroys
   * something, and what it destroys is named in the question. The AGE is in
   * there for a reason: a waiter halfway through building a table's order also
   * appears in this section for a few minutes, and "just now" is what stops a
   * cashier throwing away an order somebody is still taking.
   */
  function handleDiscard(order: Order & { id: string }) {
    // One confirm at a time. Guarding on `discardingId` alone wouldn't do it:
    // that is only set once a confirm is ANSWERED, so two cards could each put
    // a dialog up and the second answer would overwrite the first's spinner.
    if (discardingId || confirmingId) return;
    const lineCount = order.items.filter((i) => !i.voided).length;
    const createdMs = order.createdAt?.toMillis() ?? null;
    const age = createdMs === null ? "" : ` · started ${timeAgo(createdMs, Date.now())}`;
    // An order whose ticketed lines were all voided is discardable for the
    // same reason — nothing is on the pass — but it is not the same story, and
    // telling the cashier no food was involved would be a lie about a dish
    // somebody cooked.
    const wasCooked = wasEverSentToKitchen(order);
    setConfirmingId(order.id);
    feel.warn(); // a destructive confirm is on screen
    Alert.alert(
      "Discard this order?",
      `${orderLabel(order)} · ${lineCount} item${lineCount === 1 ? "" : "s"} · ${formatMoney(order.subtotal)}${age}\n\n` +
        (wasCooked
          ? "Every item that reached the kitchen has been voided, so nothing is on the pass and no money is involved. The order is cancelled and leaves this list."
          : "Nothing was ever sent to the kitchen, so no food and no money are involved. The order is cancelled and leaves this list."),
      [
        {
          text: "Keep",
          style: "cancel",
          onPress: () => {
            setConfirmingId(null);
            feel.dismiss();
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: async () => {
            setConfirmingId(null);
            setDiscardingId(order.id);
            try {
              await discardOrder(order.id);
              feel.heavy(); // the destructive thing actually happened
            } catch (e) {
              feel.error();
              Alert.alert(
                "Could not discard",
                e instanceof Error ? e.message : String(e)
              );
            } finally {
              setDiscardingId(null);
            }
          },
        },
      ],
      // Android's back button dismisses the dialog without answering it.
      // Without this the screen would think a confirm was still up and refuse
      // every later Discard.
      { cancelable: true, onDismiss: () => setConfirmingId(null) }
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <BrandHeader />
      {/* Header — cashier identity */}
      <ScreenHeader
        title="Bills"
        // The cashier's own name and role, which is all the left-hand avatar
        // used to add — and the profile button now carries the initial as a
        // control rather than as decoration.
        subtitle={`${cashierName}${roleLabel ? ` · ${roleLabel}` : ""}`}
        right={<ProfileButton />}
      />

      {/* Two snapshots have to land before there is a ledger to show, so the
          first paint is bones rather than the empty-state line — which used
          to say "Loading bills…" and read as "you have no bills". */}
      {loading && sections.length === 0 ? (
        <BillsSkeleton wide={isTablet} bottomInset={insets.bottom} />
      ) : (
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
            // Bills are a chronological ledger, so they stay one column and
            // get a reading width instead: a card stretched across a tablet
            // puts the table label and the amount too far apart to pair by
            // eye.
            isTablet && styles.listReadingWidth,
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
            ) : item.kind === "preparing" ? (
              <PreparingCard
                order={item.order}
                label={orderLabel(item.order)}
                now={now}
              />
            ) : (
              <UnsentCard
                order={item.order}
                label={orderLabel(item.order)}
                now={now}
                busy={discardingId === item.order.id}
                onDiscard={() => handleDiscard(item.order)}
              />
            )
          }
          // An empty till is normal, so the tone is calm and there is no
          // button — except for an owner who has not taken their first order,
          // for whom this screen is a dead end rather than a quiet moment.
          ListEmptyComponent={
            <EmptyState
              icon="cash-register"
              tone={preFirstBill ? "invite" : "calm"}
              title={
                preFirstBill
                  ? "Your bills will appear here"
                  : "Nothing waiting to be settled"
              }
              body={
                preFirstBill
                  ? "Take an order and it shows up here ready to bill, take payment and print."
                  : "When an order is ready to pay, its table appears here."
              }
              action={
                preFirstBill
                  ? {
                      label: "Take an order",
                      onPress: () => router.push(orderEntryPath as never),
                    }
                  : undefined
              }
            />
          }
        />
      )}

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

/**
 * Two sections of grey bill cards.
 *
 * This one earns its keep more than most: the cashier opens Bills first thing
 * and it is the tab that waits on two snapshots at once (`useActiveBills` and
 * `useBillableOrders`), so the old "Loading bills…" line was the app's longest
 * blank moment. The card shape below is `styles.card` itself, so nothing
 * shifts when the ledger arrives.
 */
function BillsSkeleton({
  wide,
  bottomInset,
}: {
  wide: boolean;
  bottomInset: number;
}) {
  return (
    <Skeleton
      style={[
        styles.list,
        styles.skeletonWrap,
        wide && styles.listReadingWidth,
        { paddingBottom: bottomInset + space.s6 },
      ]}
    >
      {[3, 2].map((count, section) => (
        <View key={section}>
          <Bone width={96} height={11} style={styles.skeletonSectionHeader} />
          {Array.from({ length: count }, (_, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardTop}>
                <Bone width={64} height={17} />
                <Bone width={78} height={18} round={radius.pill} />
              </View>
              <View style={styles.cardBottom}>
                <Bone width={92} height={18} />
                <Bone width={54} height={12} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
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
    case "void":
      return { label: "Cancelled", bg: colors.statusRedSoft, fg: colors.danger };
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
      onPressIn={feel.press} // the bill sheet is about to open
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
      onPressIn={feel.press}
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

/**
 * An order the kitchen was never given: someone started it and walked away.
 *
 * Not dimmed like `PreparingCard`, because this one is the cashier's to act on
 * — dimming it would say "wait", and waiting is exactly what these did for
 * days. The amount is stated in muted type instead: it is a running tally on
 * an order nobody committed, not money the restaurant is owed.
 */
function UnsentCard({
  order,
  label,
  now,
  busy,
  onDiscard,
}: {
  order: Order & { id: string };
  label: string;
  now: number;
  busy: boolean;
  onDiscard: () => void;
}) {
  const createdMs = order.createdAt?.toMillis() ?? null;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitleText}>{label}</Text>
        <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.pillText, { color: colors.textMuted }]}>
            Not sent
          </Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTotalMuted}>{formatMoney(order.subtotal)}</Text>
        <View style={styles.unsentActions}>
          {createdMs !== null && (
            <Text style={styles.cardTime}>{timeAgo(createdMs, now)}</Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.discardBtn,
              pressed && styles.cardPressed,
            ]}
            onPress={onDiscard}
            disabled={busy}
            hitSlop={space.s2}
            accessibilityRole="button"
            accessibilityLabel={`Discard ${label} order`}
          >
            {busy ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={styles.discardBtnText}>Discard</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  list: { paddingHorizontal: space.s4 },
  listReadingWidth: { width: "100%", maxWidth: 760, alignSelf: "center" },
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

  // ── Loading placeholder ─────────────────────────────────────────────────
  // Sits where the SectionList's own content would; `card`, `cardTop` and
  // `cardBottom` below are shared with the real rows.
  skeletonWrap: { flex: 1, overflow: "hidden" },
  skeletonSectionHeader: {
    marginTop: space.s4,
    marginBottom: space.s2 + 4,
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

  // Muted, and paired with the timestamp + Discard on the other side, so the
  // row reads as "this is going nowhere" rather than as takings.
  cardTotalMuted: { fontSize: 18, fontWeight: "700", color: colors.textMuted },
  unsentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
  },
  // Outlined, not filled: the filled pill on this screen means "Bill →", the
  // action the cashier is here for. A destructive one must never wear it.
  discardBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    minWidth: 78,
    alignItems: "center",
  },
  discardBtnText: { fontSize: 13, fontWeight: "700", color: colors.danger },

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
