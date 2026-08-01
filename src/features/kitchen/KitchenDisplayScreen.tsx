/**
 * Kitchen Display (KDS) — live per-table board with the red/orange/green
 * status system.
 *
 * Three underline-style filter tabs with live circular counts:
 *   ORDERS (red)      — every table with an active ticket (new/preparing/ready)
 *   ADDITIONAL (orange) — tables with a 2nd+ active ticket (a later round)
 *   COMPLETED (green) — today's completed tickets, newest first
 *
 * Cards are one per table (see groupKots) in a high-density 3-column grid
 * sized so exactly 3 rows fit the screen; the list scrolls to reveal more
 * tables. Each card shows its 1-based FIFO queue position. Fully real-time
 * via the ported hooks; writes only through kdsApi.
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
import { colors, fonts, radius, space } from "@/theme/theme";
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

  // Pad the last row so a lone card doesn't stretch across the grid.
  const gridData: GridEntry[] = useMemo(() => {
    const d: GridEntry[] = [...visible];
    while (d.length % COLS !== 0)
      d.push({ key: `spacer-${d.length}`, spacer: true });
    return d;
  }, [visible]);

  // Exactly ROWS rows visible: card height derived from the measured grid.
  const cardH = gridH > 0 ? Math.floor((gridH - ROWS * GAP) / ROWS) : 0;

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
        <Text style={styles.brand}>SADA POS</Text>
        <Text style={styles.kitchenTag}>KITCHEN</Text>
      </View>

      {/* Status filter bar — underline marks the active tab */}
      <View style={styles.tabs}>
        <StatusTab
          label="ORDERS"
          count={activeGroups.length}
          color={colors.statusRed}
          active={tab === "orders"}
          onPress={() => setTab("orders")}
        />
        <StatusTab
          label="TAKEAWAY"
          count={takeawayGroups.length}
          color={colors.statusBlue}
          active={tab === "takeaway"}
          onPress={() => setTab("takeaway")}
        />
        <StatusTab
          label="ADDITIONAL"
          count={additionalGroups.length}
          color={colors.statusIndigo}
          active={tab === "additional"}
          onPress={() => setTab("additional")}
        />
        <StatusTab
          label="COMPLETED"
          count={doneGroups.length}
          color={colors.statusGreen}
          active={tab === "completed"}
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
              data={gridData}
              keyExtractor={(g) => g.key}
              numColumns={COLS}
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
  onPress,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active && { borderBottomColor: color },
        pressed && styles.tabPressed,
      ]}
    >
      <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.tabBadge, { backgroundColor: color }]}>
        <Text style={styles.tabBadgeText}>{count}</Text>
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
  tabPressed: {
    opacity: 0.7,
  },
  tabLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    color: colors.textInverse,
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
