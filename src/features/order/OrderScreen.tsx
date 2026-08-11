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
import { router } from "expo-router";
import { formatMoney } from "@/lib/money";
import { isOfferLive } from "@/lib/offers";
import { gridColumns, useResponsive } from "@/lib/responsive";
import { useOffers } from "@/features/offers/useOffersData";
import { animateNextLayout, feel } from "@/lib/feedback";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { BrandMark } from "@/components/BrandLogo";
import { Bone, Skeleton } from "@/components/Skeleton";
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
import { OrderCartPanel } from "./OrderCartPanel";
import { ALL_CATEGORIES, OrderCategoryRail } from "./OrderCategoryRail";
import { KotAlertBanner, useKotStatusAlerts } from "./kotAlerts";

const ALL = ALL_CATEGORIES;
const SPACER = "__spacer__";

type MenuItemDoc = MenuItem & { id: string };
type GridEntry = MenuItemDoc | { id: string };

/**
 * Widths of the two fixed rails in the tablet layout, from the window width.
 *
 * Both scale rather than switch, so portrait and landscape are the same
 * three-pane layout breathing instead of two designs to keep in step. The
 * centre grid gets whatever is left, and re-flows its columns to suit.
 */
function tabletPanes(width: number) {
  const rail = width >= 1100 ? 200 : width >= 900 ? 176 : 152;
  const cart =
    width >= 1280 ? 380 : width >= 1100 ? 344 : width >= 900 ? 312 : 288;
  return { rail, cart };
}

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
  // Re-reads on every rotation, so the three-pane layout re-measures itself
  // instead of keeping the widths it was born with.
  const { width, isTablet } = useResponsive();
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
  const offersState = useOffers();
  const tableState = useTable(tableId ?? null);
  const openOrderState = useOpenOrderForTable(tableId ?? null);

  // Live subscription, not a one-shot read: the owner switching a promo on
  // mid-service has to reach the floor without anyone reloading anything.
  const offers = offersState.data;

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

  // ── Layout ──────────────────────────────────────────────────────────────
  // Phone: one column of cards two-up under a chip row. Tablet: categories |
  // grid | order, with the grid re-flowing into whatever is left over.
  const panes = tabletPanes(width);
  const numColumns = isTablet
    ? gridColumns(width - panes.rail - panes.cart - space.s4 * 2)
    : 2;

  // Pad to a whole number of rows so a lone trailing card doesn't stretch to
  // fill the row it landed in.
  const gridData: GridEntry[] = useMemo(() => {
    const remainder = filteredItems.length % numColumns;
    if (remainder === 0) return filteredItems;
    const padded: GridEntry[] = [...filteredItems];
    for (let i = remainder; i < numColumns; i += 1) {
      padded.push({ id: `${SPACER}${i}` });
    }
    return padded;
  }, [filteredItems, numColumns]);

  // Enabled-item counts for the rail, so its numbers match what a tap shows.
  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of itemsState.data) {
      if (!it.enabled) continue;
      map.set(it.categoryId, (map.get(it.categoryId) ?? 0) + 1);
    }
    return map;
  }, [itemsState.data]);

  const enabledItemCount = useMemo(
    () => itemsState.data.reduce((n, it) => n + (it.enabled ? 1 : 0), 0),
    [itemsState.data]
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
  // `subtotal` is GROSS of offers by definition; what the customer owes before
  // tax is that minus the offer total. The cart bar shows the payable figure —
  // quoting the gross one would over-promise at the table.
  const subtotal = order?.subtotal ?? 0;
  const offerDiscount = order?.offerDiscount ?? 0;
  const payable = Math.max(0, subtotal - offerDiscount);

  // menuItemId -> the live offer covering it, for the grid badge. Built from
  // the ORDER's stamps where possible so the badge and the money always agree.
  const offerNameByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lines) {
      if (l.offerName && (l.offerDiscount ?? 0) > 0) {
        map.set(l.menuItemId, l.offerName);
      }
    }
    return map;
  }, [lines]);

  // Items covered by a live offer that isn't earning anything yet — a BOGO
  // waiting for its second coffee. Shown as a hint so the waiter can upsell it.
  const eligibleItems = useMemo(() => {
    const now = new Date();
    const live = offers.filter((o) => isOfferLive(o, now));
    if (live.length === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const it of itemsState.data) {
      const covered = live.some((o) => {
        const byItem = o.itemIds ?? [];
        const byCat = o.categoryIds ?? [];
        if (byItem.length === 0 && byCat.length === 0) return true;
        return byItem.includes(it.id) || byCat.includes(it.categoryId);
      });
      if (covered) ids.add(it.id);
    }
    return ids;
  }, [offers, itemsState.data]);

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

  // The offer rules AND the moment they are judged against. Pinned to the
  // order's own createdAt so a tab keeps the deal it opened under — see
  // PricingContext. A brand-new order's serverTimestamp is still unresolved
  // locally, so "now" stands in until the server's value arrives; they are the
  // same instant to within the round trip.
  const pricing = useMemo(
    () => ({ offers, at: order?.createdAt?.toDate() ?? new Date() }),
    [offers, order?.createdAt]
  );

  const track = (write: Promise<unknown>, what: string) => {
    inflightRef.current += 1;
    write
      .catch((e) => {
        // The tap already said "done" optimistically — take it back in the
        // hand as well as on screen, or the waiter trusts a write that failed.
        feel.error();
        Alert.alert(what, e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        inflightRef.current -= 1;
      });
  };

  const handleAdd = (item: MenuItemDoc) => {
    // A locked order is a refusal, not a no-op: the card's tap already fired,
    // so answer it rather than leaving the press feeling swallowed. `busy` is
    // transient and stays silent.
    if (orderLocked) return feel.error();
    if (!waiterId || busy) return;
    animateNextLayout(); // a new line may enter the order sheet/cart bar
    const mirror = mirrorRef.current;
    if (mirror) {
      const items = mergeItemIntoLines(
        mirror.items,
        item.id,
        item.name,
        item.price,
        pricing,
        item.categoryId
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
        categoryId: item.categoryId,
        offers,
      });
      mirrorRef.current = { orderId: created.orderId, items: created.items };
      if (!isDineIn) setTakeawayOrderId(created.orderId);
      track(created.commit, "Couldn’t add item");
    }
  };

  const handleQty = (lineId: string, qty: number) => {
    const mirror = mirrorRef.current;
    if (orderLocked) return feel.error();
    if (!mirror || busy) return;
    // The stepper plays its own feel on touch-down — including the softer one
    // for the press that empties the line — so nothing is played here.
    if (qty <= 0) animateNextLayout(); // the row is about to leave the list
    const items = setLineQtyInLines(mirror.items, lineId, qty, pricing);
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
    // Felt in two beats: the button's own weighty press on touch-down, then
    // the confirm below once the kitchen actually has the ticket. Playing
    // success up front (as this used to) celebrates writes that then fail.
    setBusy(true);
    try {
      // The KOT transaction reads the order from the SERVER — make sure every
      // local (latency-compensated) edit has landed there first.
      await flushPendingWrites();
      const kotId = await sendKot(orderId, tableLabel);
      feel.success(); // the kitchen has it — this is the beat that means it
      // Fire-and-forget: the KOT is already committed, a printer problem must
      // never block or undo the send (the on-screen KDS still has the ticket).
      if (kotId) void autoPrintKot(kotId);
    } catch (e) {
      // Lines stay pending on failure — tell the waiter so they can retry.
      feel.error();
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
        profile: restaurant ?? { name: "Brew Brothers" },
        kot,
        paperWidth,
      });
      await printToSavedPrinter(ticket.bytes);
      await reprintKot(kot); // bytes accepted → count the print
    } catch (e) {
      // A warning, not an error: the ticket is committed and on the KDS. The
      // confirm for the send has already been felt; this qualifies it.
      feel.warn();
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
    setBusy(true);
    try {
      await flushPendingWrites();
      const id = await generateBill(order, waiterId, tableLabel, gstEnabled);
      feel.success(); // the bill exists — the settle sheet is about to open
      setBillId(id);
    } catch (e) {
      feel.error();
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
    if (item.id.startsWith(SPACER)) return <View style={styles.gridCell} />;
    const menuItem = item as MenuItemDoc;
    const pending = pendingByItem.get(menuItem.id);
    return (
      <View style={styles.gridCell}>
        <OrderMenuCard
          item={menuItem}
          qty={pending?.qty ?? 0}
          disabled={!waiterId}
          offerName={offerNameByItem.get(menuItem.id)}
          offerEligible={eligibleItems.has(menuItem.id)}
          onAdd={() => handleAdd(menuItem)}
          onDecrement={() =>
            pending && handleQty(pending.lineId, pending.qty - 1)
          }
        />
      </View>
    );
  };

  // ── Shared pieces ───────────────────────────────────────────────────────
  // Built once and placed by each layout, so the phone and the tablet can
  // never drift into showing a different search box, grid or cart.

  // A table's order is PUSHED onto the (app) stack; the takeaway order is a
  // tab. So this is the one layout of this screen with no tab bar underneath
  // it, and the only one that has to carry its own way out.
  const backButton = tableId ? (
    <Pressable
      style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
      onPress={() => router.back()}
      onPressIn={feel.dismiss}
      hitSlop={space.s3}
      accessibilityRole="button"
      accessibilityLabel="Back to tables"
    >
      <Feather name="chevron-left" size={24} color={colors.primary} />
    </Pressable>
  ) : null;

  const searchField = (
    <View style={[styles.searchWrap, isTablet && styles.searchWrapBar]}>
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
  );

  const menuGrid = (bottomPad: number) =>
    loading ? (
      <MenuGridSkeleton columns={numColumns} />
    ) : errorState ? (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn’t load the menu.</Text>
        <Text style={styles.emptySub}>{errorState.message}</Text>
      </View>
    ) : (
      <FlatList
        // RN cannot change `numColumns` on a live list — remounting on the
        // count is what lets the grid re-flow across a rotation.
        key={`grid-${numColumns}`}
        data={gridData}
        keyExtractor={(it) => it.id}
        renderItem={renderCard}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.gridContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No items found.</Text>
          </View>
        }
      />
    );

  const cartProps = {
    lines,
    itemCount,
    subtotal,
    offerDiscount,
    payable,
    pendingCount,
    busy,
    orderLocked,
    canBillHere,
    onQty: handleQty,
    onNotes: handleNotes,
    onSendKot: handleSendKot,
    onGenerateBill: handleGenerateBill,
  };

  // Every way out of the order sheet — the close button, the backdrop, the
  // hardware back key — lands here, so the sheet closes with one feel however
  // it was dismissed. Repeats inside a single gesture collapse in `feel`.
  const closeSheet = () => {
    feel.dismiss();
    setSheetOpen(false);
  };

  const closeBill = () => {
    feel.dismiss();
    setBillId(null);
  };

  /* Counter billing: settle the takeaway bill without leaving the screen */
  const billModal = (
    <Modal
      visible={billId !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={closeBill}
    >
      {billId && (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <BillDetail billId={billId} onClose={closeBill} />
        </View>
      )}
    </Modal>
  );

  // ── Tablet: categories | menu | order, all three always on screen ───────
  // Same layout in portrait and landscape — the rails and the grid's column
  // count absorb the difference, so a rotation never hides a pane or moves a
  // control to somewhere new.
  if (isTablet) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.tabletBar}>
          {backButton}
          <View style={styles.brandRow}>
            <BrandMark size={34} />
            <Text style={styles.brand}>Brew Brothers</Text>
          </View>
          <Text style={styles.tabletTitle}>New Order</Text>
          <View style={styles.tablePill}>
            <Text style={styles.tablePillText}>{tableLabel}</Text>
          </View>
          {searchField}
        </View>

        <View style={styles.tabletBody}>
          <View style={[styles.railPane, { width: panes.rail }]}>
            <OrderCategoryRail
              categories={enabledCategories}
              countByCategory={countByCategory}
              totalCount={enabledItemCount}
              activeId={activeCategory}
              onSelect={(id) => {
                // Moving through choices, not pressing a button — and a
                // re-tap of the current category says nothing, same as a chip.
                if (id !== activeCategory) feel.select();
                setActiveCategory(id);
              }}
            />
          </View>

          <View style={styles.centerPane}>{menuGrid(space.s6)}</View>

          <View style={[styles.cartPane, { width: panes.cart }]}>
            <OrderCartPanel
              variant="pane"
              tableLabel={tableLabel}
              {...cartProps}
            />
          </View>
        </View>

        {billModal}

        {/* Live kitchen status toast ("T1 — Order READY") */}
        <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
      </View>
    );
  }

  // ── Phone: chips + grid, with the order in a bottom sheet ───────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* App header */}
      <View style={styles.appBar}>
        <View style={styles.brandRow}>
          {backButton}
          <BrandMark size={32} />
          <Text style={styles.brand}>Brew Brothers</Text>
        </View>
        <Text style={styles.bell}>🔔</Text>
      </View>

      {/* Title */}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>New Order</Text>
      </View>

      {/* Search */}
      {searchField}

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
      {menuGrid(insets.bottom + (lines.length > 0 ? 96 : space.s6))}

      {/* Collapsed cart bar */}
      {lines.length > 0 && !sheetOpen ? (
        <Pressable
          style={({ pressed }) => [
            styles.cartBar,
            { bottom: insets.bottom + space.s5 },
            pressed && styles.cartBarPressed,
          ]}
          onPress={() => {
            feel.press(); // something is opening
            setSheetOpen(true);
          }}
        >
          <Text style={styles.cartBarText}>
            🛍 View Order · {itemCount} Item{itemCount === 1 ? "" : "s"}
          </Text>
          <View style={styles.cartBarPrice}>
            {offerDiscount > 0 ? (
              <Text style={styles.cartBarStruck}>{formatMoney(subtotal)}</Text>
            ) : null}
            <Text style={styles.cartBarText}>{formatMoney(payable)}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Current Order sheet */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetBackdrop}>
          {/* The modal covers the screen banner, so mirror it here too. */}
          <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
          <Pressable
            style={styles.backdropFill}
            onPress={closeSheet}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s3 }]}>
            {/* Swipe affordance */}
            <View style={styles.dragHandle} />

            <OrderCartPanel
              variant="sheet"
              {...cartProps}
              onClose={closeSheet}
            />
          </View>
        </View>
      </Modal>

      {billModal}

      {/* Live kitchen status toast ("T1 — Order READY") */}
      <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
    </View>
  );
}

