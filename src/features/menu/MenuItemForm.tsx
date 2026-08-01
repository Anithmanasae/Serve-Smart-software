/**
 * Add / Edit menu item modal form. Reuses the ported menuApi writes:
 *   - createMenuItem / updateMenuItem
 *   - uploadMenuItemImage (create the item first to obtain its id)
 *
 * Price is entered in rupees (₹) and stored as paise via rupeesToPaise.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rupeesToPaise } from "@/lib/money";
import { colors, radius, space } from "@/theme/theme";
import type { MenuCategory, MenuItem } from "@/types/models";
import {
  createMenuItem,
  updateMenuItem,
  uploadMenuItemImage,
  type MenuItemInput,
} from "./menuApi";
import type { MenuCategoryDoc, MenuItemDoc } from "./useMenuData";

interface MenuItemFormProps {
  visible: boolean;
  /** The item being edited, or null to create a new one. */
  item: MenuItemDoc | null;
  categories: MenuCategoryDoc[];
  /** Pre-selected category when adding from within a category section. */
  defaultCategoryId?: string;
  onClose: () => void;
}

/** paise -> plain rupees string for the price input, e.g. 8500 -> "85". */
function paiseToRupeeString(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/**
 * Menu card thumbnails render at ~140-200pt, so anything beyond this edge
 * length is wasted Storage space and download time on restaurant Wi-Fi.
 */
const MAX_IMAGE_DIM = 800;

/**
 * Downscale the picked photo to at most MAX_IMAGE_DIM on its longest edge and
 * re-encode as JPEG at 70% quality. A typical 3-4 MB camera photo comes out
 * around 60-120 KB, which keeps Firebase Storage usage small while staying
 * sharp at menu-card size.
 */
async function compressMenuImage(
  asset: ImagePicker.ImagePickerAsset
): Promise<string> {
  const needsResize =
    asset.width > MAX_IMAGE_DIM || asset.height > MAX_IMAGE_DIM;
  const actions: ImageManipulator.Action[] = needsResize
    ? [
        asset.width >= asset.height
          ? { resize: { width: MAX_IMAGE_DIM } }
          : { resize: { height: MAX_IMAGE_DIM } },
      ]
    : [];
  const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

export function MenuItemForm({
  visible,
  item,
  categories,
  defaultCategoryId,
  onClose,
}: MenuItemFormProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceRupees, setPriceRupees] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | undefined>(
    undefined
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  // If a retry happens after the item doc was already created, reuse that id
  // instead of creating a duplicate.
  const createdIdRef = useRef<string | null>(null);

  // The primary button unlocks only once the required fields are filled:
  // a name, a category, and a price greater than zero.
  const priceNum = Number(priceRupees);
  const canSave =
    name.trim().length > 0 &&
    categoryId !== "" &&
    priceRupees.trim() !== "" &&
    Number.isFinite(priceNum) &&
    priceNum > 0;

  // Reset the form whenever it opens for a different item.
  useEffect(() => {
    if (!visible) return;
    createdIdRef.current = null;
    setName(item?.name ?? "");
    setCategoryId(item?.categoryId ?? defaultCategoryId ?? "");
    setPriceRupees(item ? paiseToRupeeString(item.price) : "");
    setDescription(item?.description ?? "");
    setSku(item?.sku ?? "");
    setEnabled(item?.enabled ?? true);
    setLocalImageUri(null);
    setExistingImageUrl(item?.imageUrl);
    setError(null);
    setSaving(false);
  }, [visible, item, defaultCategoryId]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo library permission is required to add an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Full quality here — compressMenuImage does the single lossy encode,
      // avoiding double JPEG artifacts.
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      try {
        setLocalImageUri(await compressMenuImage(asset));
      } catch {
        // Compression is an optimization; fall back to the original photo.
        setLocalImageUri(asset.uri);
      }
    }
  };

  const handleSave = async () => {
    if (!canSave) return;

    setSaving(true);
    setError(null);
    try {
      const base: MenuItemInput = {
        name: name.trim(),
        categoryId,
        price: rupeesToPaise(priceNum),
        enabled,
        description: description.trim() || undefined,
        sku: sku.trim() || undefined,
        imageUrl: existingImageUrl,
      };

      // Create the item first (to obtain an id) so the image can be uploaded
      // under that id, then persist the download URL onto the item.
      const itemId =
        item?.id ?? createdIdRef.current ?? (await createMenuItem(base));
      createdIdRef.current = itemId;
      if (item) {
        await updateMenuItem(itemId, base);
      }

      // Photo upload is best-effort: the item is already saved, so a Storage
      // failure (e.g. Storage not enabled on the Firebase project) must not
      // block the menu edit — save without the photo and tell the user.
      if (localImageUri) {
        try {
          const blob = await (await fetch(localImageUri)).blob();
          await uploadMenuItemImage(itemId, blob);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          Alert.alert(
            "Item saved without photo",
            detail.includes("storage/")
              ? "Photo uploads aren't available — Firebase Storage isn't set up on this project yet. The item was saved without its photo."
              : `The item was saved, but the photo upload failed: ${detail}`
          );
        }
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save item.");
      setSaving(false);
    }
  };

  const previewUri = localImageUri ?? existingImageUrl;

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
            <Text style={styles.title}>
              {item ? "Edit Item" : "Add Item"}
            </Text>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={onClose}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              style={({ pressed }) => [
                styles.imagePicker,
                pressed && styles.pressed,
              ]}
              onPress={pickImage}
            >
              {previewUri ? (
                <Image
                  style={styles.imagePreview}
                  source={{ uri: previewUri }}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.imageEmpty}>
                  <Text style={styles.imageEmptyIcon}>📷</Text>
                  <Text style={styles.imageEmptyText}>Add photo</Text>
                </View>
              )}
            </Pressable>
            {previewUri ? (
              <Pressable
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}
                onPress={pickImage}
              >
                <Text style={styles.changePhoto}>Change photo</Text>
              </Pressable>
            ) : null}

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Paneer Tikka"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Category</Text>
            <View style={styles.chips}>
              {categories.map((c) => {
                const active = c.id === categoryId;
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setCategoryId(c.id)}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
              {categories.length === 0 ? (
                <Text style={styles.help}>
                  No categories yet — add one first.
                </Text>
              ) : null}
            </View>

            <Text style={styles.label}>Price (₹)</Text>
            <TextInput
              style={styles.input}
              value={priceRupees}
              onChangeText={setPriceRupees}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <Text style={styles.label}>SKU</Text>
            <TextInput
              style={styles.input}
              value={sku}
              onChangeText={setSku}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
            />

            <View style={styles.enabledRow}>
              <Text style={styles.label}>Available</Text>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ true: colors.primary, false: colors.borderStrong }}
                thumbColor={colors.surface}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.pressed,
              ]}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (saving || !canSave) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              onPress={handleSave}
              disabled={saving || !canSave}
            >
              {saving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {canSave
                    ? item
                      ? "Save Changes"
                      : "Add Item"
                    : "Enter name, category & price"}
                </Text>
              )}
            </Pressable>
          </View>
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
    maxHeight: "92%",
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: space.s4,
    gap: space.s2,
  },
  imagePicker: {
    alignSelf: "center",
    width: 140,
    height: 140,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  imageEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1,
  },
  imageEmptyIcon: {
    fontSize: 28,
  },
  imageEmptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  changePhoto: {
    alignSelf: "center",
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
    marginTop: space.s1,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: space.s2,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontSize: 15,
    color: colors.text,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  chip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.textInverse,
    fontWeight: "600",
  },
  help: {
    fontSize: 13,
    color: colors.textMuted,
  },
  enabledRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.s3,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: space.s2,
  },
  footer: {
    flexDirection: "row",
    gap: space.s3,
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "700",
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnGhostText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
