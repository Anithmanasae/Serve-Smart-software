/**
 * KDS card — ONE per table, folding every active ticket for that table.
 *
 * High-density tile for the 3×3 board. The status color system rides on a
 * slim 20px solid block down the left edge (RED = active first-round order,
 * ORANGE = the table has an additional round, GREEN = completed) holding the
 * card's queue position in white. White body with a 1px hairline border — no
 * shadows. Header pairs the table name with the exact fire time, the live
 * "Xm ago" elapsed label sits on its own line, and items render as a bullet
 * list that wraps freely — never truncates.
 *
 * One full-width COMPLETE action (chef-hat icon) tinted with the status
 * color; completed tickets show a static DONE state instead of a button that
 * silently no-ops. It completes every active ticket in the group. Writes go
 * only through the ported `kdsApi` (kitchen may change nothing but
 * status/printedCount — firestore.rules).
 */
import { memo, useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, fonts, radius, space } from "@/theme/theme";
import { formatTimeIST } from "@/lib/date";
import { animateNextLayout, tapFeedback } from "@/lib/feedback";
import { ElapsedTime } from "@/components/ElapsedTime";
import { completeGroup } from "./groupActions";
import { hasAdditionalRound, type TableGroup } from "./groupKots";

const MAX_ITEM_LINES = 3;

/**
 * Long labels ("Takeaway", "Patio 2") wrap letter-by-letter in the narrow
 * 3-col cards, so compress them to a short code: "Patio 2" → "P2",
 * "Takeaway" → "TA", while "T4" stays as-is. The detail sheet still shows
 * the full name.
 */
function compactLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= 4) return trimmed;
  const words = trimmed.split(/\s+/);
  // Single long word ("Takeaway") → first two letters.
  if (words.length === 1) return trimmed.slice(0, 2).toUpperCase();
  // Multi-word → initials, keeping any numbers ("Patio 2" → "P2").
  return words.map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase())).join("");
}

export const TableTicketCard = memo(function TableTicketCard({
  group,
  queue,
  onPress,
}: {
  group: TableGroup;
  /** 1-based position in the visible FIFO queue — shown in the edge block. */
  queue: number;
  /** Tapping the card (outside the button) opens the detail sheet. */
  onPress: () => void;
}) {
  const additional = hasAdditionalRound(group);
  const accent = group.completed
    ? colors.statusGreen
    : additional
      ? colors.statusIndigo
      : colors.statusRed;

  const first = group.tickets[0];

  // Flatten items across rounds (later rounds are folded into the same list).
  const lines = group.tickets.flatMap((t) =>
    t.items
      .filter((it) => !it.voided)
      .map((it) => ({
        key: `${t.id}:${it.lineId}`,
        qty: it.qty,
        name: it.name,
      }))
  );
  const shown = lines.slice(0, MAX_ITEM_LINES);
  const hidden = lines.length - shown.length;

  const onComplete = useCallback(() => {
    tapFeedback();
    animateNextLayout(); // the card leaves this tab on status change
    completeGroup(group).catch((e) =>
      Alert.alert(
        "Couldn’t update ticket",
        e instanceof Error ? e.message : String(e)
      )
    );
  }, [group]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {/* Queue block — thick status-colored left edge */}
      <View style={[styles.queueBlock, { backgroundColor: accent }]}>
        <Text style={styles.queueText}>{queue}</Text>
      </View>

      <View style={styles.body}>
        {/* Table name · exact time, elapsed on its own line below */}
        <View style={styles.headerRow}>
          <Text style={styles.tableLabel} numberOfLines={1}>
            {compactLabel(group.tableLabel)}
          </Text>
          <Text style={styles.time}>
            {first.createdAt ? formatTimeIST(first.createdAt.toDate()) : "—"}
          </Text>
        </View>
        <ElapsedTime
          createdAt={first.createdAt}
          intervalMs={30000}
          style={[styles.ago, { color: accent }]}
        />

        {/* Items — wrap freely, never truncate */}
        <View style={styles.items}>
          {shown.map((l) => (
            <Text key={l.key} style={styles.itemText}>
              • {l.qty} x {l.name}
            </Text>
          ))}
          {hidden > 0 && <Text style={styles.moreText}>+{hidden} more…</Text>}
        </View>

        {/* Single full-width action, tinted with the status color */}
        {group.completed ? (
          <View style={[styles.completeBtn, { backgroundColor: accent }]}>
            <MaterialCommunityIcons
              name="chef-hat"
              size={12}
              color={colors.textInverse}
            />
            <Text
              style={styles.completeText}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              DONE
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={onComplete}
            style={({ pressed }) => [
              styles.completeBtn,
              { backgroundColor: accent },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="chef-hat"
              size={12}
              color={colors.textInverse}
            />
            <Text
              style={styles.completeText}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              COMPLETE
            </Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: "row",
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
  queueBlock: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  queueText: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    color: colors.textInverse,
  },
  body: {
    flex: 1,
    paddingHorizontal: space.s2,
    paddingVertical: space.s2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s1,
  },
  tableLabel: {
    flex: 1,
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 18,
    color: colors.text,
  },
  time: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 18,
    color: colors.textMuted,
  },
  ago: {
    fontFamily: fonts.bold,
    fontSize: 10,
    marginTop: 1,
  },
  items: {
    flex: 1,
    marginVertical: space.s1,
    gap: space.s1, // 4px breathing room between (possibly wrapped) items
    overflow: "hidden",
  },
  itemText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.text,
  },
  moreText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.textMuted,
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
    flexShrink: 1,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.2,
    color: colors.textInverse,
  },
});
