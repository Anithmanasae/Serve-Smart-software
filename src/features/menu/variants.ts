/**
 * Variant helpers — the one place that knows how a priced choice is read.
 *
 * A variant is a price on a dish, not a dish of its own (see `MenuVariant`).
 * Everything here is PURE and takes the item, so the menu screens, the order
 * grid and the write path all answer "what does this cost?" and "what is this
 * called?" identically — which is the whole reason a waiter's card and the
 * kitchen ticket can never disagree about which burger was ordered.
 */
import type { MenuItem, MenuVariant } from "@/types/models";

/**
 * Does this item make the waiter choose?
 *
 * TWO, not one. A lone variant is a label pretending to be a decision: the
 * Customize sheet would open to ask a question with a single possible answer,
 * and the card would hide a straight ＋ behind a modal for nothing. An item
 * left with one variant prices and adds exactly like a plain item — so the
 * owner mid-edit, having typed the first of three, never has a broken menu.
 */
export function hasVariants(item: Pick<MenuItem, "variants">): boolean {
  return (item.variants?.length ?? 0) >= 2;
}

/** The variants to actually offer, or an empty list for a plain item. */
export function variantsOf(item: Pick<MenuItem, "variants">): MenuVariant[] {
  return hasVariants(item) ? item.variants! : [];
}

/**
 * Cheapest and dearest variant price (paise), or null for a plain item.
 *
 * Read from the variants themselves rather than from `MenuItem.price`: that
 * field is only ever the minimum, so it can say "from ₹180" but never
 * "₹180 – ₹250".
 */
export function priceRange(
  item: Pick<MenuItem, "variants">
): { min: number; max: number } | null {
  const list = variantsOf(item);
  if (list.length === 0) return null;
  let min = list[0].price;
  let max = list[0].price;
  for (const v of list) {
    if (v.price < min) min = v.price;
    if (v.price > max) max = v.price;
  }
  return { min, max };
}

/**
 * The price a plain ＋ tap would charge — the item's own price, or the
 * cheapest variant. Also what `MenuItem.price` is kept equal to on write, so
 * this and the stored field agree even on a doc written by an older build.
 */
export function basePrice(item: Pick<MenuItem, "price" | "variants">): number {
  return priceRange(item)?.min ?? item.price;
}

/**
 * What an order line is CALLED once a variant is chosen: `Burger (Chicken)`.
 *
 * Composed at the moment of adding and snapshotted onto the line, which is why
 * the KOT, the ESC/POS encoder, the KDS card and the bill all print the right
 * thing without a line of variant code in any of them.
 */
export function composeLineName(
  itemName: string,
  variantName?: string
): string {
  const variant = variantName?.trim();
  return variant ? `${itemName} (${variant})` : itemName;
}
