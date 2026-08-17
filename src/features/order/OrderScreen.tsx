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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { formatMoney } from "@/lib/money";
import { isOfferLive } from "@/lib/offers";
import { gridColumns, useResponsive } from "@/lib/responsive";
import { useOffers } from "@/features/offers/useOffersData";
import { animateNextLayout, feel } from "@/lib/feedback";
import { colors, fonts, radius, shadow, space, typography } from "@/theme/theme";
import { BrandMark } from "@/components/BrandLogo";
import { BrandHeader } from "@/components/BrandHeader";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenEnter } from "@/components/ScreenEnter";
import { ProfileButton } from "@/components/ProfileButton";
import { Bone, Skeleton } from "@/components/Skeleton";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { basePrice, hasVariants } from "@/features/menu/variants";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { useRestaurantProfile } from "@/features/settings/useRestaurantProfile";
import { reoccupyTable } from "@/features/tables/tablesApi";
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
  addLineToLines,
  createOrderLocal,
  fetchKot,
  flushPendingWrites,
  sendKot,
  setLineNotesInLines,
  setLineQtyInLines,
  syncLineStatuses,
  writeOrderItems,
  type AddLineSpec,
  type LineVariant,
} from "./orderApi";
import {
  useKotsForOrder,
  useMenuCategories,
  useMenuItems,
  useOpenOrderForTable,
  useOrder,
  useResumableTakeawayOrder,
  useTable,
} from "./useOrderData";
import { OrderMenuCard } from "./OrderMenuCard";
import { OrderCartPanel } from "./OrderCartPanel";
import { ALL_CATEGORIES, OrderCategoryRail } from "./OrderCategoryRail";
import { CustomizeDishSheet, type CustomizeResult } from "./CustomizeDishSheet";
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

/**
 * The phone's category rail width.
 *
 * Narrow enough that the grid still holds two cards on a 360dp phone, wide
 * enough for a real category name before it wraps. Scaled rather than fixed so
 * a 320dp phone gives up rail rather than card — a card that narrow stops
 * showing its price and its ＋ Add on one line, and a wrapped category label
 * costs nothing by comparison.
 */
