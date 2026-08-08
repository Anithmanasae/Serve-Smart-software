/**
 * The tablet's left-hand category rail.
 *
 * The same choice the phone offers as horizontal chips, given the vertical
 * space a tablet actually has: one tall list, every category legible at once,
 * no swiping to discover that "Desserts" exists. Selection drives the centre
 * grid — the rail owns nothing but which id is active.
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
}

function OrderCategoryRailImpl({
  categories,
  countByCategory,
  totalCount,
  activeId,
  onSelect,
}: OrderCategoryRailProps) {
  return (
    <View style={styles.rail}>
      <Text style={styles.heading}>Categories</Text>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        <RailRow
          label="All Items"
          count={totalCount}
          active={activeId === ALL_CATEGORIES}
          onPress={() => onSelect(ALL_CATEGORIES)}
        />
        {categories.map((c) => (
          <RailRow
            key={c.id}
            label={c.name}
            count={countByCategory.get(c.id) ?? 0}
            active={activeId === c.id}
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
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && !active && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <Text
        style={[styles.rowLabel, active && styles.rowLabelActive]}
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
  rowActive: {
    backgroundColor: colors.primarySoft,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  rowLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  rowLabelActive: {
    fontFamily: fonts.extrabold,
    color: colors.primary,
  },
  rowCount: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  rowCountActive: {
    color: colors.primary,
  },
});
