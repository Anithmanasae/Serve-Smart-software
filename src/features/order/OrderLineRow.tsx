/**
 * A single line row inside the Current Order sheet.
 *
 * Compact one-row layout: name (with unit price + optional note underneath),
 * the `−  qty  +` stepper, and the line total all sit on one line so the
 * waiter can review many items without scrolling. The "Special instructions"
 * field is opt-in — it only expands when the waiter taps "✎ Add note" (or an
 * existing note), and collapses back to inline text once editing ends.
 *
 * Un-sent (`pending`) lines are editable (qty 0 removes the line). Once a
 * line has been fired to the kitchen it locks and shows its live `kotStatus`
 * so the waiter can watch kitchen progress.
 */
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatMoney } from "@/lib/money";
import { PressableScale } from "@/components/PressableScale";
import { colors, fonts, radius, space } from "@/theme/theme";
import type { KotItemStatus, OrderItem } from "@/types/models";

interface OrderLineRowProps {
  line: OrderItem;
  /** Commit a new quantity (0 removes the line). Pending lines only. */
  onQty: (qty: number) => void;
  /** Commit special-instructions text. Pending lines only. */
  onNotes: (notes: string) => void;
}

const STATUS_LABEL: Record<KotItemStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
};

function OrderLineRowImpl({ line, onQty, onNotes }: OrderLineRowProps) {
  const editable = line.kotStatus === "pending" && !line.voided;
  const [notes, setNotes] = useState(line.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);

  // Keep local field in sync when the underlying line changes remotely.
  useEffect(() => {
    setNotes(line.notes ?? "");
  }, [line.notes]);

  const savedNote = (line.notes ?? "").trim();

  return (
    <View style={styles.row}>
      <View style={styles.headerRow}>
        <View style={styles.nameCol}>
          <Text style={styles.name} numberOfLines={2}>
            {line.name}
          </Text>
          <View style={styles.subRow}>
            <Text style={styles.price}>{formatMoney(line.price)} each</Text>
            {editable && !notesOpen ? (
              <Pressable
                hitSlop={8}
                onPress={() => setNotesOpen(true)}
                style={styles.noteToggle}
              >
                {savedNote ? (
                  <Text style={styles.noteInline} numberOfLines={2}>
                    · “{savedNote}”
                  </Text>
                ) : (
                  <Text style={styles.noteLink}>· ✎ Add note</Text>
                )}
              </Pressable>
            ) : null}
            {!editable && savedNote ? (
              <Text style={styles.noteInline} numberOfLines={2}>
                · “{savedNote}”
              </Text>
            ) : null}
          </View>
        </View>

        {editable ? (
          <View style={styles.stepper}>
            <PressableScale
              hitSlop={8}
              style={styles.stepBtn}
              onPress={() => onQty(line.qty - 1)}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </PressableScale>
            <Text style={styles.stepQty}>{line.qty}</Text>
            <PressableScale
              hitSlop={8}
              style={styles.stepBtn}
              onPress={() => onQty(line.qty + 1)}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>
              {STATUS_LABEL[line.kotStatus]}
            </Text>
          </View>
        )}

        <Text style={styles.lineTotal}>
          {formatMoney(line.price * line.qty)}
        </Text>
      </View>

      {editable && notesOpen ? (
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          autoFocus
          onEndEditing={() => {
            setNotesOpen(false);
            const trimmed = notes.trim();
            if (trimmed !== (line.notes ?? "")) onNotes(trimmed);
          }}
          placeholder="Special instructions (e.g., extra ice, no garnish…)"
          placeholderTextColor={colors.textMuted}
          multiline
        />
      ) : null}
    </View>
  );
}

export const OrderLineRow = memo(OrderLineRowImpl);

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space.s2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
  },
  nameCol: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.s1,
  },
  price: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  noteToggle: {
    flexShrink: 1,
  },
  noteLink: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.primary,
  },
  noteInline: {
    fontFamily: fonts.regular,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.textMuted,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.bold,
    lineHeight: 20,
  },
  stepQty: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  statusText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primaryDark,
  },
  lineTotal: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text,
    minWidth: 68,
    textAlign: "right",
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    minHeight: 42,
  },
});
