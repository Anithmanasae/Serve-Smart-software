/**
 * Money & bill math — the single implementation used everywhere.
 *
 * All amounts are integers in PAISE (₹1 = 100 paise) to eliminate floating
 * point rounding errors on money. Only convert to rupees for display.
 *
 * Subagents: never do bill arithmetic inline. Call `computeBill` / `formatMoney`.
 */
import { TAX_CONFIG } from "@/config/tax";
import type { Bill } from "@/types/models";

/** Round half-up to the nearest integer paise. */
function roundPaise(value: number): number {
  return Math.round(value);
}

/** ₹85.00 -> 8500 paise */
export function rupeesToPaise(rupees: number): number {
  return roundPaise(rupees * 100);
}

/**
 * 8500 paise -> "₹85.00". Uses Indian digit grouping (e.g. ₹1,23,456.00)
 * implemented manually so it doesn't depend on Intl/Hermes locale data.
 */
export function formatMoney(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const paisePart = (abs % 100).toString().padStart(2, "0");

  const digits = rupees.toString();
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    // group the remaining digits in pairs (Indian numbering system)
    const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${withCommas},${last3}`;
  }

  return `${negative ? "-" : ""}${TAX_CONFIG.currencySymbol}${grouped}.${paisePart}`;
}

export interface BillLine {
  price: number; // paise, per unit
  qty: number;
  voided?: boolean;
  /** Paise knocked off this WHOLE line by an offer (see src/lib/offers.ts).
   *  `price` stays the full menu price — the discount is a separate number,
   *  never a marked-down price. */
  offerDiscount?: number;
}

export type BillTotals = Pick<
  Bill,
  | "subtotal"
  | "discountPercent"
  | "discountAmount"
  | "cgst"
  | "sgst"
  | "gstTotal"
  | "grandTotal"
> & {
  /** Σ of the lines' offer discounts (paise), clamped to the subtotal. */
  offerDiscount: number;
};

/**
 * Compute a bill from order lines, the offers already stamped on them, and an
 * optional manual discount percent.
 *
 * Order of operations:
 *   subtotal        = Σ price*qty for non-voided lines          (GROSS)
 *   offerDiscount   = Σ line offerDiscount, capped at subtotal
 *   afterOffers     = subtotal - offerDiscount
 *   discountAmount  = afterOffers * discount%
 *   taxable         = afterOffers - discountAmount
 *   cgst            = taxable * 2.5%   (0 when GST is switched off)
 *   sgst            = taxable * 2.5%   (0 when GST is switched off)
 *   grandTotal      = taxable + cgst + sgst
 *
 * `subtotal` stays GROSS on purpose. It is what the kitchen sent out, it is
 * what `itemSales` sums to, and it is the figure the offer saving is quoted
 * against on the receipt — netting the offers into it would leave nothing to
 * show the customer and nothing for the owner to measure the promo by.
 *
 * Offers come off BEFORE the manual percent, so a manual discount (which the
 * rules pin to zero anyway) can never be stacked on top of the full price to
 * multiply a giveaway.
 *
 * `gstEnabled: false` (the cashier's Account-screen switch) zeroes both GST
 * components; the rules' gstTotal == cgst + sgst check still holds at 0.
 *
 * This function is also the reference the Firestore rules validate against,
 * so it must stay deterministic and integer-only.
 */
export function computeBill(
  lines: BillLine[],
  discountPercent = 0,
  gstEnabled = true
): BillTotals {
  const pct = Math.min(Math.max(discountPercent, 0), 100);
  const live = lines.filter((l) => !l.voided);

  const subtotal = live.reduce((sum, l) => sum + l.price * l.qty, 0);

  // Clamped both ends: a malformed line must never produce a negative bill,
  // and offers can at most make the food free — never owe the customer money.
  const offerDiscount = Math.min(
    Math.max(
      live.reduce((sum, l) => sum + Math.max(0, l.offerDiscount ?? 0), 0),
      0
    ),
    subtotal
  );

  const afterOffers = subtotal - offerDiscount;
  const discountAmount = roundPaise((afterOffers * pct) / 100);
  const taxable = afterOffers - discountAmount;

  const cgst = gstEnabled ? roundPaise(taxable * TAX_CONFIG.cgstRate) : 0;
  const sgst = gstEnabled ? roundPaise(taxable * TAX_CONFIG.sgstRate) : 0;
  const gstTotal = cgst + sgst;
  const grandTotal = taxable + gstTotal;

  return {
    subtotal,
    offerDiscount,
    discountPercent: pct,
    discountAmount,
    cgst,
    sgst,
    gstTotal,
    grandTotal,
  };
}
