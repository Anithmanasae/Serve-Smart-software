/**
 * A single menu-item card for the Waiter New Order grid.
 *
 * Premium Smart Serve look: a borderless pure-white card with a soft, blurred
 * drop shadow, a rounded image (Feather placeholder when none), and a green
 * price.
 * When the item is an un-sent line in the current order the circular `+` add
 * button becomes a soft-gray `−  qty  +` stepper. Steppers spring on press.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { formatMoney } from "@/lib/money";
import { PressableScale } from "@/components/PressableScale";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import type { MenuItem } from "@/types/models";

interface OrderMenuCardProps {
  item: MenuItem & { id: string };
  /** Qty of this item on the current (editable/pending) order line; 0 = none. */
  qty: number;
  /** The offer currently EARNING on this item in the order — the discount is
   *  already in the total. Shown as a solid violet ribbon. */
  offerName?: string;
  /** A live offer covers this item but hasn't triggered yet (a BOGO waiting
   *  for its second unit). A quieter outline tag, so the waiter can upsell it
   *  without mistaking it for a saving the guest already has. */
  offerEligible?: boolean;
  onAdd: () => void;
  onDecrement: () => void;
  disabled?: boolean;
}

function OrderMenuCardImpl({
  item,
  qty,
  offerName,
  offerEligible,
  onAdd,
  onDecrement,
  disabled,
}: OrderMenuCardProps) {
  const inOrder = qty > 0;
  const imageSource = resolveMenuImage(item.id, item.imageUrl);
  return (
    <View style={styles.card}>
      {imageSource ? (
        <Image
          style={styles.image}
          source={imageSource}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={item.id}
        />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <Feather name="image" size={26} color={colors.borderStrong} />
        </View>
      )}

      {offerName ? (
        <View style={styles.offerRibbon}>
          <Feather name="tag" size={10} color={colors.textInverse} />
          <Text style={styles.offerRibbonText} numberOfLines={1}>
            {offerName}
          </Text>
        </View>
      ) : offerEligible ? (
        <View style={styles.offerTag}>
          <Feather name="tag" size={10} color={colors.primary} />
          <Text style={styles.offerTagText}>OFFER</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatMoney(item.price)}</Text>

          {inOrder ? (
            <View style={styles.stepper}>
              {/* The press that takes the last unit off is the one that
                  deletes the line — it gets the softer "gone" feel so a run
                  of decrements doesn't end on the same tap it started with. */}
              <PressableScale
                hitSlop={8}
                style={styles.stepBtn}
                haptic={qty === 1 ? "dismiss" : "tap"}
                onPress={onDecrement}
                disabled={disabled}
              >
                <Text style={styles.stepGlyph}>−</Text>
              </PressableScale>
              <Text style={styles.stepQty}>{qty}</Text>
              <PressableScale
                hitSlop={8}
                style={styles.stepBtn}
                onPress={onAdd}
                disabled={disabled}
              >
                <Text style={styles.stepGlyph}>+</Text>
              </PressableScale>
            </View>
          ) : (
            <PressableScale
              hitSlop={8}
              style={[styles.addBtn, disabled && styles.addBtnDisabled]}
              onPress={onAdd}
              disabled={disabled}
            >
              <Text style={styles.addGlyph}>＋</Text>
            </PressableScale>
          )}
        </View>
      </View>
    </View>
  );
}

export const OrderMenuCard = memo(OrderMenuCardImpl);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadow.float,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.floor,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Both badges float over the photo's bottom-left, clear of the `+` button
  // at bottom-right and of the name below.
  offerRibbon: {
    position: "absolute",
    top: space.s2,
    left: space.s2,
    right: space.s5,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    paddingHorizontal: space.s2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  offerRibbonText: {
    flexShrink: 1,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    color: colors.textInverse,
  },
  offerTag: {
    position: "absolute",
    top: space.s2,
    left: space.s2,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.offerSoft,
    borderWidth: 1,
    borderColor: colors.offerBorder,
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  offerTagText: {
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.primary,
  },
  body: {
    padding: space.s3,
    gap: space.s2,
  },
  name: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
  price: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addGlyph: {
    color: colors.textInverse,
    fontSize: 18,
    fontFamily: fonts.bold,
    lineHeight: 20,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: {
    color: colors.text,
    fontSize: 17,
    fontFamily: fonts.bold,
    lineHeight: 19,
  },
  stepQty: {
    minWidth: 14,
    textAlign: "center",
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
});
