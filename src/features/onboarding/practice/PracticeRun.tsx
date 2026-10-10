/**
 * THE PRACTICE RUN — one whole order, start to receipt, on a restaurant that
 * does not exist.
 *
 * This is the first thing a new owner sees after the setup wizard, and it is
 * the app's one chance to answer the only question they actually have: *what
 * is this thing, and can I work it?* A checklist cannot answer that. Reading
 * cannot answer that. Doing it once can.
 *
 * ## The load-bearing decisions
 *
 * - **The screens are the REAL screens, in the REAL layout.** Not just the
 *   same card components — the same arrangement of them: the category rail
 *   beside the grid, the collapsed cart bar on a phone with the order in a
 *   sheet behind it, the docked three-pane on a tablet. The first cut of this
 *   put the cards in a plain wrapped grid with the cart panel jammed into a
 *   `maxHeight` box, and two things went wrong at once — it did not look like
 *   the app, and `OrderCartPanel`'s footer (which is where **Send KOT**
 *   lives) was pushed straight out of the clipped box. An owner cannot be
 *   taught a button they cannot see. Layout constants come from `OrderScreen`
 *   itself (`phoneRailWidth`, `tabletPanes`) rather than being copied, so the
 *   two cannot drift.
 * - **It runs on THEIR menu, at THEIR prices, in THEIR configuration.** The
 *   dishes and categories are read from Firestore (read-only), the totals come
 *   from the real `computeBill`, and the step list is filtered by the wizard's
 *   answers. A demo of somebody else's café teaches somebody else's café.
 * - **Nothing is written, so nothing has to be cleaned up.** See
 *   `practiceState.ts`. The competing design — real writes, then undo them —
 *   is one dropped connection away from a phantom ₹180 in a restaurant's
 *   opening figures, on the very day the owner is deciding whether to trust
 *   the figures at all.
 * - **The run advances on the ACTION, never on a Next button.** Every step
 *   asks the reducer whether the thing is done. There is no way to walk
 *   through this without doing it, and no way for the caption to claim
 *   something happened that didn't.
 * - **Everything except the target is dimmed, but nothing is disabled.** The
 *   dimming says where to look; it does not take the controls away. An owner
 *   who wants to tap a different dish gets to tap a different dish — the run
 *   is teaching a tool, not administering a test.
 */
