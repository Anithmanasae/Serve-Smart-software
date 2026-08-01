/**
 * Menu Management (admin) — CRUD for menu items and categories, styled like the
 * New Order grid (white cards on gray canvas, green primary, rounded).
 *
 * All data is live via the ported hooks (useMenuCategories / useMenuItems) and
 * every write goes through menuApi (never Firestore directly from the screen).
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, space } from "@/theme/theme";
import { deleteMenuItem, setMenuItemEnabled } from "./menuApi";
import { useMenuCategories, useMenuItems } from "./useMenuData";
import type { MenuCategoryDoc, MenuItemDoc } from "./useMenuData";
import { MenuItemCard } from "./MenuItemCard";
import { MenuItemForm } from "./MenuItemForm";
import { CategoryManager } from "./CategoryManager";

const ALL = "__all__";

/** Hard cap on the menu size — keeps grids and realtime listeners snappy. */
export const MAX_MENU_ITEMS = 1000;

export function MenuManagementScreen() {
  const insets = useSafeAreaInsets();
  const categoriesState = useMenuCategories();
  const itemsState = useMenuItems();

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [formVisible, setFormVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItemDoc | null>(null);
  const [formCategoryId, setFormCategoryId] = useState<string | undefined>();
  const [categoryManagerVisible, setCategoryManagerVisible] = useState(false);

  const enabledCategories = useMemo(
    () => categoriesState.data.filter((c) => c.enabled),
    [categoriesState.data]
  );

  // Category id -> category, for section headers (including disabled ones so
  // their items are still shown/manageable).
  const categoryById = useMemo(() => {
    const map = new Map<string, MenuCategoryDoc>();
    for (const c of categoriesState.data) map.set(c.id, c);
    return map;
  }, [categoriesState.data]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return itemsState.data.filter((it) => {
      if (activeCategory !== ALL && it.categoryId !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.sku ? it.sku.toLowerCase().includes(q) : false)
      );
    });
  }, [itemsState.data, activeCategory, search]);

  // Group filtered items under their category, ordered by category sortOrder.
  const sections = useMemo(() => {
    const groups = new Map<string, MenuItemDoc[]>();
    for (const it of filteredItems) {
      const arr = groups.get(it.categoryId) ?? [];
      arr.push(it);
      groups.set(it.categoryId, arr);
    }
    const ordered = [...groups.entries()].map(([categoryId, items]) => ({
      categoryId,
      category: categoryById.get(categoryId) ?? null,
      items,
    }));
    ordered.sort((a, b) => {
      const sa = a.category?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const sb = b.category?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return sa - sb;
    });
    return ordered;
  }, [filteredItems, categoryById]);

  const atCapacity = itemsState.data.length >= MAX_MENU_ITEMS;

  const openAdd = () => {
    if (atCapacity) {
      Alert.alert(
        "Menu is full",
        `The menu can hold up to ${MAX_MENU_ITEMS} items. Delete an item before adding a new one.`
      );
      return;
    }
    setEditingItem(null);
    setFormCategoryId(
      activeCategory !== ALL ? activeCategory : enabledCategories[0]?.id
    );
    setFormVisible(true);
  };

  const openEdit = (item: MenuItemDoc) => {
    setEditingItem(item);
    setFormCategoryId(undefined);
    setFormVisible(true);
  };

  const confirmDelete = (item: MenuItemDoc) => {
    Alert.alert("Delete item", `Delete "${item.name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteMenuItem(item.id).catch((e) =>
            Alert.alert("Error", e instanceof Error ? e.message : "Failed.")
          );
        },
      },
    ]);
  };

  const toggleEnabled = (item: MenuItemDoc, enabled: boolean) => {
    setMenuItemEnabled(item.id, enabled).catch((e) =>
      Alert.alert("Error", e instanceof Error ? e.message : "Failed.")
    );
  };

  const loading = categoriesState.loading || itemsState.loading;
  const errorState = categoriesState.error || itemsState.error;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Menu Management</Text>
          <Text style={styles.headerSubtitle}>
            {itemsState.loading
              ? "Manage and organize your offerings."
              : `${itemsState.data.length} of ${MAX_MENU_ITEMS} items`}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.manageBtn, pressed && styles.pressed]}
          onPress={() => setCategoryManagerVisible(true)}
        >
          <Text style={styles.manageBtnText}>Categories</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search menu items or SKUs…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      </View>

      {/* Category chips */}
      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              activeCategory === ALL && styles.chipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setActiveCategory(ALL)}
          >
            <Text
              style={[
                styles.chipText,
                activeCategory === ALL && styles.chipTextActive,
              ]}
            >
              All Items
            </Text>
          </Pressable>
          {enabledCategories.map((c) => {
            const active = activeCategory === c.id;
            return (
              <Pressable
                key={c.id}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setActiveCategory(c.id)}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : errorState ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorState.message}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
        >
          {sections.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>No items found.</Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.categoryId} style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {section.category?.name ?? "Uncategorized"}
                  {section.category && !section.category.enabled
                    ? "  (hidden)"
                    : ""}
                </Text>
                <View style={styles.grid}>
                  {section.items.map((item) => (
                    <View key={item.id} style={styles.gridCell}>
                      <MenuItemCard
                        item={item}
                        onEdit={openEdit}
                        onDelete={confirmDelete}
                        onToggleEnabled={toggleEnabled}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Floating add button */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + space.s4 },
          pressed && styles.fabPressed,
        ]}
        onPress={openAdd}
      >
        <Text style={styles.fabText}>＋ Add Item</Text>
      </Pressable>

      <MenuItemForm
        visible={formVisible}
        item={editingItem}
        categories={enabledCategories}
        defaultCategoryId={formCategoryId}
        onClose={() => setFormVisible(false)}
      />
      <CategoryManager
        visible={categoryManagerVisible}
        categories={categoriesState.data}
        onClose={() => setCategoryManagerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pressed: {
    opacity: 0.7,
  },
  fabPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    paddingBottom: space.s2,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  manageBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    marginHorizontal: space.s4,
    marginVertical: space.s2,
    paddingHorizontal: space.s3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    fontSize: 14,
    color: colors.textMuted,
  },
  searchInput: {
    flex: 1,
    paddingVertical: space.s3,
    fontSize: 15,
    color: colors.text,
  },
  chipsWrap: {
    paddingBottom: space.s2,
  },
  chipsRow: {
    paddingHorizontal: space.s4,
    gap: space.s2,
  },
  chip: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.textInverse,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
  },
  section: {
    marginBottom: space.s5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: space.s3,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -space.s2,
  },
  gridCell: {
    width: "50%",
    paddingHorizontal: space.s2,
    marginBottom: space.s3,
  },
  center: {
    paddingVertical: space.s6,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: space.s4,
    backgroundColor: colors.primary,
    paddingHorizontal: space.s5,
    paddingVertical: space.s3,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  fabText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "700",
  },
});
