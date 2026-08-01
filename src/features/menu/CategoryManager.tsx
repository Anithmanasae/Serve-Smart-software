/**
 * Category manager modal — add / rename / delete / reorder (sortOrder) /
 * enable-disable. Reuses the ported category writes in menuApi. New category
 * ids come from expo-crypto's randomUUID (createMenuCategory expects a
 * caller-supplied id).
 */
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "@/theme/theme";
import {
  createMenuCategory,
  deleteMenuCategory,
  setMenuCategoryEnabled,
  setMenuCategorySortOrder,
  updateMenuCategory,
} from "./menuApi";
import type { MenuCategoryDoc } from "./useMenuData";

interface CategoryManagerProps {
  visible: boolean;
  categories: MenuCategoryDoc[];
  onClose: () => void;
}

export function CategoryManager({
  visible,
  categories,
  onClose,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    }
  };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const nextSort =
      categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    run(() =>
      createMenuCategory(randomUUID(), {
        name,
        sortOrder: nextSort,
        enabled: true,
      })
    );
    setNewName("");
  };

  const handleRename = (id: string) => {
    const name = editingName.trim();
    if (name) {
      run(() => updateMenuCategory(id, { name }));
    }
    setEditingId(null);
    setEditingName("");
  };

  // Swap sortOrder with the adjacent category (list is already sorted asc).
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const a = categories[index];
    const b = categories[target];
    run(async () => {
      await setMenuCategorySortOrder(a.id, b.sortOrder);
      await setMenuCategorySortOrder(b.id, a.sortOrder);
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s4 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Categories</Text>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={onClose}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="New category name"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              onPress={handleAdd}
            >
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {categories.map((c, index) => {
              const editing = editingId === c.id;
              return (
                <View key={c.id} style={styles.row}>
                  <View style={styles.reorder}>
                    <Pressable
                      hitSlop={8}
                      style={({ pressed }) => pressed && styles.pressed}
                      disabled={index === 0}
                      onPress={() => move(index, -1)}
                    >
                      <Text
                        style={[
                          styles.arrow,
                          index === 0 && styles.arrowDisabled,
                        ]}
                      >
                        ▲
                      </Text>
                    </Pressable>
                    <Pressable
                      hitSlop={8}
                      style={({ pressed }) => pressed && styles.pressed}
                      disabled={index === categories.length - 1}
                      onPress={() => move(index, 1)}
                    >
                      <Text
                        style={[
                          styles.arrow,
                          index === categories.length - 1 &&
                            styles.arrowDisabled,
                        ]}
                      >
                        ▼
                      </Text>
                    </Pressable>
                  </View>

                  {editing ? (
                    <TextInput
                      style={[styles.name, styles.nameInput]}
                      value={editingName}
                      onChangeText={setEditingName}
                      autoFocus
                      onSubmitEditing={() => handleRename(c.id)}
                      onBlur={() => handleRename(c.id)}
                      returnKeyType="done"
                    />
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.nameWrap,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => {
                        setEditingId(c.id);
                        setEditingName(c.name);
                      }}
                    >
                      <Text style={styles.name} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.editHint}>Rename</Text>
                    </Pressable>
                  )}

                  <Switch
                    value={c.enabled}
                    onValueChange={(v) =>
                      run(() => setMenuCategoryEnabled(c.id, v))
                    }
                    trackColor={{
                      true: colors.primary,
                      false: colors.borderStrong,
                    }}
                    thumbColor={colors.surface}
                  />

                  <Pressable
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}
                    onPress={() => run(() => deleteMenuCategory(c.id))}
                  >
                    <Text style={styles.delete}>Delete</Text>
                  </Pressable>
                </View>
              );
            })}
            {categories.length === 0 ? (
              <Text style={styles.empty}>No categories yet.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  close: {
    fontSize: 18,
    color: colors.textMuted,
  },
  addRow: {
    flexDirection: "row",
    gap: space.s2,
    padding: space.s4,
    paddingBottom: space.s2,
  },
  addInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontSize: 15,
    color: colors.text,
  },
  addBtn: {
    paddingHorizontal: space.s4,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: {
    color: colors.textInverse,
    fontWeight: "700",
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    paddingHorizontal: space.s4,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: space.s4,
    paddingBottom: space.s2,
    gap: space.s2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
  },
  reorder: {
    alignItems: "center",
    justifyContent: "center",
  },
  arrow: {
    fontSize: 12,
    color: colors.primary,
    paddingVertical: 1,
  },
  arrowDisabled: {
    color: colors.borderStrong,
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
  },
  editHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  delete: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: space.s5,
  },
});
