/**
 * KDS card — ONE per table, drawn as the paper ticket the kitchen already
 * reads, with every round of that table's order folded into a single dish list.
 *
 * When a table orders again, the new dishes join the ticket already on the
 * board instead of starting a card of their own — the kitchen cooks for a
 * table, and a second round that lands somewhere else in the queue gets plated
 * and run out on its own. What makes that safe is that the later rounds are
 * HIGHLIGHTED: each one sits in its own tinted block under an "ADDED · KOT n ·
 * time" strip, so a cook who already read this ticket can see at a glance
 * exactly which lines are new to them. The S.N column keeps counting across
 * rounds, because it numbers the table's dishes, not the paperwork.
 *
 * The layout is the printed KOT: number and table centred at the top, the
 * order meta block, a dashed rule, an S.N / Dishes / QTY table, the
 * dishes/qty total, and one COMPLETE action (which completes every round).
 * Cards size to their contents — the board scrolls rather than truncating, so
 * every line of every ticket is readable without opening anything. Tapping
 * still opens the detail sheet for notes, reprint and Start/Ready.
 *
 * Status rides on a coloured top edge and the elapsed label (RED = new,
 * INDIGO = an additional round is in play, GREEN = ready), because a receipt
 * with a coloured stripe still reads as a receipt. Writes go only through
 * `kdsApi` (kitchen may change nothing but status/printedCount —
 * firestore.rules).
 */
import { memo, useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, fonts, radius, space } from "@/theme/theme";
import { dayKey, formatDayKeyFull, formatTimeIST } from "@/lib/date";
import { animateNextLayout, feel } from "@/lib/feedback";
import { ElapsedTime } from "@/components/ElapsedTime";
import type { Kot, KotItem } from "@/types/models";
import { completeGroup } from "./groupActions";
import {
  additionalItemCount,
  hasAdditionalRound,
  type LiveKot,
  type TableGroup,
} from "./groupKots";

function orderTypeLabel(t: Kot["orderType"]): string {
  switch (t) {
    case "dine-in":
      return "Dine In";
    case "takeaway":
      return "Takeaway";
    case "delivery":
      return "Delivery";
    default:
      return t;
  }
}

/** "11 Aug 2026, 12:15 AM" — the printed KOT's own date line. */
function firedAt(kot: LiveKot): string {
  if (!kot.createdAt) return "—";
  const d = kot.createdAt.toDate();
  return `${formatDayKeyFull(dayKey(d))}, ${formatTimeIST(d)}`;
}

