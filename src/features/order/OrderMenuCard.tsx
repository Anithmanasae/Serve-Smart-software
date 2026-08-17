/**
 * A single menu-item card for the Waiter New Order grid.
 *
 * Premium Smart Serve look: a pure-white card with a soft, blurred drop
 * shadow, a rounded image (Feather placeholder when none), and a navy price.
 * When the item is an un-sent line in the current order the circular `+` add
 * button becomes a soft-gray `−  qty  +` stepper. Steppers spring on press.
 *
 * The WHOLE card adds a unit. A waiter taking an order at the table is aiming
 * at a photo, not at a 32dp circle, and that circle was the smallest target on
 * the busiest screen in the app. The `+` stays because it is what tells you
 * the card is tappable at all, and the `−` has nowhere else to live; both sit
 * above the card's own press, so hitting one does exactly what it says rather
 * than also firing the card underneath it.
 *
 * A card holding un-sent units is HIGHLIGHTED — navy border, navy-tinted
 * footer — so "what have I already put on this order?" is answerable by
 * glancing across the grid rather than by opening the cart.
 *
 * An item with OPTIONS keeps the same circular `+`, but the press opens the
 * Customize sheet instead of adding: picking one of several prices is the
 * guest's call, not the card's. Such a card never shows the stepper either —
 * its qty is the total across every option, so `−` would have no one line to
 * take a unit from. It badges that total on the photo instead.
 *
 * Every handler takes the item back as an argument. That is what lets the
 * screen hand this component callbacks that never change identity, which is
 * what makes `memo` actually hold — see the note on `renderCard` there.
 */
