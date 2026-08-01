/**
 * A single menu item card for the admin Menu Management grid. Styled like the
 * New Order grid card (square image, name, green price) but with management
 * controls: an enable/disable Switch and edit / delete actions.
 */
import { memo } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Image } from "expo-image";
import { formatMoney } from "@/lib/money";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { MenuItemDoc } from "./useMenuData";

interface MenuItemCardProps {
  item: MenuItemDoc;
  onEdit: (item: MenuItemDoc) => void;
  onDelete: (item: MenuItemDoc) => void;
  onToggleEnabled: (item: MenuItemDoc, enabled: boolean) => void;
}

function MenuItemCardImpl({
  item,
  onEdit,
  onDelete,
  onToggleEnabled,
}: MenuItemCardProps) {
  return (
    <View style={[styles.card, !item.enabled && styles.cardDisabled]}>
      <Pressable
        onPress={() => onEdit(item)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {item.imageUrl ? (
          <Image
            style={styles.image}
            source={{ uri: item.imageUrl }}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={item.id}
          />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <Text style={styles.placeholderIcon}>🍽</Text>
          </View>
        )}
      </Pressable>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.price}>{formatMoney(item.price)}</Text>
        {item.sku ? (
          <Text style={styles.sku} numberOfLines={1}>
            SKU: {item.sku}
          </Text>
        ) : null}

        <View style={styles.controls}>
          <View style={styles.switchRow}>
            <Switch
              value={item.enabled}
              onValueChange={(v) => onToggleEnabled(item, v)}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
            <Text style={styles.switchLabel}>
              {item.enabled ? "Available" : "Hidden"}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => onEdit(item)}
            >
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => onDelete(item)}
            >
              <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

export const MenuItemCard = memo(MenuItemCardImpl);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: colors.surfaceMuted,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderIcon: {
    fontSize: 32,
    color: colors.textMuted,
  },
  body: {
    padding: space.s3,
    gap: space.s1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  price: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  sku: {
    fontSize: 11,
    color: colors.textMuted,
  },
  controls: {
    marginTop: space.s2,
    gap: space.s2,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
  },
  switchLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: "row",
    gap: space.s3,
  },
  actionBtn: {
    paddingVertical: space.s1,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  deleteText: {
    color: colors.danger,
  },
});
