/**
 * Add / Edit menu item modal form. Reuses the ported menuApi writes:
 *   - createMenuItem / updateMenuItem
 *   - setMenuItemImage (create the item first to obtain its id)
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
  setMenuItemImage,
  updateMenuItem,
  MAX_IMAGE_DATA_URI_BYTES,
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
 * Successive (longest-edge, JPEG quality) attempts, each cheaper than the last.
 *
 * Menu card thumbnails render at ~140-200pt, so the first step is already
 * generous — a typical 3-4 MB camera photo lands around 60-120 KB raw
 * (~80-160 KB base64), comfortably inside MAX_IMAGE_DATA_URI_BYTES. The later
 * steps only ever run for pathological inputs (huge panoramas, noisy photos
 * that resist compression), where giving up some sharpness beats refusing the
 * photo outright.
 */
const ENCODE_STEPS: ReadonlyArray<{ dim: number; quality: number }> = [
  { dim: 800, quality: 0.7 },
  { dim: 640, quality: 0.6 },
  { dim: 512, quality: 0.5 },
  { dim: 400, quality: 0.4 },
];

/**
 * Downscale + re-encode the picked photo as a base64 JPEG data URI small
 * enough to live inside the menu item's Firestore document.
 *
 * Photos are stored in Firestore rather than Firebase Storage (see
 * `setMenuItemImage`), so the encoded string — not the file — is what has to
 * fit. Each step is tried in turn and the first one under budget wins.
 */
async function encodeMenuImage(
  asset: ImagePicker.ImagePickerAsset
): Promise<{ previewUri: string; dataUri: string }> {
  let smallest: { previewUri: string; dataUri: string } | null = null;

  for (const step of ENCODE_STEPS) {
    const needsResize = asset.width > step.dim || asset.height > step.dim;
    const actions: ImageManipulator.Action[] = needsResize
      ? [
          asset.width >= asset.height
            ? { resize: { width: step.dim } }
            : { resize: { height: step.dim } },
        ]
      : [];
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: step.quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!result.base64) continue;

    const encoded = {
      previewUri: result.uri,
      dataUri: `data:image/jpeg;base64,${result.base64}`,
    };
    if (encoded.dataUri.length <= MAX_IMAGE_DATA_URI_BYTES) return encoded;
    smallest = encoded;

    // An image already under the step's edge length is not resized, so every
    // remaining step would re-encode at the same dimensions — only quality
    // would drop. Keep going; quality alone is usually enough.
  }

  throw new Error(
    smallest
      ? `This photo is too detailed to store (still ${Math.round(
          smallest.dataUri.length / 1024
        )} KB after compression). Try a simpler or less zoomed-in shot.`
      : "Could not read that image. Try a different photo."
  );
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
  // The freshly picked photo, already encoded: `previewUri` is a local file
  // for cheap on-device preview, `dataUri` is what gets written to Firestore.
  const [pendingImage, setPendingImage] = useState<{
    previewUri: string;
    dataUri: string;
  } | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | undefined>(
    undefined
  );
  const [encoding, setEncoding] = useState(false);
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
    setPendingImage(null);
    setExistingImageUrl(item?.imageUrl);
    setError(null);
    setSaving(false);
    setEncoding(false);
  }, [visible, item, defaultCategoryId]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo library permission is required to add an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Full quality here — encodeMenuImage does the single lossy encode,
      // avoiding double JPEG artifacts.
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || result.assets.length === 0) return;

    setError(null);
    setEncoding(true);
    try {
      setPendingImage(await encodeMenuImage(result.assets[0]));
    } catch (e) {
      // Unlike the old Storage upload there is no raw-file fallback: a local
      // `file://` path written to Firestore would render on this device and
      // be a broken image on every other one. Drop the photo instead.
      setPendingImage(null);
      setError(e instanceof Error ? e.message : "Could not process that image.");
    } finally {
      setEncoding(false);
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

      // Create the item first (to obtain an id) so the photo can be written
      // against that id in a second, separate update.
      const itemId =
        item?.id ?? createdIdRef.current ?? (await createMenuItem(base));
      createdIdRef.current = itemId;
      if (item) {
        await updateMenuItem(itemId, base);
      }

      // The photo write is best-effort: the item is already saved, so a
      // failure here must not block the menu edit — keep the item and tell
      // the user the photo did not stick.
      if (pendingImage) {
        try {
          await setMenuItemImage(itemId, pendingImage.dataUri);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          Alert.alert(
            "Item saved without photo",
            `The item was saved, but the photo could not be stored: ${detail}`
          );
        }
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save item.");
      setSaving(false);
    }
  };

  const previewUri = pendingImage?.previewUri ?? existingImageUrl;

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
              disabled={encoding}
            >
              {encoding ? (
                <View style={styles.imageEmpty}>
                  <ActivityIndicator color={colors.textMuted} />
                  <Text style={styles.imageEmptyText}>Processing…</Text>
                </View>
              ) : previewUri ? (
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
            {previewUri && !encoding ? (
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
