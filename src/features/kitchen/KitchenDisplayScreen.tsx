/**
 * Kitchen Display (KDS) — live per-table board with the red/orange/green
 * status system.
 *
 * Three underline-style filter tabs with live circular counts:
 *   ORDERS (red)      — every table with an active ticket (new/preparing/ready)
 *   ADDITIONAL (orange) — tables with a 2nd+ active ticket (a later round)
 *   COMPLETED (green) — today's completed tickets, newest first
 *
 * Cards are one per table (see groupKots) in a high-density grid sized so a
 * whole number of rows fits the screen — 3×3 on a phone, wider and deeper on
 * a tablet (see `boardRows`); the list scrolls to reveal more tables. Each
 * card shows its 1-based FIFO queue position. Fully real-time via the ported
 * hooks; writes only through kdsApi.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { orderBy, query, Timestamp, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import { startOfDayIST } from "@/lib/date";
import { feel } from "@/lib/feedback";
import { useResponsive } from "@/lib/responsive";
import { colors, fonts, radius, space } from "@/theme/theme";
import { BrandMark } from "@/components/BrandLogo";
import type { Kot } from "@/types/models";
import {
  completedGroups,
  groupActiveKots,
  hasAdditionalRound,
  type TableGroup,
} from "./groupKots";
import { TableTicketCard } from "./TableTicketCard";
import { TicketDetailSheet } from "./TicketDetailSheet";

const COLS = 3;
const ROWS = 3;
const GAP = space.s3;

/**
 * The shortest a ticket may be drawn: header, elapsed time, MAX_ITEM_LINES of
 * items and the COMPLETE button. Below this the card body starts clipping
 * items, and on a kitchen board a clipped ticket is worse than fewer tickets.
 */
const MIN_CARD_H = 160;

/**
 * How many rows of whole cards a board of `gridH` can hold.
 *
 * The phone keeps its fixed 3×3 — that density is the screen's whole design.
 * A tablet instead takes the TALLEST board whose cards still clear
 * `MIN_CARD_H`, because a KDS is a queue: seeing one more ticket is worth
 * more than seeing the same ticket bigger, right up until it stops being
 * readable. The board still shows whole cards and never a sliced row.
 */
function boardRows(gridH: number): number {
  for (let rows = 6; rows > 2; rows -= 1) {
    if (Math.floor((gridH - rows * GAP) / rows) >= MIN_CARD_H) return rows;
  }
  return ROWS;
}

type Tab = "orders" | "takeaway" | "additional" | "completed";

type GridEntry = TableGroup | { key: string; spacer: true };

const EMPTY_COPY: Record<Tab, string> = {
  orders: "No active orders — new KOTs appear here instantly.",
  takeaway: "No takeaway orders in the kitchen right now.",
  additional: "No table has an additional round right now.",
  completed: "No completed tickets yet today.",
};