export const TableTicketCard = memo(function TableTicketCard({
  group,
  onPress,
  onCompleteOverride,
}: {
  group: TableGroup;
  /** Tapping the card (outside the button) opens the detail sheet. */
  onPress: () => void;
  /**
   * Handle COMPLETE here instead of writing to Firestore.
   *
   * The onboarding practice run mounts this exact card so a new owner learns
   * the board they will actually use, rather than a drawing of it — but that
   * run must leave no trace, so it cannot be allowed to complete a ticket
   * that does not exist. Absent (every real board) the card behaves exactly
   * as it always has.
   */
  onCompleteOverride?: () => void;
}) {
  const additional = hasAdditionalRound(group);
  const accent = group.completed
    ? colors.statusGreen
    : additional
      ? colors.statusIndigo
      : colors.statusRed;

  const first = group.tickets[0];

  // Each round keeps its own lines (so it can be tinted as a block) but the
  // S.N column runs on across them — `from` is where each round starts.
  let running = 0;
  const rounds = group.tickets.map((t) => {
    const lines = t.items.filter((it) => !it.voided);
    const from = running;
    running += lines.length;
    return { kot: t, lines, from };
  });
  const dishes = running;
  const qty = rounds.reduce(
    (n, r) => n + r.lines.reduce((m, it) => m + it.qty, 0),
    0
  );

  const onComplete = useCallback(() => {
    animateNextLayout(); // the card leaves the board on status change
    if (onCompleteOverride) {
      onCompleteOverride();
      feel.success();
      return;
    }
    completeGroup(group)
      // Marking a table's food done is the kitchen's whole job — it earns a
      // confirm, and the chef's hands are usually busy enough that the pulse
      // is the only acknowledgement they'll actually notice.
      .then(() => feel.success())
      .catch((e) => {
        feel.error();
        Alert.alert(
          "Couldn’t update ticket",
          e instanceof Error ? e.message : String(e)
        );
      });
  }, [group, onCompleteOverride]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={feel.press} // the detail sheet is about to come up
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {/* Status edge — the only colour on an otherwise paper-white ticket */}
      <View style={[styles.statusEdge, { backgroundColor: accent }]} />

      <View style={styles.body}>
        {/* ── Ticket head ──────────────────────────────────────────────── */}
        <Text style={styles.kotNumber}>KOT {first.ticketNumber}</Text>
        <Text style={styles.tableLabel} numberOfLines={2}>
          {group.tableLabel}
        </Text>
        {additional && (
          <View style={styles.addedBadge}>
            <Text style={styles.addedBadgeText}>
              +{additionalItemCount(group)} ADDED
            </Text>
          </View>
        )}

        {/* ── Meta ─────────────────────────────────────────────────────── */}
        <View style={styles.meta}>
          <Text style={styles.metaText}>
            Type: {orderTypeLabel(first.orderType)}
          </Text>
          <Text style={styles.metaText}>Order At: {firedAt(first)}</Text>
          <ElapsedTime
            createdAt={first.createdAt}
            intervalMs={30000}
            style={[styles.ago, { color: accent }]}
          />
        </View>

        {/* ── Dishes ───────────────────────────────────────────────────── */}
        <View style={styles.rule} />
        <View style={styles.itemRow}>
          <Text style={[styles.colHead, styles.colSn]}>S.N</Text>
          <Text style={[styles.colHead, styles.colName]}>Dishes</Text>
          <Text style={[styles.colHead, styles.colQty]}>QTY</Text>
        </View>
        <View style={styles.rule} />

        {rounds.map((r, round) =>
          round === 0 ? (
            <View key={r.kot.id} style={styles.items}>
              {r.lines.map((it, i) => (
                <ItemLine key={it.lineId} item={it} sn={r.from + i + 1} />
              ))}
            </View>
          ) : (
            <View key={r.kot.id} style={styles.addedBlock}>
              <Text style={styles.addedStrip}>
                ADDED · KOT {r.kot.ticketNumber} ·{" "}
                {r.kot.createdAt ? formatTimeIST(r.kot.createdAt.toDate()) : "—"}
              </Text>
              <View style={styles.items}>
                {r.lines.map((it, i) => (
                  <ItemLine key={it.lineId} item={it} sn={r.from + i + 1} added />
                ))}
              </View>
            </View>
          )
        )}

        {/* ── Total ────────────────────────────────────────────────────── */}
        <View style={styles.rule} />
        <View style={styles.itemRow}>
          <Text style={[styles.totalText, styles.totalLabel]}>
            Total (Dishes/QTY)
          </Text>
          <Text style={styles.totalText}>
            {dishes}/{qty}
          </Text>
        </View>
        <View style={styles.rule} />

        {/* ── Action ───────────────────────────────────────────────────── */}
        <Pressable
          onPress={onComplete}
          onPressIn={feel.press}
          style={({ pressed }) => [
            styles.completeBtn,
            { backgroundColor: accent },
            pressed && styles.pressed,
          ]}
        >
          <MaterialCommunityIcons
            name="chef-hat"
            size={14}
            color={colors.textInverse}
          />
          <Text style={styles.completeText} numberOfLines={1}>
            COMPLETE
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

/** One dish row. `added` tints it as belonging to a later round. */
function ItemLine({
  item,
  sn,
  added,
}: {
  item: KotItem;
  sn: number;
  added?: boolean;
}) {
  return (
    <View style={styles.itemRow}>
      <Text style={[styles.itemText, styles.colSn, added && styles.addedText]}>
        {sn}.
      </Text>
      <View style={styles.colName}>
        <Text style={[styles.itemText, added && styles.addedText]}>
          {item.name}
        </Text>
        {!!item.notes && <Text style={styles.noteText}>{item.notes}</Text>}
      </View>
      <Text style={[styles.itemText, styles.colQty, added && styles.addedText]}>
        {item.qty}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.9,
  },
  pressed: {
    opacity: 0.8,
  },
  statusEdge: {
    height: 4,
  },
  body: {
    padding: space.s3,
  },
  kotNumber: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    lineHeight: 20,
    color: colors.text,
    textAlign: "center",
  },
  tableLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
    textAlign: "center",
    marginTop: 2,
  },
  addedBadge: {
    alignSelf: "center",
    marginTop: space.s1,
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.statusIndigoSoft,
  },
  addedBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: colors.statusIndigo,
  },
  meta: {
    marginTop: space.s2,
    marginBottom: space.s2,
    gap: 1,
  },
  metaText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  ago: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  /** The printed KOT's dashed separator. Radius-free so Android draws it. */
  rule: {
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    marginVertical: space.s2,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s1,
  },
  colHead: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  colSn: {
    width: 20,
  },
  colName: {
    flex: 1,
  },
  colQty: {
    minWidth: 24,
    textAlign: "right",
  },
  items: {
    gap: space.s2,
  },
  itemText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
  },
  noteText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },

  // ── A later round ───────────────────────────────────────────────────────
  // Tinted block + a left rule, so the new lines read as new from across the
  // kitchen and not only up close.
  addedBlock: {
    marginTop: space.s2,
    paddingVertical: space.s2,
    paddingLeft: space.s2,
    paddingRight: space.s1,
    marginLeft: -space.s1,
    borderLeftWidth: 3,
    borderLeftColor: colors.statusIndigo,
    borderRadius: radius.sm,
    backgroundColor: colors.statusIndigoSoft,
    gap: space.s2,
  },
  addedStrip: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: colors.statusIndigo,
  },
  addedText: {
    color: colors.statusIndigo,
  },

  totalText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.text,
  },
  totalLabel: {
    flex: 1,
  },
  completeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1,
    height: 38,
    borderRadius: radius.sm,
    paddingHorizontal: space.s1,
  },
  completeText: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 0.2,
    color: colors.textInverse,
  },
});
