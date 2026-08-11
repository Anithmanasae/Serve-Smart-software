/**
 * A single menu-item card for the Waiter New Order grid.
 *
 * A white card with a soft blurred shadow, a square photo, the name, the price
 * and — filling the card's whole bottom edge — the one control that matters:
 * a `＋ Add` button that becomes a `−  qty  +` stepper once the item is on the
 * order. Full width because this is the target a waiter hits a hundred times a
 * shift standing at a table; a 32px circle in the corner was the smallest
 * thing on the busiest screen.
 *
 * A card holding un-sent units also takes a navy border and tinted footer, so
 * "what have I already put on this order?" is answerable by glancing across
 * the grid rather than by opening the cart.
 *
 * Items with OPTIONS (Chicken / Veg / Crunchy) never add on tap: they show a
 * corner ribbon, a price range, and hand the press to the Customize sheet,
 * because adding one would be picking a price on the guest's behalf.
 */
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { formatMoney } from "@/lib/money";
import { feel } from "@/lib/feedback";
import { PressableScale } from "@/components/PressableScale";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { hasVariants, priceRange } from "@/features/menu/variants";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import type { MenuItem } from "@/types/models";

interface OrderMenuCardProps {
  item: MenuItem & { id: string };
  /**
   * Un-sent units of this item on the current order; 0 = none.
   *
   * For an item with options this is the total ACROSS every option, so a card
   * showing "2" may be one Chicken and one Veg. The card cannot step that
   * number (which one would ＋ add?), so it stays a badge and the sheet stays
   * the way in — the count is a reminder, not a control.
   */
  qty: number;
  /** The offer currently EARNING on this item in the order — the discount is
   *  already in the total. Shown as a solid navy ribbon. */
  offerName?: string;
  /** A live offer covers this item but hasn't triggered yet (a BOGO waiting
   *  for its second unit). A quieter outline tag, so the waiter can upsell it
   *  without mistaking it for a saving the guest already has. */
  offerEligible?: boolean;
  /** Plain add of one unit — never called for an item with options. */
  onAdd: () => void;
  onDecrement: () => void;
  /** Open the Customize sheet: options, quantity and remarks. */
  onCustomize: () => void;
  disabled?: boolean;
}

function OrderMenuCardImpl({
  item,
  qty,
  offerName,
  offerEligible,
  onAdd,
  onDecrement,
  onCustomize,
  disabled,
}: OrderMenuCardProps) {
  const inOrder = qty > 0;
  const optioned = hasVariants(item);
  const range = priceRange(item);
  const imageSource = resolveMenuImage(item.id, item.imageUrl);

  return (
    <View style={[styles.card, inOrder && styles.cardActive]}>
      {/* Tapping the PHOTO always opens Customize — for an optioned dish it
          is a second door to the same sheet, and for a plain one it is the
          only way to attach a remark or add several at once. It has to be the
          photo and not the ＋ button: that button is replaced by the stepper
          the moment the item joins the order, and the way to say "no onions"
          must not disappear the instant the dish is on the ticket. */}
      <Pressable
        style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}
        onPress={onCustomize}
        onPressIn={feel.press}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Customize ${item.name}`}
      >
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

        {/* Down the photo's left edge, where it crosses nothing: the offer
            badges own the top-left and the qty badge the top-right. */}
        {optioned ? (
          <View style={styles.optionsRibbon}>
            <Text style={styles.optionsRibbonText} numberOfLines={1}>
              {item.variants!.length} Options
            </Text>
          </View>
        ) : null}

        {/* An option card can't step its own count, so it says what it holds. */}
        {optioned && inOrder ? (
          <View style={styles.qtyBadge}>
            <Text style={styles.qtyBadgeText}>{qty}</Text>
          </View>
        ) : null}
      </Pressable>

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
        <Text style={styles.price} numberOfLines={1}>
          {range && range.min !== range.max
            ? `${formatMoney(range.min)} – ${formatMoney(range.max)}`
            : formatMoney(range?.min ?? item.price)}
        </Text>

        {inOrder && !optioned ? (
          <View style={styles.stepper}>
            {/* The press that takes the last unit off is the one that deletes
                the line — it gets the softer "gone" feel so a run of
                decrements doesn't end on the same tap it started with. */}
            <PressableScale
              style={styles.stepBtn}
              activeScale={0.94}
              haptic={qty === 1 ? "dismiss" : "tap"}
              onPress={onDecrement}
              disabled={disabled}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </PressableScale>
            <Text style={styles.stepQty}>{qty}</Text>
            <PressableScale
              style={styles.stepBtn}
              activeScale={0.94}
              onPress={onAdd}
              disabled={disabled}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </PressableScale>
          </View>
        ) : (
          <PressableScale
            activeScale={0.97}
            // Options open a sheet, so that press is felt as something
            // opening; a plain add is an ordinary tap.
            haptic={optioned ? "press" : "tap"}
            style={[
              styles.addBtn,
              inOrder && styles.addBtnActive,
              disabled && styles.addBtnDisabled,
            ]}
            onPress={optioned ? onCustomize : onAdd}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              optioned ? `Choose an option for ${item.name}` : `Add ${item.name}`
            }
          >
            <Text style={[styles.addText, inOrder && styles.addTextActive]}>
              ＋ Add
            </Text>
          </PressableScale>
        )}
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
    // A transparent border at rest, so gaining the navy one on the active
    // card changes the colour and not the card's size — without this every
    // add nudges its neighbours by a pixel.
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.float,
  },
  cardActive: {
    borderColor: colors.primary,
  },
  pressed: {
    opacity: 0.85,
  },
  imageWrap: {
    width: "100%",
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.floor,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  // A tab down the photo's left edge. Squared off against that edge and
  // rounded on the inside, so it reads as attached to the card rather than
  // floating on the food.
  optionsRibbon: {
    position: "absolute",
    top: space.s3,
    left: 0,
    maxWidth: "70%",
    backgroundColor: colors.primary,
    paddingLeft: space.s2,
    paddingRight: space.s2,
    paddingVertical: 3,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  optionsRibbonText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.2,
    color: colors.textInverse,
  },
  qtyBadge: {
    position: "absolute",
    top: space.s2,
    right: space.s2,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  qtyBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 11,
    color: colors.textInverse,
  },
  offerRibbon: {
    position: "absolute",
    top: space.s2,
    left: space.s2,
    right: space.s5,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    alignSelf: "flex-start",
    backgroundColor: colors.primaryDark,
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
  price: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  // Both controls are the same full-width, 44dp-tall block, so the card does
  // not resize when an item joins the order and the thumb finds the same
  // target whichever state it is in.
  addBtn: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnActive: {
    backgroundColor: colors.primarySoft,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  addTextActive: {
    color: colors.primary,
  },
  stepper: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: space.s2,
  },
  // Each half of the stepper is a wide hit area rather than a small glyph:
  // the two are only ~100px apart on a phone card, and a mis-hit here costs
  // the guest an extra dish.
  stepBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: {
    color: colors.textInverse,
    fontSize: 20,
    fontFamily: fonts.bold,
    lineHeight: 24,
  },
  stepQty: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 16,
    fontFamily: fonts.extrabold,
    color: colors.textInverse,
  },
});