/**
 * The menu grid one beat before it arrives: same column count, same square
 * photo, same two lines beneath it — so the real cards land where the grey
 * ones stood instead of pushing the layout around.
 *
 * Four rows is more than a phone can show; the extra is clipped rather than
 * measured, which keeps this free of a layout pass on the frame where the
 * screen is already busy mounting.
 */
function MenuGridSkeleton({ columns }: { columns: number }) {
  return (
    <Skeleton style={styles.skeletonWrap}>
      {Array.from({ length: 4 }, (_, row) => (
        <View key={row} style={styles.gridRow}>
          {Array.from({ length: columns }, (_, col) => (
            <View key={col} style={styles.gridCell}>
              <View style={styles.skeletonCard}>
                <Bone
                  width="100%"
                  height="auto"
                  round={0}
                  style={styles.skeletonPhoto}
                />
                <View style={styles.skeletonBody}>
                  <Bone width="80%" height={13} />
                  <Bone width="45%" height={13} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
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
      onPress={() => {
        // A filter tick, not a button press: the same feel the tablet rail
        // uses, so scanning categories feels identical on both layouts.
        // Re-tapping the active chip changes nothing, so it says nothing.
        if (!active) feel.select();
        onPress();
      }}
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
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  // Pulled back by its own padding so the chevron optically lines up with the
  // bar's edge while still presenting a full-size target.
  backBtn: { padding: space.s1, marginLeft: -space.s2 },
  brand: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    // Near-black rather than navy — see the note in KitchenDisplayScreen.
    color: colors.text,
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
  // On a tablet the field lives inside the top bar rather than on its own
  // row: no outer margins, and it takes the slack left by the brand + title.
  searchWrapBar: {
    flex: 1,
    maxWidth: 460,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  searchInput: {
    flex: 1,
    paddingVertical: space.s3,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },

  // ── Tablet three-pane frame ─────────────────────────────────────────────
  tabletBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  tabletTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    color: colors.text,
    letterSpacing: -0.3,
  },
  tablePill: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  tablePillText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  tabletBody: {
    flex: 1,
    flexDirection: "row",
  },
  railPane: {
    paddingTop: space.s2,
  },
  centerPane: {
    flex: 1,
  },
  cartPane: {
    paddingLeft: space.s3,
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
    // Bumped from 13: the category name is what the waiter aims at, and it
    // was the smallest type on the screen while being one of the most-hit
    // targets. The chip grows with it — the padding is unchanged.
    fontSize: 16,
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

  // ── Loading placeholder ─────────────────────────────────────────────────
  // Mirrors `gridContent` + `gridRow` + `OrderMenuCard`'s own surface, so the
  // swap to real cards moves nothing.
  skeletonWrap: {
    flex: 1,
    overflow: "hidden",
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
  },
  skeletonCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadow.float,
  },
  skeletonPhoto: {
    aspectRatio: 1,
  },
  skeletonBody: {
    padding: space.s3,
    gap: space.s2,
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
  cartBarPrice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
  },
  cartBarStruck: {
    color: colors.textInverse,
    opacity: 0.65,
    fontFamily: fonts.medium,
    fontSize: 13,
    textDecorationLine: "line-through",
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
});