function phoneRailWidth(width: number): number {
  return width >= 400 ? 116 : width >= 360 ? 104 : 96;
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
  const { width, isTablet, isLandscape } = useResponsive();
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

  // A live order on a table that reads "Free" is the floor lying about itself.
  // Only `createOrderLocal` sets "occupied", and it only runs when a table has
  // no open order — so a table left in that state can never right itself, and
  // every visit quietly appends to the stranded order. Repair it on sight.
  //
  // Fires at most once per mount per table: the write clears the condition, and
  // the ref covers the frames before the snapshot comes back.
  //
  // `order.tableId === tableId` is the load-bearing line. Moving from one table
  // to another changes `tableId` a frame or more before the order subscription
  // catches up, so without it this stamps the PREVIOUS table's order onto the
  // new one and two tables end up claiming a single order — which is a worse
  // floor than the stale "Free" it was written to repair. Verified in the wild:
  // T3 and T5 both took UDPAOQzUHTW2WzbFjPzc before this check existed.
  const repairedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tableId || !orderId) return;
    const table = tableState.data;
    if (!table || table.status !== "available") return;
    if (order?.status !== "open") return;
    if (order.tableId !== tableId) return;
    if (repairedRef.current === tableId) return;
    repairedRef.current = tableId;
    reoccupyTable(tableId, orderId).catch(() => {});
  }, [tableId, orderId, tableState.data, order?.status, order?.tableId]);

  // Kitchen progress toast — every kot here already belongs to this order.
  const kotAlert = useKotStatusAlerts(kotsState.data);

  // ── UI state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billId, setBillId] = useState<string | null>(null);
  // The dish whose Customize sheet is open. Holding the ITEM rather than a
  // boolean is what lets the sheet reset itself per dish (see its own effect).
  const [customizeItem, setCustomizeItem] = useState<MenuItemDoc | null>(null);

  // A billed order is locked: adding/editing lines would desync the bill.
  const orderLocked = !!order?.billId;

  // Once a takeaway bill is settled the order closes — reset to a clean slate
  // so the next customer starts a fresh order. A VOIDED bill cancels the order
  // instead of closing it, and that has to release the screen for the same
  // reason: either way this order is finished business and holding onto it
  // would leave the counter looking at a locked cart it can never send.
  const takeawayStatus = takeawayOrderState.data?.status;
  useEffect(() => {
    if (isDineIn || billId !== null) return;
    if (takeawayStatus === "closed" || takeawayStatus === "cancelled") {
      mirrorRef.current = null;
      setTakeawayOrderId(null);
      setSheetOpen(false);
    }
  }, [isDineIn, billId, takeawayStatus]);

  // ── Resuming an interrupted takeaway ────────────────────────────────────
  // `takeawayOrderId` is screen state, so leaving the tab or losing the app
  // mid-service used to strand the order: Firestore still had it (billed and
  // unsettled, if the bill had already been generated), but nothing on this
  // screen pointed at it any more and the counter came back to an empty cart.
  // On the way back in we pick that order up again — and if it already has a
  // bill, we reopen the settle sheet, which is where the till was standing.
  const resumable = useResumableTakeawayOrder(
    !isDineIn && waiterId ? waiterId : null
  );
  const resumeDecidedRef = useRef(false);
  useEffect(() => {
    if (isDineIn || resumeDecidedRef.current) return;
    if (takeawayOrderId || resumable.loading) return;
    const found = resumable.order;
    if (!found) return;
    // A billed order can only be moved on by whoever can settle it. Adopting
    // one into a waiter's screen would lock them out of taking the next
    // takeaway order over something they have no way to finish.
    if (found.billId && !canBillHere) return;
    // One decision per visit: from here the screen owns its order, and a
    // late-arriving snapshot must never yank it back to a previous one.
    resumeDecidedRef.current = true;
    mirrorRef.current = { orderId: found.id, items: found.items };
    setTakeawayOrderId(found.id);
    if (found.billId) setBillId(found.billId);
  }, [
    isDineIn,
    canBillHere,
    takeawayOrderId,
    resumable.loading,
    resumable.order,
  ]);

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
  // Both layouts are the same idea — categories beside the grid — with the
  // pane the phone has no room for (the cart) collapsed into a bar.
  const panes = tabletPanes(width);
  // A phone on its side is twice as wide and half as tall, so two columns
  // there is a ~440dp card in a ~140dp gap: one card never fits on screen and
  // the grid stops feeling like a list you can move. Landscape re-flows on
  // width like the tablet does — same cards, more of them across.
  const compact = !isTablet && isLandscape;
  const numColumns = isTablet
    ? gridColumns(width - panes.rail - panes.cart - space.s4 * 2)
    : compact
    ? gridColumns(width - phoneRailWidth(width) - space.s3 * 2, 190, 4)
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

  // Memoised on the raw item array, not recomputed per render. Every derived
  // value below hangs off `lines`, so a fresh array here would invalidate all
  // of their memos on every single render and hand the grid new Maps to
  // diff against — the thing those memos exist to prevent.
  const lines: OrderItem[] = useMemo(
    () => order?.items?.filter((l) => !l.voided) ?? [],
    [order?.items]
  );

  // menuItemId -> the editable (pending, note-less, OPTIONLESS) line, which is
  // the one the card's − / + steps. A line carrying a variant is deliberately
  // excluded: the card cannot know which of three burgers a ＋ meant, so those
  // dishes route through the Customize sheet and the cart instead.
  const pendingByItem = useMemo(() => {
    const map = new Map<string, OrderItem>();
    for (const l of lines) {
      if (l.kotStatus === "pending" && !l.voided && !l.notes && !l.variantId) {
        map.set(l.menuItemId, l);
      }
    }
    return map;
  }, [lines]);

  // menuItemId -> un-sent units across EVERY line of it, options and remarked
  // lines included. This is what an optioned card badges: it answers "have I
  // already put this on the order?", which is the question the waiter is
  // actually asking when they scan the grid.
  const pendingQtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      if (l.kotStatus !== "pending" || l.voided) continue;
      map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.qty);
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
    // Trust local edits still in flight — but only over the order they were
    // aimed at. A mirror pointing at a DIFFERENT order than the one on screen
    // is never right, and every write goes to `mirror.orderId`, so keeping it
    // would append this screen's items to somebody else's bill. (The route
    // keys this component by tableId, so that shouldn't arise on the dine-in
    // side; this is the guard that doesn't depend on the router.)
    const mirror = mirrorRef.current;
    const sameOrder = !order || mirror?.orderId === order.id;
    if (inflightRef.current > 0 && sameOrder) return;
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

  /**
   * The single add path. Every route onto the order — the card's ＋, its
   * stepper, and the Customize sheet's "Add to Cart" — arrives here, so a
   * variant line and a plain one are created, priced and mirrored by exactly
   * the same code. `opts.price` is the CHOSEN option's price; without one the
   * dish's own (cheapest) price stands.
   */
  const commitAdd = (
    item: MenuItemDoc,
    opts: {
      variant?: LineVariant;
      qty?: number;
      notes?: string;
      price?: number;
    } = {}
  ) => {
    // A locked order is a refusal, not a no-op: the card's tap already fired,
    // so answer it rather than leaving the press feeling swallowed. `busy` is
    // transient and stays silent.
    if (orderLocked) return feel.error();
    if (!waiterId || busy) return;
    // Only the FIRST line changes this screen's shape (the cart bar slides
    // in). Animating every subsequent add ran a LayoutAnimation over the
    // whole tree for a number that changed by one, which is what made a fast
    // run of taps feel like it was catching.
    if (lines.length === 0) animateNextLayout();

    const spec: AddLineSpec = {
      menuItemId: item.id,
      name: item.name,
      price: opts.price ?? basePrice(item),
      categoryId: item.categoryId,
      variant: opts.variant,
      qty: opts.qty,
      notes: opts.notes,
    };

    const mirror = mirrorRef.current;
    if (mirror) {
      const items = addLineToLines(mirror.items, spec, pricing);
      mirrorRef.current = { ...mirror, items };
      track(writeOrderItems(mirror.orderId, items), "Couldn’t add item");
    } else {
      // First add: mint the order (and occupy the table) in one local batch.
      const created = createOrderLocal({
        tableId: tableId ?? null,
        orderType,
        waiterId,
        ...spec,
        offers,
      });
      mirrorRef.current = { orderId: created.orderId, items: created.items };
      if (!isDineIn) {
        // This screen has its order now; the resume query must not offer an
        // older one over the top of it.
        resumeDecidedRef.current = true;
        setTakeawayOrderId(created.orderId);
      }
      track(created.commit, "Couldn’t add item");
    }
  };

  const handleAdd = (item: MenuItemDoc) => commitAdd(item);

  /** "Add to Cart" in the Customize sheet: one commit carrying the option,
   *  the quantity and the remark together. */
  const handleCustomizeConfirm = (result: CustomizeResult) => {
    const item = customizeItem;
    setCustomizeItem(null);
    if (!item) return;
    commitAdd(item, {
      variant: result.variant
        ? { id: result.variant.id, name: result.variant.name }
        : undefined,
      qty: result.qty,
      notes: result.notes,
      price: result.price,
    });
  };

  const openCustomize = (item: MenuItemDoc) => {
    // The sheet is a read as much as a write — it is how the waiter quotes
    // the options — so it opens even on a locked order. Nothing commits until
    // "Add to Cart", and `commitAdd` refuses that.
    setCustomizeItem(item);
  };

  const closeCustomize = () => {
    feel.dismiss();
    setCustomizeItem(null);
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

  // ── The grid's three callbacks ──────────────────────────────────────────
  // The grid is the hottest surface in the app, and every add re-renders this
  // screen. Handing each card a fresh `() => handleAdd(item)` would give
  // `OrderMenuCard`'s `memo` a new prop every time and re-render all forty
  // cards for a tap that changed one of them.
  //
  // So these three keep ONE identity for the life of the screen and read the
  // current handlers out of a ref. The ref is reassigned during render rather
  // than in an effect on purpose: a press that arrives between the render and
  // the effect must not run against a stale line-set.
  const handlersRef = useRef({ handleAdd, openCustomize, handleQty, pendingByItem });
  handlersRef.current = { handleAdd, openCustomize, handleQty, pendingByItem };

  const cardAdd = useCallback(
    (item: MenuItemDoc) => handlersRef.current.handleAdd(item),
    []
  );
  const cardCustomize = useCallback(
    (item: MenuItemDoc) => handlersRef.current.openCustomize(item),
    []
  );
  // The card knows the dish, not the line — it is the screen that holds the
  // map from one to the other, and a stale card cannot decrement a line that
  // is no longer there.
  const cardDecrement = useCallback((item: MenuItemDoc) => {
    const { pendingByItem: byItem, handleQty: setQty } = handlersRef.current;
    const line = byItem.get(item.id);
    if (line) setQty(line.lineId, line.qty - 1);
  }, []);

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
        profile: restaurant ?? { name: "Smart Serve" },
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

  const renderCard = useCallback(
    ({ item }: { item: GridEntry }) => {
      if (item.id.startsWith(SPACER)) return <View style={styles.gridCell} />;
      const menuItem = item as MenuItemDoc;
      return (
        <View style={styles.gridCell}>
          <OrderMenuCard
            item={menuItem}
            // An optioned card badges everything un-sent of this dish; a plain
            // one shows the qty of the very line its stepper moves, so the
            // number and the buttons can never disagree.
            qty={
              hasVariants(menuItem)
                ? pendingQtyByItem.get(menuItem.id) ?? 0
                : pendingByItem.get(menuItem.id)?.qty ?? 0
            }
            disabled={!waiterId}
            offerName={offerNameByItem.get(menuItem.id)}
            offerEligible={eligibleItems.has(menuItem.id)}
            onAdd={cardAdd}
            onCustomize={cardCustomize}
            onDecrement={cardDecrement}
          />
        </View>
      );
    },
    [
      pendingByItem,
      pendingQtyByItem,
      offerNameByItem,
      eligibleItems,
      waiterId,
      cardAdd,
      cardCustomize,
      cardDecrement,
    ]
  );

  // ── Shared pieces ───────────────────────────────────────────────────────
  // Built once and placed by each layout, so the phone and the tablet can
  // never drift into showing a different search box, grid or cart.

  // A table's order is a hidden TAB (see `app/(app)/(tabs)/_layout.tsx`), not
  // a pushed screen, which is what keeps the tab bar underneath it. There is
  // therefore no stack here to pop: this goes to Tables by name, which is
  // where it came from — Tables is the only route that opens it.
  const backButton = tableId ? (
    <Pressable
      style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
      onPress={() => router.navigate("/tables")}
      onPressIn={feel.dismiss}
      hitSlop={space.s3}
      accessibilityRole="button"
      accessibilityLabel="Back to tables"
    >
      <Feather name="chevron-left" size={24} color={colors.primary} />
    </Pressable>
  ) : null;

  // Both layouts now sit it in a row of its own width, so the field carries no
  // outer margins — its container places it.
  const searchField = (
    <View style={[styles.searchWrap, isTablet && styles.searchWrapBar]}>
      <Feather name="search" size={17} color={colors.textMuted} />
      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        // Short enough to survive a phone's field. The long form wrapped and
        // was then clipped by the field's own height, so the hint the box
        // exists to give arrived as two half-sentences.
        placeholder="Search the menu…"
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
        // Claims the leftover height outright rather than being sized from its
        // own content and then shrunk back — a list measured from a screenful
        // of cards is one bad measurement away from having no room to scroll in.
        style={styles.gridList}
        data={gridData}
        keyExtractor={(it) => it.id}
        renderItem={renderCard}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.gridContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        // Windowing, tuned for a menu rather than a feed. A card carries a
        // decoded photo, so keeping the whole list mounted is what actually
        // costs the scroll its frames on a cheap tablet.
        //
        // `initialNumToRender` is three rows: enough to fill the first screen
        // in one pass, so the grid does not visibly assemble itself. The
        // window is deliberately generous either side of that — a waiter
        // flicks this list hard, and blank cells racing back are worse than
        // a little more memory held.
        removeClippedSubviews
        initialNumToRender={numColumns * 3}
        maxToRenderPerBatch={numColumns * 2}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No items found.</Text>
          </View>
        }
        // Counts what is ON SCREEN, not the whole menu — it is the end of the
        // list saying "that was all of it", which is the reassurance a waiter
        // scrolling a category actually wants.
        ListFooterComponent={
          filteredItems.length > 0 ? (
            <Text style={styles.gridFooter}>
              Total Dish : {filteredItems.length}
            </Text>
          ) : null
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

  /* Customize: options, quantity and remarks, on both layouts */
  const customizeSheet = (
    <CustomizeDishSheet
      item={customizeItem}
      onCancel={closeCustomize}
      onConfirm={handleCustomizeConfirm}
    />
  );

  // Up to three distinct dishes on the order, for the cart bar's stack of
  // photos. Distinct rather than per-line: three coffees are one picture, and
  // the number beside them already says how many.
  const cartThumbs = useMemo(() => {
    const byId = new Map(itemsState.data.map((it) => [it.id, it]));
    const seen = new Set<string>();
    const out: { id: string; source: ReturnType<typeof resolveMenuImage> }[] = [];
    for (const l of lines) {
      if (seen.has(l.menuItemId)) continue;
      seen.add(l.menuItemId);
      out.push({
        id: l.menuItemId,
        source: resolveMenuImage(l.menuItemId, byId.get(l.menuItemId)?.imageUrl),
      });
      if (out.length === 3) break;
    }
    return out;
  }, [lines, itemsState.data]);

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
            <BrandMark size={30} />
            <Text style={styles.brand}>Smart Serve</Text>
          </View>
          <Text style={styles.titleCompact}>New Order</Text>
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

        {customizeSheet}
        {billModal}

        {/* Live kitchen status toast ("T1 — Order READY") */}
        <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
      </View>
    );
  }

  // ── Phone: rail | grid, with the order in a bottom sheet ────────────────
  // The same three-pane idea as the tablet, minus the pane there is no room
  // for: the categories stay beside the grid, and the cart collapses to a bar
  // that opens the sheet.
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* The same two rows every other tab opens with — the brand lockup, then
          the screen's name — from the shared components, so this screen can't
          drift from them. Order briefly collapsed both into one compact bar to
          buy the rail height back; it saved a row and cost the screen its
          resemblance to the rest of the app.

          The title stays "New Order" for a table too. The table is already on
          the cart bar and the sheet, and naming it up here made the screen look
          like a different one depending on how it was opened. */}
      <BrandHeader left={backButton} />
      <ScreenHeader title="New Order" right={<ProfileButton />} />

      {/* The chrome stays put and the CONTENT settles in. Animating the brand
          bar too would restate what the cross-fade already said; holding it
          still is what makes the rise below it read as "this table opened"
          rather than as the whole app redrawing. Replays per table, so moving
          from T3 to T4 is visibly a move. */}
      <ScreenEnter style={styles.enter} replayKey={tableId ?? "takeaway"}>
        {/* Its own row, full width. Squeezing it into the bar beside the title
            and Account leaves ~150dp on a 360dp phone — a search field too
            narrow to show what you typed is worse than one extra row. */}
        <View style={styles.searchRow}>{searchField}</View>

        <View style={styles.phoneBody}>
          <View style={[styles.railPane, { width: phoneRailWidth(width) }]}>
            <OrderCategoryRail
              categories={enabledCategories}
              countByCategory={countByCategory}
              totalCount={enabledItemCount}
              activeId={activeCategory}
              compact
              onSelect={(id) => {
                // Moving through choices, not pressing a button — and a re-tap
                // of the current category says nothing, same as a chip did.
                if (id !== activeCategory) feel.select();
                setActiveCategory(id);
              }}
            />
          </View>

          <View style={styles.centerPane}>
            {menuGrid(insets.bottom + (lines.length > 0 ? 104 : space.s6))}
          </View>
        </View>
      </ScreenEnter>

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
          accessibilityRole="button"
          accessibilityLabel={`View order, ${itemCount} items, ${formatMoney(
            payable
          )}`}
        >
          {/* Overlapped photos of what is on the order. The count rides on
              the stack rather than in prose: at a table the waiter is
              checking a number, not reading a sentence. */}
          <View style={styles.cartThumbs}>
            {cartThumbs.map((t, i) => (
              <View
                key={t.id}
                style={[styles.cartThumbWrap, i > 0 && styles.cartThumbOverlap]}
              >
                {t.source ? (
                  <Image
                    style={styles.cartThumb}
                    source={t.source}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={t.id}
                  />
                ) : (
                  <View style={[styles.cartThumb, styles.cartThumbEmpty]} />
                )}
              </View>
            ))}
            <View style={styles.cartCount}>
              <Text style={styles.cartCountText}>{itemCount}</Text>
            </View>
          </View>

          <View style={styles.cartBarPrice}>
            {offerDiscount > 0 ? (
              <Text style={styles.cartBarStruck}>{formatMoney(subtotal)}</Text>
            ) : null}
            <Text style={styles.cartBarText}>{formatMoney(payable)}</Text>
            <Feather
              name="chevron-right"
              size={20}
              color={colors.textInverse}
            />
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

      {customizeSheet}
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
        // NOT `styles.gridRow`. That one is the FlatList's `columnWrapperStyle`
        // and carries no `flexDirection`, because the list supplies the row
        // itself — on a plain View it means "column", which stacked all eight
        // cells vertically and squeezed every card down to its text bones.
        <View key={row} style={styles.skeletonRow}>
          {Array.from({ length: columns }, (_, col) => (
            <View key={col} style={styles.gridCell}>
              <View style={styles.skeletonCard}>
                {/* The square photo. The aspect ratio lives on a plain wrapper
                    and the bone fills it, rather than the bone deriving its own
                    height from `height: "auto"` — one less thing depending on
                    when Yoga resolves the card's width. */}
                <View style={styles.skeletonPhoto}>
                  <Bone width="100%" height="100%" round={0} />
                </View>
                <View style={styles.skeletonBody}>
                  <Bone width="80%" height={13} />
                  <Bone width="45%" height={13} />
                  {/* The ＋ Add block, at its real 40dp. Guessing at it
                      leaves the grey card a different height from the real
                      one and every row jumps on arrival — the exact thing a
                      skeleton exists to avoid. */}
                  <Bone width="100%" height={40} round={radius.md} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
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
  // Takes the space the search row and the body used to take between them, so
  // wrapping them in the enter animation doesn't change the layout.
  enter: { flex: 1 },
  searchRow: {
    paddingHorizontal: space.s4,
    paddingBottom: space.s2,
  },
  phoneBody: {
    flex: 1,
    flexDirection: "row",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  // Pulled back by its own padding so the chevron optically lines up with the
  // bar's edge while still presenting a full-size target.
  backBtn: { padding: space.s1, marginLeft: -space.s2 },
  // Only the tablet bar carries the brand lockup — the phone spends that row
  // on the rail instead. Keep this in step with BrandHeader's own type.
  brand: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.primary,
    letterSpacing: 0.3,
  },
  // Both bars that put the title beside something else — the phone bar and
  // the tablet bar — take the shared compact heading, so the two "New Order"
  // titles in this file are one style.
  titleCompact: typography.screenTitleCompact,
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingHorizontal: space.s4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  // On a tablet the field lives inside the top bar, taking the slack left by
  // the brand + title rather than a whole row of its own.
  searchWrapBar: {
    flex: 1,
    maxWidth: 460,
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
  gridList: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
  },
  gridFooter: {
    textAlign: "center",
    paddingVertical: space.s5,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
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
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
  },
  skeletonCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    // Matches the real card's resting (transparent) border, so the swap does
    // not move the grid by three pixels.
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.float,
  },
  // Mirrors the real card's row: same direction, same gap, same gutter, so the
  // grey grid and the real one occupy the same pixels.
  skeletonRow: {
    flexDirection: "row",
    gap: space.s3,
    marginBottom: space.s3,
  },
  skeletonPhoto: {
    width: "100%",
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
  cartThumbs: {
    flexDirection: "row",
    alignItems: "center",
  },
  // A white ring around each photo is what separates one from the next once
  // they overlap — without it three dark dishes read as a single smudge.
  cartThumbWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    overflow: "hidden",
  },
  cartThumbOverlap: {
    marginLeft: -12,
  },
  cartThumb: {
    width: "100%",
    height: "100%",
    borderRadius: radius.pill,
  },
  cartThumbEmpty: {
    backgroundColor: colors.primaryDark,
  },
  cartCount: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    marginLeft: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.textInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCountText: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: colors.primary,
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