import { useCallback, useMemo, useReducer, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { TableCard } from "@/features/tables/TableCard";
import { OrderMenuCard } from "@/features/order/OrderMenuCard";
import { OrderCartPanel } from "@/features/order/OrderCartPanel";
import {
  OrderCategoryRail,
  ALL_CATEGORIES,
} from "@/features/order/OrderCategoryRail";
import { phoneRailWidth, tabletPanes } from "@/features/order/OrderScreen";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { TableTicketCard } from "@/features/kitchen/TableTicketCard";
import { groupActiveKots } from "@/features/kitchen/groupKots";
import type { RestaurantConfig } from "@/features/settings/restaurantConfig";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { feel } from "@/lib/feedback";
import { computeBill, formatMoney } from "@/lib/money";
import { gridColumns, useResponsive } from "@/lib/responsive";
import type { MenuCategory, MenuItem, PaymentMode } from "@/types/models";
import { PracticeCoach } from "./PracticeCoach";
import { PracticeReceipt } from "./PracticeReceipt";
import { practiceScript, type PracticeStep } from "./practiceScript";
import {
  initialPracticeState,
  practiceReducer,
  practiceTableLabel,
  PRACTICE_TABLE_ID,
} from "./practiceState";

/** How hard the not-right-now parts of the screen step back. Enough to
 *  direct the eye, not so much that the screen looks broken or disabled. */
const DIM = 0.3;

/** The longest run the receipt will quote a time for. */
const PRAISE_WITHIN_SECONDS = 120;

/** Id prefix for the invisible cells that pad the last grid row. */
const GRID_SPACER = "__practice_spacer__";

export interface PracticeRunProps {
  config: RestaurantConfig;
  /** The restaurant's real menu. Read-only — the run never writes to it. */
  menu: MenuItem[];
  categories: MenuCategory[];
  restaurantName: string | null;
  addressLine?: string | null;
  gstEnabled: boolean;
  /** Left the run — by finishing it or by skipping out. */
  onExit: (reason: "finished" | "skipped") => void;
}

export function PracticeRun({
  config,
  menu,
  categories,
  restaurantName,
  addressLine,
  gstEnabled,
  onExit,
}: PracticeRunProps) {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const [state, dispatch] = useReducer(
    practiceReducer,
    config.tablesEnabled,
    initialPracticeState
  );
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  // When the run came up, for the receipt's "in 40 seconds". Lazy state
  // rather than a ref so it is read once and never again.
  const [startedAt] = useState(() => Date.now());

  // A tablet keeps the cart on screen permanently, so there is no bar to tap
  // and the step that teaches tapping it must not exist.
  const layout = useMemo(
    () => ({ cartAlwaysVisible: isTablet }),
    [isTablet]
  );
  const steps = useMemo(
    () => practiceScript(config, layout),
    [config, layout]
  );
  // The first step this restaurant has not done. Derived every render from
  // the reducer, so the run cannot get out of step with itself.
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => !s.done(state))
  );
  const step: PracticeStep = steps[stepIndex] ?? steps[steps.length - 1];
  const performedTotal = steps.filter((s) => s.id !== "receipt").length;

  const enabled = useMemo(
    () => menu.filter((m) => m.enabled !== false),
    [menu]
  );
  const enabledCategories = useMemo(
    () =>
      categories
        .filter((c) => c.enabled !== false)
        .filter((c) => enabled.some((m) => m.categoryId === c.id)),
    [categories, enabled]
  );
  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of enabled) {
      map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    }
    return map;
  }, [enabled]);
  const dishes = useMemo(
    () =>
      activeCategory === ALL_CATEGORIES
        ? enabled
        : enabled.filter((m) => m.categoryId === activeCategory),
    [enabled, activeCategory]
  );

  const panes = tabletPanes(width);
  const railW = isTablet ? panes.rail : phoneRailWidth(width);
  const numColumns = isTablet
    ? gridColumns(width - panes.rail - panes.cart - space.s4 * 2)
    : 2;

  // Padded to a whole number of rows, exactly as the real grid is: with
  // `flex: 1` cells a lone trailing card stretches across the row it landed
  // in, which reads as a rendering fault rather than as the end of a list.
  const gridData = useMemo(() => {
    const remainder = dishes.length % numColumns;
    if (remainder === 0) return dishes as (MenuItem | { id: string })[];
    const padded: (MenuItem | { id: string })[] = [...dishes];
    for (let i = remainder; i < numColumns; i += 1) {
      padded.push({ id: `${GRID_SPACER}${i}` });
    }
    return padded;
  }, [dishes, numColumns]);

  const totals = useMemo(
    () => computeBill(state.lines, 0, gstEnabled),
    [state.lines, gstEnabled]
  );
  const itemCount = state.lines.reduce((n, l) => n + l.qty, 0);
  const pendingCount = state.lines.filter(
    (l) => l.kotStatus === "pending"
  ).length;

  /**
   * Quantity per dish, as a map of PRIMITIVES.
   *
   * This and the three handlers below exist for one reason: `OrderMenuCard`
   * is `memo`'d, and the first cut of this screen passed it freshly-created
   * arrow functions on every render, which defeated that memo completely.
   * Every tap then re-rendered every card in the grid — each one carrying a
   * decoded photo — and the Send-KOT and Generate-Bill buttons visibly
   * lagged behind the finger. The real order screen does exactly this
   * (`cardAdd`/`cardCustomize`/`cardDecrement` + a memoised `renderCard`);
   * dropping it was the whole of the slowness.
   */
  const qtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of state.lines) {
      map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.qty);
    }
    return map;
  }, [state.lines]);

  // `dispatch` is stable for the life of the reducer, so all three of these
  // are created once and never again.
  const cardAdd = useCallback(
    (item: MenuItem) => dispatch({ type: "addDish", item }),
    []
  );
  const cardDecrement = useCallback(
    (item: MenuItem) =>
      dispatch({ type: "decrementDish", menuItemId: item.id }),
    []
  );
  // Variants are a Menu-screen lesson, not a first-run one — Customize just
  // adds the dish here.
  const cardCustomize = useCallback(
    (item: MenuItem) => dispatch({ type: "addDish", item }),
    []
  );

  const cartThumbs = useMemo(() => {
    const byId = new Map(menu.map((it) => [it.id, it]));
    const seen = new Set<string>();
    const out: { id: string; source: ReturnType<typeof resolveMenuImage> }[] = [];
    for (const l of state.lines) {
      if (seen.has(l.menuItemId)) continue;
      seen.add(l.menuItemId);
      out.push({
        id: l.menuItemId,
        source: resolveMenuImage(l.menuItemId, byId.get(l.menuItemId)?.imageUrl),
      });
      if (out.length === 3) break;
    }
    return out;
  }, [state.lines, menu]);

  // Memoised, so a state change does not hand FlatList a brand-new render
  // function and force every row to re-render. `dimUnpicked` is the only
  // thing that varies within a step, so it is the only dependency that
  // changes while the grid is on screen.
  const dimUnpicked = step.id === "add-dish";
  const renderCard = useCallback(
    ({ item, index }: { item: MenuItem | { id: string }; index: number }) =>
      // `in` rather than an id check, so TypeScript narrows the padded union
      // instead of being told to trust us.
      !("price" in item) ? (
        <View style={styles.gridCell} />
      ) : (
        <View
          style={[
            styles.gridCell,
            // Only the FIRST dish is lit, and only while the instruction is
            // "add a dish". Once something is in the cart the whole menu
            // comes back up — the owner is past that lesson and may want a
            // second thing.
            dimUnpicked && index !== 0 && { opacity: DIM },
          ]}
        >
          <OrderMenuCard
            item={item}
            qty={qtyByItem.get(item.id) ?? 0}
            onAdd={cardAdd}
            onDecrement={cardDecrement}
            onCustomize={cardCustomize}
          />
        </View>
      ),
    [dimUnpicked, qtyByItem, cardAdd, cardDecrement, cardCustomize]
  );

  const skip = useCallback(() => onExit("skipped"), [onExit]);

  // Shared by the sheet and the tablet pane, so the two can never offer
  // different buttons for the same order.
  const cartProps = {
    lines: state.lines,
    itemCount,
    subtotal: totals.subtotal,
    offerDiscount: totals.offerDiscount ?? 0,
    payable: totals.subtotal - (totals.offerDiscount ?? 0),
    pendingCount,
    busy: false,
    orderLocked: false,
    // The counter loops bill right here; the dine-in-with-kitchen loop walks
    // to the Bills tab instead. Same rule as the real screen's `canBillHere`.
    canBillHere: !(config.tablesEnabled && config.kotEnabled),
    kotEnabled: config.kotEnabled,
    onQty: (lineId: string, qty: number) =>
      dispatch({ type: "setQty", lineId, qty }),
    onNotes: () => {},
    onSendKot: () => {
      feel.success();
      dispatch({ type: "sendKot" });
    },
    onGenerateBill: () => dispatch({ type: "openBills" }),
  };

  // ── the receipt is its own screen ──────────────────────────────────────────
  if (state.stage === "receipt") {
    const took =
      state.paidAt != null
        ? Math.max(1, Math.round((state.paidAt - startedAt) / 1000))
        : null;
    return (
      <PracticeReceipt
        restaurantName={restaurantName}
        addressLine={addressLine}
        lines={state.lines}
        totals={totals}
        tableLabel={practiceTableLabel(state)}
        paymentLabel={state.paymentLabel}
        gstEnabled={gstEnabled}
        kotEnabled={config.kotEnabled}
        // Past a couple of minutes the tablet was put down, and a stopwatch
        // on somebody's tea break is not a compliment.
        seconds={took != null && took <= PRAISE_WITHIN_SECONDS ? took : null}
        onDone={() => onExit("finished")}
      />
    );
  }

  const coach = (
    <View style={styles.coachDock} pointerEvents="box-none">
      <PracticeCoach
        stepKey={step.id}
        title={step.title}
        body={step.body}
        index={Math.min(stepIndex + 1, performedTotal)}
        total={performedTotal}
        onSkip={skip}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {coach}

      <View style={styles.stage}>
        {state.stage === "floor" && (
          <ScrollView
            contentContainerStyle={styles.floorGrid}
            showsVerticalScrollIndicator={false}
          >
            {state.tables.map((t) => {
              const target = t.id === PRACTICE_TABLE_ID;
              return (
                <View
                  key={t.id}
                  style={[
                    { width: `${100 / (isTablet ? 4 : 2)}%` },
                    styles.floorCell,
                    !target && { opacity: DIM },
                  ]}
                >
                  <TableCard
                    table={t}
                    order={null}
                    primary={null}
                    onPress={(picked) =>
                      dispatch({ type: "pickTable", tableId: picked.id })
                    }
                  />
                </View>
              );
            })}
          </ScrollView>
        )}

        {state.stage === "order" && (
          <>
            {/* The real screen's shape: categories beside the grid, with the
                cart either docked (tablet) or collapsed to the bar below. */}
            <View style={styles.body}>
              <View style={[styles.railPane, { width: railW }]}>
                <OrderCategoryRail
                  categories={enabledCategories}
                  countByCategory={countByCategory}
                  totalCount={enabled.length}
                  activeId={activeCategory}
                  compact={!isTablet}
                  onSelect={(id) => {
                    if (id !== activeCategory) feel.select();
                    setActiveCategory(id);
                  }}
                />
              </View>

              <View style={styles.centerPane}>
                <FlatList
                  key={`practice-grid-${numColumns}`}
                  style={styles.gridList}
                  data={gridData}
                  keyExtractor={(it) => it.id}
                  numColumns={numColumns}
                  columnWrapperStyle={styles.gridRow}
                  contentContainerStyle={[
                    styles.gridContent,
                    {
                      paddingBottom:
                        insets.bottom +
                        (!isTablet && state.lines.length > 0 ? 104 : space.s6),
                    },
                  ]}
                  showsVerticalScrollIndicator={false}
                  renderItem={renderCard}
                  // The same windowing the real grid tunes, and for the same
                  // reason: a card carries a decoded photo, so mounting the
                  // whole menu at once is what costs the frames. Leaving
                  // these off — as the first cut did — mounts far more cards
                  // than the live screen ever does.
                  removeClippedSubviews
                  initialNumToRender={numColumns * 3}
                  maxToRenderPerBatch={numColumns * 2}
                  windowSize={7}
                  updateCellsBatchingPeriod={50}
                />
              </View>

              {isTablet && (
                <View style={[styles.cartPane, { width: panes.cart }]}>
                  <OrderCartPanel
                    variant="pane"
                    tableLabel={practiceTableLabel(state)}
                    {...cartProps}
                  />
                </View>
              )}
            </View>

            {/* Collapsed cart bar — the phone's cart, and the only route to
                Send KOT. Lit while the step is about opening it. */}
            {!isTablet && state.lines.length > 0 && !state.cartOpen && (
              <Pressable
                style={({ pressed }) => [
                  styles.cartBar,
                  { bottom: insets.bottom + space.s5 },
                  step.id === "open-cart" && styles.cartBarTarget,
                  pressed && styles.cartBarPressed,
                ]}
                onPress={() => {
                  feel.press();
                  dispatch({ type: "openCart" });
                }}
                accessibilityRole="button"
                accessibilityLabel={`View order, ${itemCount} items, ${formatMoney(
                  totals.subtotal - (totals.offerDiscount ?? 0)
                )}`}
              >
                <View style={styles.cartThumbs}>
                  {cartThumbs.map((t, i) => (
                    <View
                      key={t.id}
                      style={[
                        styles.cartThumbWrap,
                        i > 0 && styles.cartThumbOverlap,
                      ]}
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
                  <Text style={styles.cartBarText}>
                    {formatMoney(totals.subtotal - (totals.offerDiscount ?? 0))}
                  </Text>
                  <Feather
                    name="chevron-right"
                    size={20}
                    color={colors.textInverse}
                  />
                </View>
              </Pressable>
            )}

            {/* The order sheet. Send KOT / Charge live in its footer, which is
                the whole reason the bar above exists as a taught step. */}
            <Modal
              visible={!isTablet && state.cartOpen}
              animationType="slide"
              transparent
              onRequestClose={() => dispatch({ type: "closeCart" })}
            >
              <View style={styles.sheetBackdrop}>
                <Pressable
                  style={styles.backdropFill}
                  onPress={() => dispatch({ type: "closeCart" })}
                />
                <View
                  style={[
                    styles.sheet,
                    { paddingBottom: insets.bottom + space.s3 },
                  ]}
                >
                  <View style={styles.dragHandle} />
                  <OrderCartPanel
                    variant="sheet"
                    {...cartProps}
                    onClose={() => dispatch({ type: "closeCart" })}
                  />
                </View>
                {/* The coach follows the order into the sheet. Send KOT is in
                    here, so the instruction that names it has to be too. */}
                <View
                  style={[styles.sheetCoach, { top: insets.top + space.s2 }]}
                  pointerEvents="box-none"
                >
                  <PracticeCoach
                    stepKey={step.id}
                    title={step.title}
                    body={step.body}
                    index={Math.min(stepIndex + 1, performedTotal)}
                    total={performedTotal}
                    onSkip={skip}
                  />
                </View>
              </View>
            </Modal>
          </>
        )}

        {state.stage === "kds" && state.kot && (
          <ScrollView
            contentContainerStyle={styles.kdsWrap}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stageNote}>
              This is the kitchen&apos;s screen — on their tablet, not yours.
            </Text>
            {groupActiveKots([state.kot]).map((group) => (
              <TableTicketCard
                key={group.key}
                group={group}
                onPress={() => {}}
                // The seam that keeps this run from writing. See the card.
                // Where the food goes AFTER the kitchen is a config
                // question, and getting it wrong teaches a route that does
                // not exist. A dine-in table is paid for from the Bills tab,
                // so the run goes there. A counter order is billed from the
                // cart it is already in (`canBillHere`), so the run goes back
                // to the cart and the owner taps the real Generate Bill
                // button — jumping straight to payment would skip the one
                // control they actually have to find.
                onCompleteOverride={() => {
                  dispatch({ type: "kdsComplete" });
                  dispatch(
                    config.tablesEnabled && config.kotEnabled
                      ? { type: "openBills" }
                      : { type: "openCart" }
                  );
                }}
              />
            ))}
          </ScrollView>
        )}

        {state.stage === "bills" && (
          <ScrollView contentContainerStyle={styles.billWrap}>
            <View style={styles.billCard}>
              <Text style={styles.billTable}>{practiceTableLabel(state)}</Text>
              {state.lines.map((l) => (
                <View key={l.lineId} style={styles.billRow}>
                  <Text style={styles.billQty}>{l.qty}×</Text>
                  <Text style={styles.billName} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Text style={styles.billAmt}>
                    {formatMoney(l.price * l.qty)}
                  </Text>
                </View>
              ))}
              <View style={styles.billRule} />
              {gstEnabled && (
                <View style={styles.billRow}>
                  <Text style={styles.billName}>GST</Text>
                  <Text style={styles.billAmt}>
                    {formatMoney(totals.gstTotal)}
                  </Text>
                </View>
              )}
              <View style={styles.billRow}>
                <Text style={styles.billTotalLabel}>Total</Text>
                <Text style={styles.billTotal}>
                  {formatMoney(totals.grandTotal)}
                </Text>
              </View>
            </View>

            <Text style={styles.payPrompt}>How did they pay?</Text>
            <View style={styles.payRow}>
              {(
                [
                  { mode: "cash", label: "Cash", icon: "cash" },
                  { mode: "upi", label: "UPI", icon: "cellphone" },
                  { mode: "card", label: "Card", icon: "credit-card-outline" },
                ] as { mode: PaymentMode; label: string; icon: string }[]
              ).map((p) => (
                <PressableScale
                  key={p.mode}
                  containerStyle={styles.payHit}
                  style={styles.payBtn}
                  activeScale={0.97}
                  haptic="success"
                  onPress={() =>
                    dispatch({ type: "settle", paymentLabel: p.label })
                  }
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name={p.icon as never}
                    size={20}
                    color={colors.textInverse}
                  />
                  <Text style={styles.payText}>{p.label}</Text>
                </PressableScale>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  coachDock: {
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s3,
  },
  stage: { flex: 1 },

  // ── floor ──────────────────────────────────────────────────────────────────
  floorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: space.s3,
    paddingBottom: space.s4,
  },
  floorCell: { padding: space.s2 },

  // ── order: the real screen's arrangement ───────────────────────────────────
  body: { flex: 1, flexDirection: "row" },
  railPane: { paddingTop: space.s2 },
  centerPane: { flex: 1 },
  cartPane: { paddingLeft: space.s3 },
  gridList: { flex: 1 },
  gridContent: {
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
  },
  gridRow: { gap: space.s3, marginBottom: space.s3 },
  gridCell: { flex: 1 },

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
  // The one moment this bar is the thing being taught. A ring rather than a
  // colour change: it is already the brightest object on the screen, and
  // recolouring it would make it look like a different control.
  cartBarTarget: {
    borderWidth: 3,
    borderColor: colors.surface,
  },
  cartBarPressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
  cartBarText: {
    color: colors.textInverse,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  cartBarPrice: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  cartThumbs: { flexDirection: "row", alignItems: "center" },
  cartThumbWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    overflow: "hidden",
  },
  cartThumbOverlap: { marginLeft: -12 },
  cartThumb: { width: "100%", height: "100%" },
  cartThumbEmpty: { backgroundColor: colors.surfaceMuted },
  cartCount: {
    marginLeft: space.s2,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCountText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 12,
  },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  backdropFill: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
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
    backgroundColor: colors.border,
    marginBottom: space.s3,
  },
  sheetCoach: {
    position: "absolute",
    left: space.s4,
    right: space.s4,
  },

  // ── kds ────────────────────────────────────────────────────────────────────
  kdsWrap: { padding: space.s4, gap: space.s3 },
  stageNote: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: space.s1,
  },

  // ── bills ──────────────────────────────────────────────────────────────────
  billWrap: { padding: space.s4, gap: space.s4 },
  billCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
    gap: space.s2,
  },
  billTable: {
    fontFamily: fonts.extrabold,
    fontSize: 17,
    color: colors.text,
    marginBottom: space.s1,
  },
  billRow: { flexDirection: "row", alignItems: "center", gap: space.s3 },
  billQty: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textMuted,
    minWidth: 26,
  },
  billName: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
  },
  billAmt: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  billRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.s1,
  },
  billTotalLabel: {
    flex: 1,
    fontFamily: fonts.extrabold,
    fontSize: 15,
    color: colors.text,
  },
  billTotal: { fontFamily: fonts.extrabold, fontSize: 19, color: colors.text },

  payPrompt: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  payRow: { flexDirection: "row", gap: space.s3 },
  payHit: { flex: 1 },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.s4,
    ...shadow.glow,
  },
  payText: { fontFamily: fonts.bold, fontSize: 14, color: colors.textInverse },
});