import { memo, useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { formatMoney } from "@/lib/money";
import { PressableScale } from "@/components/PressableScale";
import { resolveMenuImage } from "@/features/menu/menuImages";
import { basePrice, hasVariants, priceRange } from "@/features/menu/variants";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import type { MenuItem } from "@/types/models";

type Item = MenuItem & { id: string };

interface OrderMenuCardProps {
  item: Item;
  /** Qty of this item on the current (editable/pending) order line; 0 = none. */
  qty: number;
  /** The offer currently EARNING on this item in the order — the discount is
   *  already in the total. Shown as a solid navy ribbon. */
  offerName?: string;
  /** A live offer covers this item but hasn't triggered yet (a BOGO waiting
   *  for its second unit). A quieter outline tag, so the waiter can upsell it
   *  without mistaking it for a saving the guest already has. */
  offerEligible?: boolean;
  onAdd: (item: Item) => void;
  onDecrement: (item: Item) => void;
  /** Open the Customize sheet: options, quantity and remarks. */
  onCustomize: (item: Item) => void;
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
  const optioned = hasVariants(item);
  // On the order at all — what the highlight answers. The stepper is the
  // narrower question of whether this card owns one steppable line.
  const selected = qty > 0;
  const steppable = selected && !optioned;
  const imageSource = resolveMenuImage(item.id, item.imageUrl);

  // "from ₹180", never a bare "₹180", when the options don't all cost the
  // same. `MenuItem.price` is deliberately kept equal to the CHEAPEST variant,
  // so printing it flat quotes ₹180 for a burger the guest may well be about
  // to order at ₹250 — and the waiter quotes off this grid. The word is also
  // the only thing on the card that says "there is a choice here" before the
  // sheet opens, which is why it stays even though the range would fit: two
  // prices side by side is what broke this line's height in the first place.
  const range = priceRange(item);
  const priceLabel =
    range && range.max > range.min
      ? `from ${formatMoney(range.min)}`
      : formatMoney(basePrice(item));

  // Bound here rather than by the parent: these close over `item`, which only
  // changes when the card re-renders anyway, so the parent's own callbacks
  // stay identity-stable across every add.
  const add = useCallback(() => onAdd(item), [onAdd, item]);
  const customize = useCallback(() => onCustomize(item), [onCustomize, item]);
  const decrement = useCallback(() => onDecrement(item), [onDecrement, item]);

  return (
    <PressableScale
      // The touchable is what the grid cell measures, so it takes the flex;
      // the card itself is the surface that scales under the finger.
      containerStyle={styles.cardTouchable}
      style={[styles.card, selected && styles.cardSelected]}
      // Barely there. The card is 160dp of screen; the 0.9 the small controls
      // use would read as the whole grid lurching on every tap.
      activeScale={0.97}
      // Options open a sheet, so that press is felt as something opening; a
      // plain add is an ordinary tap.
      haptic={optioned ? "press" : "tap"}
      onPress={optioned ? customize : add}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        optioned ? `Choose an option for ${item.name}` : `Add ${item.name}`
      }
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

      {/* An optioned card can't step its own count, so it says what it holds.
          It may be one Chicken and one Veg — the number is a reminder that
          this dish is already on the order, not a control. */}
      {optioned && selected ? (
        <View style={styles.qtyBadge}>
          <Text style={styles.qtyBadgeText}>{qty}</Text>
        </View>
      ) : null}

      <View style={[styles.body, selected && styles.bodySelected]}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {/* Its own line, and never allowed to wrap. Beside the control it had
            about 60dp to render "₹1,000.00" in and broke to one character per
            line, which took the card's height with it and left every row in
            the grid a different size. */}
        <Text style={styles.price} numberOfLines={1}>
          {priceLabel}
        </Text>

        {steppable ? (
          <View style={styles.stepper}>
            {/* The press that takes the last unit off is the one that
                deletes the line — it gets the softer "gone" feel so a run
                of decrements doesn't end on the same tap it started with. */}
            <PressableScale
              hitSlop={8}
              style={styles.stepBtn}
              activeScale={0.94}
              haptic={qty === 1 ? "dismiss" : "tap"}
              onPress={decrement}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove one ${item.name}`}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </PressableScale>
            <Text style={styles.stepQty}>{qty}</Text>
            <PressableScale
              hitSlop={8}
              style={styles.stepBtn}
              activeScale={0.94}
              onPress={add}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Add one ${item.name}`}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </PressableScale>
          </View>
        ) : (
          <View
            // Not a Pressable. The whole card already adds, and stacking a
            // second responder here only creates a seam where a tap can land
            // on neither. It stays as the affordance that says the card is
            // tappable — and it is the same full-width, 40dp block the
            // stepper is, so joining the order does not resize the card.
            style={[styles.addBtn, disabled && styles.addBtnDisabled]}
          >
            <Text style={styles.addText}>＋ Add</Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

/**
 * `qty` is the only prop that moves in normal use, so the default shallow
 * compare is exactly right — provided the parent keeps the three callbacks
 * stable, which it does. Without that this memo never hits and every add
 * re-renders every card in the grid.
 */
export const OrderMenuCard = memo(OrderMenuCardImpl);

const styles = StyleSheet.create({
  cardTouchable: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    // A transparent border at rest, so gaining the navy one on a selected
    // card changes the colour and not the card's size — without this every
    // add nudges its neighbours by a pixel and the whole grid twitches.
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.float,
  },
  cardSelected: {
    borderColor: colors.primary,
  },
  // The photo sits INSIDE the card's 1.5px border, so its corners have to be
  // that much tighter than the card's or a white crescent shows at each top
  // corner where the two arcs disagree.
  image: {
    width: "100%",
    aspectRatio: 1,
    borderTopLeftRadius: radius.xl - 2,
    borderTopRightRadius: radius.xl - 2,
    backgroundColor: colors.floor,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Both badges float over the photo's top-left, clear of the qty badge at
  // top-right and of the name below.
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
    // A white ring, so the badge reads on a dark photo as well as a light one.
    borderWidth: 2,
    borderColor: colors.surface,
  },
  qtyBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 11,
    color: colors.textInverse,
  },
  body: {
    padding: space.s3,
    gap: space.s2,
    // Its own bottom corners, because the tint below has to stop where the
    // card does. The card cannot use `overflow: "hidden"` to do it for us —
    // that clips `shadow.float` away on iOS.
    borderBottomLeftRadius: radius.xl - 2,
    borderBottomRightRadius: radius.xl - 2,
  },
  bodySelected: {
    backgroundColor: colors.primarySoft,
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
  // Both controls are the same full-width, 40dp block, so the card does not
  // resize when an item joins the order and the thumb finds the same target
  // whichever state it is in. Beside the price they had ~40dp of a ~104dp
  // card to share, which is what broke the layout on a phone.
  addBtn: {
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  // Solid navy once the dish is on the order — the one place on the card that
  // is unmissable at a glance down a grid of six.
  stepper: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: space.s1,
  },
  // Each half is a wide hit area rather than a small glyph: the two are only
  // ~70dp apart on a phone card, and a mis-hit here costs the guest a dish.
  stepBtn: {
    flex: 1,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: {
    color: colors.textInverse,
    fontSize: 19,
    fontFamily: fonts.bold,
    lineHeight: 23,
  },
  stepQty: {
    minWidth: 18,
    textAlign: "center",
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.textInverse,
  },
});
