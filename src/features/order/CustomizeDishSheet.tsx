/**
 * "Customize Dish" — the sheet between tapping a dish and it joining the order.
 *
 * Three questions in one pass: WHICH option (Chicken / Veg / Crunchy), HOW
 * MANY, and ANYTHING TO SAY to the kitchen. Batching them is the point: a
 * waiter standing at a table takes the whole instruction in one breath, and
 * committing once means the guest's "three, no onions" is one line rather than
 * three taps of ＋ followed by a note that arrives after the KOT already went.
 *
 * It commits NOTHING until "Add to Cart". Everything here is local state, so
 * backing out leaves the order exactly as it was — which is what makes it safe
 * to open the sheet just to read the prices.
 *
 * Opened by the card for any dish with options, and by a long-press on any
 * dish at all (that is the only way to put a remark on a plain item).
 */
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney } from "@/lib/money";
import { feel } from "@/lib/feedback";
import { PressableScale } from "@/components/PressableScale";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { variantsOf } from "@/features/menu/variants";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import type { MenuItem, MenuVariant } from "@/types/models";

export interface CustomizeResult {
  variant?: MenuVariant;
  qty: number;
  notes: string;
  /** The unit price actually charged — the chosen option's, or the item's. */
  price: number;
}

interface CustomizeDishSheetProps {
  /** The dish being customized, or null when the sheet is closed. */
  item: (MenuItem & { id: string }) | null;
  onCancel: () => void;
  onConfirm: (result: CustomizeResult) => void;
}

export function CustomizeDishSheet({
  item,
  onCancel,
  onConfirm,
}: CustomizeDishSheetProps) {
  const insets = useSafeAreaInsets();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const variants = item ? variantsOf(item) : [];

  // Fresh every time the sheet opens on a different dish. Keyed on the item id
  // rather than on visibility so re-opening the SAME dish also starts clean —
  // yesterday's "no onions" must never ride along to the next table.
  useEffect(() => {
    if (!item) return;
    setVariantId(null);
    setQty(1);
    setNotes("");
  }, [item?.id]);

  const chosen = variants.find((v) => v.id === variantId) ?? null;
  // No option is PRE-SELECTED. The cheapest would quietly become the default
  // the floor stops reading, and the guest would be served the wrong burger by
  // a waiter who never made a choice at all.
  const needsChoice = variants.length > 0 && !chosen;
  const unitPrice = chosen?.price ?? item?.price ?? 0;
  const total = unitPrice * qty;

  const imageSource = item ? resolveMenuImage(item.id, item.imageUrl) : null;

  return (
    <Modal
      visible={item !== null}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onCancel} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s3 }]}>
          <View style={styles.grabber} />

          <View style={styles.titleRow}>
            <Text style={styles.title}>Customize Dish</Text>
            <PressableScale
              hitSlop={10}
              haptic="dismiss"
              style={styles.closeBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={18} color={colors.text} />
            </PressableScale>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* The dish, and how many of it */}
            <View style={styles.itemCard}>
              {imageSource ? (
                <Image
                  style={styles.thumb}
                  source={imageSource}
                  contentFit="cover"
                  transition={120}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Feather name="image" size={18} color={colors.borderStrong} />
                </View>
              )}
              <Text style={styles.itemName} numberOfLines={2}>
                {item?.name}
              </Text>

              <View style={styles.stepper}>
                {/* Floored at one: this sheet ADDS, so zero is not a quantity
                    but a cancellation, and Cancel already says that. */}
                <PressableScale
                  style={styles.stepBtn}
                  activeScale={0.94}
                  haptic="tick"
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                >
                  <Text style={[styles.stepGlyph, qty <= 1 && styles.stepGlyphOff]}>
                    −
                  </Text>
                </PressableScale>
                <Text style={styles.stepQty}>{qty}</Text>
                <PressableScale
                  style={styles.stepBtn}
                  activeScale={0.94}
                  haptic="tick"
                  onPress={() => setQty((q) => q + 1)}
                >
                  <Text style={styles.stepGlyph}>+</Text>
                </PressableScale>
              </View>
            </View>

            {variants.length > 0 ? (
              <>
                <Text style={styles.label}>Select Option</Text>
                <View style={styles.variantRow}>
                  {variants.map((v) => {
                    const active = v.id === variantId;
                    return (
                      <Pressable
                        key={v.id}
                        style={({ pressed }) => [
                          styles.variant,
                          active && styles.variantActive,
                          pressed && !active && styles.pressed,
                        ]}
                        onPress={() => {
                          if (!active) feel.select();
                          setVariantId(v.id);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.variantName,
                            active && styles.variantNameActive,
                          ]}
                        >
                          {v.name}
                        </Text>
                        <Text
                          style={[
                            styles.variantPrice,
                            active && styles.variantPriceActive,
                          ]}
                        >
                          {formatMoney(v.price)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>Remarks</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Extra spicy, no onions, serve last…"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <Text style={styles.help}>
              Printed on the kitchen ticket, exactly as typed.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>

            <PressableScale
              activeScale={0.98}
              haptic="tap"
              style={[styles.addBtn, needsChoice && styles.addBtnDisabled]}
              onPress={() =>
                onConfirm({
                  variant: chosen ?? undefined,
                  qty,
                  notes: notes.trim(),
                  price: unitPrice,
                })
              }
              disabled={needsChoice}
            >
              <Text style={styles.addText}>
                {needsChoice
                  ? "Pick an option"
                  : `Add to Cart · ${formatMoney(total)}`}
              </Text>
            </PressableScale>
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
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  backdropFill: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    maxHeight: "88%",
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.s3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s3,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: space.s3,
    gap: space.s2,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    padding: space.s2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.floor,
  },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  itemName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.text,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: space.s1,
  },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: {
    color: colors.textInverse,
    fontSize: 20,
    fontFamily: fonts.bold,
    lineHeight: 24,
  },
  stepGlyphOff: {
    opacity: 0.45,
  },
  stepQty: {
    minWidth: 24,
    textAlign: "center",
    fontFamily: fonts.extrabold,
    fontSize: 16,
    color: colors.textInverse,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
    marginTop: space.s3,
  },
  variantRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  // Name over price, so the two never compete for the same glance: the waiter
  // is choosing a thing and confirming a number, in that order.
  variant: {
    minWidth: 92,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  variantActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  variantNameActive: {
    color: colors.textInverse,
  },
  variantPrice: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
  },
  variantPriceActive: {
    color: colors.textInverse,
    opacity: 0.9,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    minHeight: 88,
    textAlignVertical: "top",
  },
  help: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s4,
  },
  cancelText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textMuted,
  },
  addBtn: {
    flex: 1,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.glow,
  },
  addBtnDisabled: {
    backgroundColor: colors.borderStrong,
    shadowOpacity: 0,
    elevation: 0,
  },
  addText: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    color: colors.textInverse,
  },
});
