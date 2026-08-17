/**
 * Kitchen Display (KDS) — live board of paper-style KOT tickets.
 *
 * ONE CARD PER TABLE, oldest first. When a table orders again, those dishes
 * join the card already on the board — highlighted, so a cook who has read
 * this ticket can see what's new (see TableTicketCard). That is why the board
 * needs no "additional" filter: the thing that tab existed to surface now
 * lives on the ticket itself, next to the food it belongs with. There is no
 * "completed" filter either — completing is the kitchen saying it's off the
 * board, and a KDS that keeps showing finished work stops answering "what's
 * left". The day's completed tickets are still in the cashier's screens and
 * in reports.
 *
 * Two filters remain, with live counts:
 *   ORDERS (red)     — every table with an active ticket (new/preparing/ready)
 *   TAKEAWAY (blue)  — the counter orders among them
 *
 * Cards size to their contents and are laid out in a masonry of 2 columns on a
 * phone (3–4 on a tablet), filled round-robin so reading order stays FIFO
 * left-to-right. The board scrolls: no ticket is ever truncated, and scrolling
 * far enough reveals every one of them. Fully real-time; writes only through
 * kdsApi.
 */
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { orderBy, query, where } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import { feel } from "@/lib/feedback";
import { useResponsive } from "@/lib/responsive";
import { colors, fonts, radius, space } from "@/theme/theme";
import { BrandHeader } from "@/components/BrandHeader";
import { Bone, Skeleton } from "@/components/Skeleton";
import { ProfileButton } from "@/components/ProfileButton";
import type { Kot } from "@/types/models";
import { groupActiveKots, type LiveKot } from "./groupKots";
import { NewKotAlertBanner, useNewKotAlerts } from "./newKotAlerts";
import { TableTicketCard } from "./TableTicketCard";
import { TicketDetailSheet } from "./TicketDetailSheet";

const GAP = space.s3;

type Tab = "orders" | "takeaway";

const EMPTY_COPY: Record<Tab, string> = {
  orders: "No active tickets — new KOTs appear here instantly.",
  takeaway: "No takeaway orders in the kitchen right now.",
};

/**
 * Deal `items` round-robin into `cols` columns.
 *
 * Round-robin rather than shortest-column packing: the cook reads the board as
 * a queue, so ticket 1 must be top-left and ticket 2 next to it. Balancing by
 * height would reorder the queue to make the columns pretty.
 */
function toColumns<T>(items: T[], cols: number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  items.forEach((item, i) => out[i % cols].push(item));
  return out;
}

export function KitchenDisplayScreen() {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const [tab, setTab] = useState<Tab>("orders");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Live query — identity stable across renders.
  const activeQuery = useMemo(
    () =>
      query(
        paths.kots(),
        where("status", "in", ["new", "preparing", "ready"]),
        orderBy("createdAt", "asc")
      ),
    []
  );

  const activeState = useCollectionData<Kot>(activeQuery);

  const groups = useMemo(
    () => groupActiveKots(activeState.data as LiveKot[]),
    [activeState.data]
  );
  // Counter orders (takeaway/delivery) — every ticket in a group shares one
  // order, so the first ticket's type describes the whole group.
  const takeawayGroups = useMemo(
    () => groups.filter((g) => g.tickets[0].orderType !== "dine-in"),
    [groups]
  );

  const visible = tab === "orders" ? groups : takeawayGroups;

  const cols = isTablet ? (width >= 1100 ? 4 : 3) : 2;
  const columns = useMemo(() => toColumns(visible, cols), [visible, cols]);

  // Announce incoming tickets — chime, haptic and banner. Fed the flat kot
  // list, not the groups: a table's second round adds no card, and that is
  // precisely the order a busy kitchen misses. The loading flag matters — see
  // the hook: without it the empty pre-snapshot state becomes the baseline and
  // the board announces itself on every launch.
  const newOrderAlert = useNewKotAlerts(
    activeState.data as LiveKot[],
    !activeState.loading
  );

  // Detail sheet target, resolved live so it tracks (and auto-closes on)
  // realtime changes — e.g. completing from the sheet drops the group.
  const selected = useMemo(
    () => (selectedKey ? (groups.find((g) => g.key === selectedKey) ?? null) : null),
    [selectedKey, groups]
  );

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
          count={groups.length}
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
      </View>

      {/* Board */}
      {activeState.error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn’t load tickets.</Text>
          <Text style={styles.emptySub}>{activeState.error.message}</Text>
        </View>
      ) : activeState.loading ? (
        <BoardSkeleton cols={cols} />
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nothing here.</Text>
          <Text style={styles.emptySub}>{EMPTY_COPY[tab]}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.board}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.s6 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.masonry}>
            {columns.map((col, i) => (
              <View key={i} style={styles.column}>
                {col.map((group) => (
                  <TableTicketCard
                    key={group.key}
                    group={group}
                    onPress={() => setSelectedKey(group.key)}
                  />
                ))}
              </View>
            ))}
          </View>
          {/* Counts TICKETS, not cards — a table's second round is another
              KOT the kitchen has to cook, even though it shares a card. */}
          <Text style={styles.totalKot}>
            Total KOT : {visible.reduce((n, g) => n + g.tickets.length, 0)}
          </Text>
        </ScrollView>
      )}

      {/* Tap-a-card detail popup */}
      {selected && (
        <TicketDetailSheet
          group={selected}
          onClose={() => setSelectedKey(null)}
        />
      )}

      {/* Last child, so the arrival banner sits over the board and the sheet. */}
      <NewKotAlertBanner alert={newOrderAlert} topOffset={insets.top + space.s2} />
    </View>
  );
}

/**
 * The board mid-load: paper-shaped grey tickets on the same masonry.
 *
 * Filling both columns rather than showing one card is deliberate — a KDS is
 * read from across a kitchen as "how much work is on", and a near-empty grey
 * board would answer that question wrongly for the second or two before the
 * real tickets arrive. A full one says only "not yet".
 */
function BoardSkeleton({ cols }: { cols: number }) {
  return (
    <Skeleton style={styles.board}>
      <View style={styles.masonry}>
        {Array.from({ length: cols }, (_, c) => (
          <View key={c} style={styles.column}>
            {Array.from({ length: 2 }, (_, r) => (
              <View key={r} style={styles.skeletonCard}>
                <Bone width="52%" height={16} />
                <Bone width="38%" height={13} />
                <View style={styles.skeletonGap} />
                <Bone width="80%" height={10} />
                <Bone width="90%" height={10} />
                <View style={styles.skeletonGap} />
                <Bone width="94%" height={12} />
                <Bone width="86%" height={12} />
                <Bone width="90%" height={12} />
                <View style={styles.skeletonGap} />
                <Bone width="100%" height={38} round={radius.sm} />
              </View>
            ))}
          </View>
        ))}
      </View>
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
  board: {
    flex: 1,
    paddingHorizontal: space.s4,
  },
  masonry: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: GAP,
  },
  column: {
    flex: 1,
    gap: GAP,
  },
  totalKot: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: space.s4,
  },

  // ── Loading placeholder ─────────────────────────────────────────────────
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s3,
    gap: space.s2,
    alignItems: "center",
  },
  skeletonGap: {
    height: space.s1,
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
