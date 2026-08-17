/**
 * The left-hand category rail — on the tablet AND, since the redesign, on the
 * phone.
 *
 * It replaced a row of horizontal chips, which is the change worth explaining:
 * chips put the categories on ONE axis with the grid's own scroll, so finding
 * "Desserts" meant swiping sideways through a strip that gave no clue how much
 * was off-screen. A vertical rail shows the whole menu's shape at once and
 * costs only the width of the words — on a phone the grid drops from two
 * columns to a comfortable one-and-a-bit, which is a fair trade for never
 * hunting for a category again.
 *
 * The rail owns nothing but which id is active; selection drives the grid.
 *
 * Counts are of ENABLED items only, so the number next to a category matches
 * what tapping it will show. A category whose items are all disabled still
 * appears (the owner turned the items off, not the category) and reads "0".
 */
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "@/theme/theme";
import type { MenuCategory } from "@/types/models";

/** Sentinel id for the "All Items" row — shared with OrderScreen. */
export const ALL_CATEGORIES = "__all__";

interface OrderCategoryRailProps {
  categories: MenuCategory[];
  /** categoryId -> number of enabled items in it. */
  countByCategory: Map<string, number>;
  /** Enabled items across every category, for the "All Items" row. */
  totalCount: number;
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Phone. Trims the rail's own padding and drops a point of type, so the
   * width it costs the grid buys category NAME rather than whitespace — the
   * card beside it is only ~110dp and cannot spare any.
   *
   * Row height is NOT reduced: 48dp is a touch target, and this is a control
   * a waiter hits all shift with a thumb, on the hand that is also holding
   * the tablet.
   */
  compact?: boolean;
}

function OrderCategoryRailImpl({
  categories,
  countByCategory,
  totalCount,
  activeId,
  onSelect,
  compact,
}: OrderCategoryRailProps) {
  return (
    <View style={[styles.rail, compact && styles.railCompact]}>
      {/* None on a phone. "CATEGORIES" does not fit a ~100dp rail at any size
          worth reading — it broke to "CATEGORI / ES", and truncating it to
          "CATEGORIE…" was no better. A vertical list of category names beside
          a grid of food needs no label to say what it is, and the row it
          costs is a row the rail can spend on an actual category. */}
      {compact ? null : <Text style={styles.heading}>Categories</Text>}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        <RailRow
          label="All Items"
          count={totalCount}
          active={activeId === ALL_CATEGORIES}
          compact={compact}
          onPress={() => onSelect(ALL_CATEGORIES)}
        />
        {categories.map((c) => (
          <RailRow
            key={c.id}
            label={c.name}
            count={countByCategory.get(c.id) ?? 0}
            active={activeId === c.id}
            compact={compact}
            onPress={() => onSelect(c.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function RailRow({
  label,
  count,
  active,
  compact,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        active && styles.rowActive,
        pressed && !active && styles.rowPressed,
      ]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={[
          styles.rowLabel,
          compact && styles.rowLabelCompact,
          active && styles.rowLabelActive,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text style={[styles.rowCount, active && styles.rowCountActive]}>
        {count}
      </Text>
    </Pressable>
  );
}

export const OrderCategoryRail = memo(OrderCategoryRailImpl);

const styles = StyleSheet.create({
  rail: {
    flex: 1,
    paddingLeft: space.s3,
    paddingRight: space.s2,
  },
  railCompact: {
    paddingLeft: space.s2,
    paddingRight: space.s1,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.textMuted,
    paddingHorizontal: space.s3,
    paddingBottom: space.s2,
  },
  list: {
    gap: space.s1,
    paddingBottom: space.s6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    // 48dp+ tall: a rail row is a primary touch target all shift long.
    minHeight: 48,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.md,
  },
  rowCompact: {
    gap: space.s1,
    paddingHorizontal: space.s2,
  },
  // Solid, not tinted. The rail sits directly against the grid of white
  // cards, and a soft wash reads there as "slightly different card" rather
  // than as the one row driving everything to its right.
  rowActive: {
    backgroundColor: colors.primary,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  rowLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.text,
  },
  // 14, not 15: one point is the difference between "Chinese" on one line and
  // "Chines / e" on two, and a category the waiter has to reassemble is worse
  // than one set a point smaller.
  rowLabelCompact: {
    fontSize: 14,
  },
  rowLabelActive: {
    fontFamily: fonts.extrabold,
    color: colors.textInverse,
  },
  rowCount: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  rowCountActive: {
    color: colors.textInverse,
    opacity: 0.75,
  },
});
