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
import { BrandHeader } from "@/components/BrandHeader";
import { Bone, Skeleton } from "@/components/Skeleton";
import { ProfileButton } from "@/components/ProfileButton";
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
 * The shortest a ticket may be drawn, from TableTicketCard's own box model:
 *
 *   96  fixed chrome (borders 2, body padding 16, header 18, elapsed ~14,
 *       items margin 8, COMPLETE button 38)
 * + 70  items at their worst — MAX_ITEM_LINES rows at lineHeight 15, the
 *       "+N more…" row a 4-item ticket adds, and the gaps between them
 * ─────
 *   166
 *
 * Rounded up for headroom, because the two "~" figures above are RN's default
 * line heights rather than measured ones. `items` is `overflow: hidden`, so
 * coming up short doesn't shrink the card — it silently eats the "+N more…"
 * line, which is exactly the cue telling the cook to tap for the rest of the
 * ticket. Losing that is worse than showing one row fewer.
 */
const MIN_CARD_H = 170;

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
      {/* App header. Kitchen staff see only this tab, so the profile button
          here is their one route to printer settings and sign-out. */}
      <BrandHeader
        right={
          <View style={styles.appBarEnd}>
            <Text style={styles.kitchenTag}>KITCHEN</Text>
            <ProfileButton />
          </View>
        }
      />

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
      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn’t load tickets.</Text>
          <Text style={styles.emptySub}>{error.message}</Text>
        </View>
      ) : (
        // The board measures itself before either state draws, so the grey
        // tickets are laid out on exactly the grid the real ones will use.
        <View
          style={styles.gridWrap}
          onLayout={(e) => setGridH(e.nativeEvent.layout.height)}
        >
          {cardH > 0 && loading && (
            <BoardSkeleton cols={cols} rows={rows} cardH={cardH} />
          )}
          {cardH > 0 && !loading && (
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

/**
 * The board mid-load: a full grid of grey tickets at the measured `cardH`.
 *
 * Filling every slot rather than showing three is deliberate here — a KDS is
 * read from across a kitchen as "how much work is on", and a half-empty grey
 * board would answer that question wrongly for the second or two before the
 * real tickets arrive. A full one says only "not yet".
 */
function BoardSkeleton({
  cols,
  rows,
  cardH,
}: {
  cols: number;
  rows: number;
  cardH: number;
}) {
  return (
    <Skeleton style={styles.skeletonBoard}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.skeletonRow}>
          {Array.from({ length: cols }, (_, c) => (
            <View key={c} style={[styles.cell, { height: cardH }]}>
              <View style={styles.skeletonCard}>
                {/* The queue-position stripe TableTicketCard paints in its
                    status colour. */}
                <Bone width={20} height="100%" round={0} />
                <View style={styles.skeletonBody}>
                  <View style={styles.skeletonHeader}>
                    <Bone width={52} height={15} />
                    <Bone width={28} height={11} />
                  </View>
                  <Bone width="92%" height={10} />
                  <Bone width="74%" height={10} />
                  <Bone width="84%" height={10} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
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
  appBarEnd: { flexDirection: "row", alignItems: "center", gap: space.s3 },
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

  // ── Loading placeholder ─────────────────────────────────────────────────
  // `skeletonRow` is `gridRow` plus the row direction FlatList supplies for
  // free via `columnWrapperStyle`; `skeletonCard` is TableTicketCard's frame.
  skeletonBoard: {
    flex: 1,
    overflow: "hidden",
  },
  skeletonRow: {
    flexDirection: "row",
    gap: GAP,
    marginBottom: GAP,
  },
  skeletonCard: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  skeletonBody: {
    flex: 1,
    paddingHorizontal: space.s2,
    paddingVertical: space.s2,
    gap: space.s2,
  },
  skeletonHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s1,
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
