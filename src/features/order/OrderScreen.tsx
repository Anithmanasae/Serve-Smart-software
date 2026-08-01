/**
 * Waiter New Order + KOT screen (React Native).
 *
 * A port of the web "New Order" flow: the data/API layer is reused verbatim —
 * this file only builds the UI. All reads come from the ported live hooks
 * (`useOrderData`) and every write goes through the ported `orderApi` helpers
 * (never Firestore directly).
 *
 * Flow:
 *   - Dine-in (`tableId` set): resolves the table's open order live and appends
 *     to it; the first add creates the order + occupies the table (in orderApi).
 *   - Takeaway (`tableId` absent): the first add creates a fresh order whose id
 *     we remember for subsequent reads/writes.
 *   - Adding fires `pending` lines; "Send KOT" batches them into a new ticket
 *     and flips them to `sent`. Adding more later + Send KOT again = a 2nd
 *     ticket with only the new lines. KDS progress mirrors back onto each line's
 *     `kotStatus` via `syncLineStatuses`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { formatMoney } from "@/lib/money";
import {
  animateNextLayout,
  mediumTapFeedback,
  successFeedback,
  tapFeedback,
} from "@/lib/feedback";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { useRestaurantProfile } from "@/features/settings/useRestaurantProfile";
import { generateBill } from "@/features/cashier/cashierApi";
import { BillDetail } from "@/features/cashier/BillDetail";
import { reprintKot } from "@/features/kitchen/kdsApi";
import { encodeKot } from "@/lib/printer/escpos";
import {
  getPaperWidth,
  isPrintingAvailable,
  printToSavedPrinter,
} from "@/lib/printer/printerService";
import type { KotStatus, KotItemStatus, MenuItem, OrderItem } from "@/types/models";
import {
  createOrderLocal,
  fetchKot,
  flushPendingWrites,
  mergeItemIntoLines,
  sendKot,
  setLineNotesInLines,
  setLineQtyInLines,
  syncLineStatuses,
  writeOrderItems,
} from "./orderApi";
import {
  useKotsForOrder,
  useMenuCategories,
  useMenuItems,
  useOpenOrderForTable,
  useOrder,
  useTable,
} from "./useOrderData";
import { OrderMenuCard } from "./OrderMenuCard";
import { OrderLineRow } from "./OrderLineRow";
import { KotAlertBanner, useKotStatusAlerts } from "./kotAlerts";

const ALL = "__all__";
const SPACER = "__spacer__";

type MenuItemDoc = MenuItem & { id: string };
type GridEntry = MenuItemDoc | { id: typeof SPACER };

/** Map a kitchen ticket status onto the matching per-line lifecycle status. */
function kotToLineStatus(status: KotStatus): KotItemStatus {
  switch (status) {
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "completed":
      return "served";
    default:
      return "sent";
  }
}