export function KitchenDisplayScreen() {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const [tab, setTab] = useState<Tab>("orders");
  const [gridH, setGridH] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Live queries — identity stable across renders.
  const activeQuery = useMemo(
    () =>
      query(
        paths.kots(),
        where("status", "in", ["new", "preparing", "ready"]),
        orderBy("createdAt", "asc")
      ),
    []
  );
  const dayStart = useMemo(() => Timestamp.fromDate(startOfDayIST()), []);
  const completedQuery = useMemo(
    () =>
      query(
        paths.kots(),
        where("status", "==", "completed"),
        where("createdAt", ">=", dayStart),
        orderBy("createdAt", "asc")
      ),
    [dayStart]
  );

  const activeState = useCollectionData<Kot>(activeQuery);
  const completedState = useCollectionData<Kot>(completedQuery);

  const activeGroups = useMemo(
    () => groupActiveKots(activeState.data),
    [activeState.data]
  );
  const additionalGroups = useMemo(
    () => activeGroups.filter(hasAdditionalRound),
    [activeGroups]
  );
  // Counter orders (takeaway/delivery) — every ticket in a group shares one
  // order, so the first ticket's type describes the whole group.
  const takeawayGroups = useMemo(
    () => activeGroups.filter((g) => g.tickets[0].orderType !== "dine-in"),
    [activeGroups]
  );
  const doneGroups = useMemo(
    () => completedGroups(completedState.data),
    [completedState.data]
  );

  const visible =
    tab === "orders"
      ? activeGroups
      : tab === "takeaway"
        ? takeawayGroups
        : tab === "additional"
          ? additionalGroups
          : doneGroups;

  // A tablet gets a wider board in landscape, where 3 columns would stretch
  // each ticket into a squat letterbox. Portrait keeps 3 — the same card
  // proportions the phone board was designed around.
  const cols = isTablet ? (width >= 1100 ? 4 : COLS) : COLS;
  const rows = isTablet ? boardRows(gridH) : ROWS;

  // Pad the last row so a lone card doesn't stretch across the grid.
  const gridData: GridEntry[] = useMemo(() => {
    const d: GridEntry[] = [...visible];
    while (d.length % cols !== 0)
      d.push({ key: `spacer-${d.length}`, spacer: true });
    return d;
  }, [visible, cols]);

  // Exactly `rows` rows visible: card height derived from the measured grid.
  const cardH = gridH > 0 ? Math.floor((gridH - rows * GAP) / rows) : 0;

  // Detail sheet target, resolved live so it tracks (and auto-closes on)
  // realtime changes — e.g. completing from the sheet removes the group.
  const selectedGroup = useMemo(() => {
    if (!selectedKey) return null;
    return (
      activeGroups.find((g) => g.key === selectedKey) ??
      doneGroups.find((g) => g.key === selectedKey) ??
      null
    );
  }, [selectedKey, activeGroups, doneGroups]);

  const loading = activeState.loading || completedState.loading;
  const error = activeState.error ?? completedState.error;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* App header */}
      <View style={styles.appBar}>
        <View style={styles.brandRow}>
          <BrandMark size={22} />
          <Text style={styles.brand}>Smart Serve</Text>
        </View>
        <Text style={styles.kitchenTag}>KITCHEN</Text>
      </View>

      {/* Status filter bar — underline marks the active tab */}
      <View style={styles.tabs}>
        <StatusTab
          label="ORDERS"
          count={activeGroups.length}
          color={colors.statusRed}
          active={tab === "orders"}
          large={isTablet}
          onPress={() => setTab("orders")}
        />
        <StatusTab
          label="TAKEAWAY"
          count={takeawayGroups.length}
          color={colors.statusBlue}
          active={tab === "takeaway"}
          large={isTablet}
          onPress={() => setTab("takeaway")}
        />
        <StatusTab
          label="ADDITIONAL"
          count={additionalGroups.length}
          color={colors.statusIndigo}
          active={tab === "additional"}
          large={isTablet}
          onPress={() => setTab("additional")}
        />
        <StatusTab
          label="COMPLETED"
          count={doneGroups.length}
          color={colors.statusGreen}
          active={tab === "completed"}
          large={isTablet}
          onPress={() => setTab("completed")}
        />
      </View>

      {/* Board */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn’t load tickets.</Text>
          <Text style={styles.emptySub}>{error.message}</Text>
        </View>
      ) : (
        <View
          style={styles.gridWrap}
          onLayout={(e) => setGridH(e.nativeEvent.layout.height)}
        >
          {cardH > 0 && (
            <FlatList
              // RN cannot change `numColumns` on a live list — remounting on
              // the count is what lets the board re-flow across a rotation.
              key={`board-${cols}`}
              data={gridData}
              keyExtractor={(g) => g.key}
              numColumns={cols}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={{
                flexGrow: 1, // lets the empty state center itself
                paddingBottom: insets.bottom + space.s4,
              }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) =>
                "spacer" in item ? (
                  <View style={styles.cell} />
                ) : (
                  <View style={[styles.cell, { height: cardH }]}>
                    <TableTicketCard
                      group={item}
                      queue={index + 1}
                      onPress={() => setSelectedKey(item.key)}
                    />
                  </View>
                )
              }
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={styles.emptyText}>Nothing here.</Text>
                  <Text style={styles.emptySub}>{EMPTY_COPY[tab]}</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* Tap-a-card detail popup */}
      {selectedGroup && (
        <TicketDetailSheet
          group={selectedGroup}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </View>
  );
}

function StatusTab({
  label,
  count,
  color,
  active,
  large,
  onPress,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  /** Tablet sizing — the bar is read from across the kitchen, not in hand. */
  large?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      // Switching board is moving between choices, so it ticks rather than
      // taps — and re-tapping the tab you're already on stays silent.
      onPressIn={active ? undefined : feel.select}
      style={({ pressed }) => [
        styles.tab,
        large && styles.tabLarge,
        active && { borderBottomColor: color },
        pressed && styles.tabPressed,
      ]}
    >
      <Text
        style={[styles.tabLabel, large && styles.tabLabelLarge, { color }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View
        style={[
          styles.tabBadge,
          large && styles.tabBadgeLarge,
          { backgroundColor: color },
        ]}
      >
        <Text style={[styles.tabBadgeText, large && styles.tabBadgeTextLarge]}>
          {count}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  brand: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.primary,
    letterSpacing: 0.3,
  },
  kitchenTag: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  tabs: {
    flexDirection: "row",
    marginBottom: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1,
    paddingVertical: space.s2 + 2,
    paddingHorizontal: space.s1,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
    marginBottom: -1, // active underline sits on the bar's hairline
  },
  tabLarge: {
    paddingVertical: space.s3,
    gap: space.s2,
  },
  tabPressed: {
    opacity: 0.7,
  },
  tabLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  tabLabelLarge: {
    fontSize: 14,
    letterSpacing: 0.6,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeLarge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
  },
  tabBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    color: colors.textInverse,
  },
  tabBadgeTextLarge: {
    fontSize: 12,
  },
  gridWrap: {
    flex: 1,
    paddingHorizontal: space.s4,
  },
  gridRow: {
    gap: GAP,
    marginBottom: GAP,
  },
  cell: {
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
});