export function OrderScreen({ tableId }: { tableId?: string }) {
  const insets = useSafeAreaInsets();
  const { profile, role } = useAuth();
  const { gstEnabled } = useSettings();
  const { data: restaurant } = useRestaurantProfile();
  const waiterId = profile?.uid ?? "";

  const isDineIn = !!tableId;
  const orderType = isDineIn ? "dine-in" : "takeaway";

  // Counter flow: billing staff taking a takeaway order can generate + settle
  // the bill right here (pay-first), instead of hopping to the Bills tab.
  const canBillHere = !isDineIn && (role === "cashier" || role === "admin");

  // ── Live data ───────────────────────────────────────────────────────────
  const categoriesState = useMenuCategories();
  const itemsState = useMenuItems();
  const tableState = useTable(tableId ?? null);
  const openOrderState = useOpenOrderForTable(tableId ?? null);

  // Takeaway orders have no table pointer, so we remember the id the first add
  // mints and subscribe to it directly.
  const [takeawayOrderId, setTakeawayOrderId] = useState<string | null>(null);
  const takeawayOrderState = useOrder(isDineIn ? null : takeawayOrderId);

  const order = isDineIn ? openOrderState.order : takeawayOrderState.data;
  const orderId = order?.id ?? null;

  const tableLabel = isDineIn
    ? tableState.data?.label ??
      (tableState.data ? `T${tableState.data.number}` : tableId ?? "Table")
    : "Takeaway";

  // Mirror KDS progress back onto the order lines. syncLineStatuses no-ops when
  // nothing changed, so this settles instead of looping.
  const kotsState = useKotsForOrder(orderId);
  useEffect(() => {
    if (!orderId || kotsState.data.length === 0) return;
    const map = new Map<string, KotItemStatus>();
    for (const k of kotsState.data) map.set(k.id, kotToLineStatus(k.status));
    syncLineStatuses(orderId, map).catch(() => {});
  }, [orderId, kotsState.data]);

  // Kitchen progress toast — every kot here already belongs to this order.
  const kotAlert = useKotStatusAlerts(kotsState.data);

  // ── UI state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billId, setBillId] = useState<string | null>(null);

  // A billed order is locked: adding/editing lines would desync the bill.
  const orderLocked = !!order?.billId;

  // Once a takeaway bill is settled the order closes — reset to a clean slate
  // so the next customer starts a fresh order.
  useEffect(() => {
    if (isDineIn || billId !== null) return;
    if (takeawayOrderState.data?.status === "closed") {
      mirrorRef.current = null;
      setTakeawayOrderId(null);
      setSheetOpen(false);
    }
  }, [isDineIn, billId, takeawayOrderState.data?.status]);

  const enabledCategories = useMemo(
    () => categoriesState.data.filter((c) => c.enabled),
    [categoriesState.data]
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return itemsState.data.filter((it) => {
      if (!it.enabled) return false;
      if (activeCategory !== ALL && it.categoryId !== activeCategory) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.sku ? it.sku.toLowerCase().includes(q) : false)
      );
    });
  }, [itemsState.data, activeCategory, search]);

  // Pad to an even count so a lone trailing card doesn't stretch full-width.
  const gridData: GridEntry[] = useMemo(
    () =>
      filteredItems.length % 2 === 1
        ? [...filteredItems, { id: SPACER }]
        : filteredItems,
    [filteredItems]
  );

  const lines: OrderItem[] = order?.items?.filter((l) => !l.voided) ?? [];

  // menuItemId -> the editable (pending, note-less) line, for the card stepper.
  const pendingByItem = useMemo(() => {
    const map = new Map<string, OrderItem>();
    for (const l of lines) {
      if (l.kotStatus === "pending" && !l.voided && !l.notes) {
        map.set(l.menuItemId, l);
      }
    }
    return map;
  }, [lines]);

  const pendingCount = useMemo(
    () => lines.filter((l) => l.kotStatus === "pending").length,
    [lines]
  );
  const itemCount = useMemo(
    () => lines.reduce((n, l) => n + l.qty, 0),
    [lines]
  );
  const subtotal = order?.subtotal ?? 0;

  // ── Writes (all via orderApi) ─────────────────────────────────────────────
  // Local mirror of the order being edited. Plain writes echo into the local
  // cache instantly, and the mirror lets back-to-back taps compute from the
  // latest local state instead of waiting for the next snapshot. The live
  // snapshot is re-adopted whenever no local writes are in flight.
  const mirrorRef = useRef<{ orderId: string; items: OrderItem[] } | null>(
    null
  );
  const inflightRef = useRef(0);

  useEffect(() => {
    if (inflightRef.current > 0) return; // trust local edits still in flight
    mirrorRef.current = order ? { orderId: order.id, items: order.items } : null;
  }, [order]);

  const track = (write: Promise<unknown>, what: string) => {
    inflightRef.current += 1;
    write
      .catch((e) =>
        Alert.alert(what, e instanceof Error ? e.message : String(e))
      )
      .finally(() => {
        inflightRef.current -= 1;
      });
  };

  const handleAdd = (item: MenuItemDoc) => {
    if (!waiterId || busy || orderLocked) return;
    tapFeedback();
    animateNextLayout(); // a new line may enter the order sheet/cart bar
    const mirror = mirrorRef.current;
    if (mirror) {
      const items = mergeItemIntoLines(
        mirror.items,
        item.id,
        item.name,
        item.price
      );
      mirrorRef.current = { ...mirror, items };
      track(writeOrderItems(mirror.orderId, items), "Couldn’t add item");
    } else {
      // First add: mint the order (and occupy the table) in one local batch.
      const created = createOrderLocal({
        tableId: tableId ?? null,
        orderType,
        waiterId,
        menuItemId: item.id,
        name: item.name,
        price: item.price,
      });
      mirrorRef.current = { orderId: created.orderId, items: created.items };
      if (!isDineIn) setTakeawayOrderId(created.orderId);
      track(created.commit, "Couldn’t add item");
    }
  };

  const handleQty = (lineId: string, qty: number) => {
    const mirror = mirrorRef.current;
    if (!mirror || busy || orderLocked) return;
    tapFeedback(); // light impact on every +/- press
    if (qty <= 0) animateNextLayout(); // the row is about to leave the list
    const items = setLineQtyInLines(mirror.items, lineId, qty);
    mirrorRef.current = { ...mirror, items };
    track(writeOrderItems(mirror.orderId, items), "Couldn’t update quantity");
  };

  const handleNotes = (lineId: string, notes: string) => {
    const mirror = mirrorRef.current;
    if (!mirror || busy || orderLocked) return;
    const items = setLineNotesInLines(mirror.items, lineId, notes);
    mirrorRef.current = { ...mirror, items };
    track(writeOrderItems(mirror.orderId, items), "Couldn’t save note");
  };

  const handleSendKot = async () => {
    if (!orderId || pendingCount === 0 || busy) return;
    successFeedback(); // success notification on fire
    setBusy(true);
    try {
      // The KOT transaction reads the order from the SERVER — make sure every
      // local (latency-compensated) edit has landed there first.
      await flushPendingWrites();
      const kotId = await sendKot(orderId, tableLabel);
      // Fire-and-forget: the KOT is already committed, a printer problem must
      // never block or undo the send (the on-screen KDS still has the ticket).
      if (kotId) void autoPrintKot(kotId);
    } catch (e) {
      // Lines stay pending on failure — tell the waiter so they can retry.
      Alert.alert(
        "Couldn’t send KOT",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Thermal KOT for the kitchen counter, printed right after the ticket is
   * committed. In Expo Go the Bluetooth module doesn't exist — skip silently,
   * the KDS screen is the fallback (same pattern as bill printing).
   */
  const autoPrintKot = async (kotId: string) => {
    if (!isPrintingAvailable()) return;
    try {
      const kot = await fetchKot(kotId);
      if (!kot) return;
      const paperWidth = await getPaperWidth();
      const ticket = encodeKot({
        profile: restaurant ?? { name: "SADA POS" },
        kot,
        paperWidth,
      });
      await printToSavedPrinter(ticket.bytes);
      await reprintKot(kot); // bytes accepted → count the print
    } catch (e) {
      Alert.alert(
        "KOT saved but couldn’t print",
        (e instanceof Error ? e.message : String(e)) +
          "\n\nThe kitchen display still shows the ticket. Check Account > Printer Settings."
      );
    }
  };

  // Counter billing (takeaway, cashier/admin): all lines must be sent first,
  // then `generateBill` creates the bill (idempotent — reopens the existing
  // one if it was already generated) and the settle sheet takes payment.
  const handleGenerateBill = async () => {
    if (!order || busy || pendingCount > 0) return;
    mediumTapFeedback();
    setBusy(true);
    try {
      await flushPendingWrites();
      const id = await generateBill(order, waiterId, tableLabel, gstEnabled);
      setBillId(id);
    } catch (e) {
      Alert.alert(
        "Couldn’t generate bill",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = categoriesState.loading || itemsState.loading;
  const errorState =
    categoriesState.error || itemsState.error || openOrderState.error;

  const renderCard = ({ item }: { item: GridEntry }) => {
    if (item.id === SPACER) return <View style={styles.gridCell} />;
    const menuItem = item as MenuItemDoc;
    const pending = pendingByItem.get(menuItem.id);
    return (
      <View style={styles.gridCell}>
        <OrderMenuCard
          item={menuItem}
          qty={pending?.qty ?? 0}
          disabled={!waiterId}
          onAdd={() => handleAdd(menuItem)}
          onDecrement={() =>
            pending && handleQty(pending.lineId, pending.qty - 1)
          }
        />
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* App header */}
      <View style={styles.appBar}>
        <Text style={styles.brand}>SADA POS</Text>
        <Text style={styles.bell}>🔔</Text>
      </View>

      {/* Title */}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>New Order</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Feather name="search" size={17} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search menu items, SKUs, or ingredients…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      </View>

      {/* Category chips */}
      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Chip
            label="All Items"
            active={activeCategory === ALL}
            onPress={() => setActiveCategory(ALL)}
          />
          {enabledCategories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={activeCategory === c.id}
              onPress={() => setActiveCategory(c.id)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Menu grid */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : errorState ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn’t load the menu.</Text>
          <Text style={styles.emptySub}>{errorState.message}</Text>
        </View>
      ) : (
        <FlatList
          data={gridData}
          keyExtractor={(it) => it.id}
          renderItem={renderCard}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[
            styles.gridContent,
            { paddingBottom: insets.bottom + (lines.length > 0 ? 96 : space.s6) },
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No items found.</Text>
            </View>
          }
        />
      )}

      {/* Collapsed cart bar */}
      {lines.length > 0 && !sheetOpen ? (
        <Pressable
          style={({ pressed }) => [
            styles.cartBar,
            { bottom: insets.bottom + space.s5 },
            pressed && styles.cartBarPressed,
          ]}
          onPress={() => {
            mediumTapFeedback(); // weighty tap when the sheet comes up
            setSheetOpen(true);
          }}
        >
          <Text style={styles.cartBarText}>
            🛍 View Order · {itemCount} Item{itemCount === 1 ? "" : "s"}
          </Text>
          <Text style={styles.cartBarText}>{formatMoney(subtotal)}</Text>
        </Pressable>
      ) : null}

      {/* Current Order sheet */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          {/* The modal covers the screen banner, so mirror it here too. */}
          <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
          <Pressable
            style={styles.backdropFill}
            onPress={() => setSheetOpen(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s3 }]}>
            {/* Swipe affordance */}
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Current Order</Text>
              <Pressable
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}
                onPress={() => setSheetOpen(false)}
              >
                <Text style={styles.addItemsLink}>＋ Add Items</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {lines.length === 0 ? (
                <Text style={styles.emptySub}>No items yet.</Text>
              ) : (
                lines.map((line) => (
                  <OrderLineRow
                    key={line.lineId}
                    line={line}
                    onQty={(qty) => handleQty(line.lineId, qty)}
                    onNotes={(notes) => handleNotes(line.lineId, notes)}
                  />
                ))
              )}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatMoney(subtotal)}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  (pendingCount === 0 || busy) && styles.sendBtnDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={handleSendKot}
                disabled={pendingCount === 0 || busy}
              >
                <Text style={styles.sendBtnText}>
                  ➤ Send KOT{pendingCount > 0 ? ` (${pendingCount})` : ""}
                </Text>
              </Pressable>
              {canBillHere && lines.length > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.billBtn,
                    (pendingCount > 0 || busy) && styles.sendBtnDisabled,
                    pressed && styles.pressed,
                  ]}
                  onPress={handleGenerateBill}
                  disabled={pendingCount > 0 || busy}
                >
                  <Text style={styles.sendBtnText}>
                    {orderLocked
                      ? "View Bill"
                      : pendingCount > 0
                        ? "Send KOT before billing"
                        : `Generate Bill · ${formatMoney(subtotal)}`}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Counter billing: settle the takeaway bill without leaving the screen */}
      <Modal
        visible={billId !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setBillId(null)}
      >
        {billId && (
          <View style={{ flex: 1, paddingTop: insets.top }}>
            <BillDetail billId={billId} onClose={() => setBillId(null)} />
          </View>
        )}
      </Modal>

      {/* Live kitchen status toast ("T1 — Order READY") */}
      <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pressed: {
    opacity: 0.7,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  brand: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  bell: {
    fontSize: 18,
  },
  titleBlock: {
    paddingHorizontal: space.s4,
    paddingBottom: space.s3,
    gap: space.s1,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    marginHorizontal: space.s4,
    marginBottom: space.s2,
    paddingHorizontal: space.s4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    paddingVertical: space.s3,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  chipsWrap: {
    paddingBottom: space.s2,
  },
  chipsRow: {
    paddingHorizontal: space.s4,
    gap: space.s2,
  },
  chip: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.textInverse,
  },
  gridContent: {
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
  },
  gridRow: {
    gap: space.s3,
    marginBottom: space.s3,
  },
  gridCell: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.s6,
    gap: space.s2,
  },
  emptyText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.text,
  },
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  errorText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.danger,
  },
  cartBar: {
    position: "absolute",
    left: space.s4,
    right: space.s4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingHorizontal: space.s5,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    ...shadow.glow,
  },
  cartBarPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  cartBarText: {
    color: colors.textInverse,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  backdropFill: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    maxHeight: "80%",
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.s3,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s2,
  },
  sheetTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.text,
  },
  addItemsLink: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetFooter: {
    paddingTop: space.s3,
    gap: space.s3,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s1,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.glow,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  billBtn: {
    backgroundColor: colors.primaryDark,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: {
    color: colors.textInverse,
    fontFamily: fonts.extrabold,
    fontSize: 16,
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
});
