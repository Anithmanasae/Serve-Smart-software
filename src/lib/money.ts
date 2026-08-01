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
>;

/**
 * Compute a bill from order lines + an optional discount percent.
 *
 * Order of operations (matches the Bills mockup):
 *   subtotal        = Σ price*qty for non-voided lines
 *   discountAmount  = subtotal * discount%
 *   taxable         = subtotal - discountAmount
 *   cgst            = taxable * 2.5%   (0 when GST is switched off)
 *   sgst            = taxable * 2.5%   (0 when GST is switched off)
 *   grandTotal      = taxable + cgst + sgst
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

  const subtotal = lines
    .filter((l) => !l.voided)
    .reduce((sum, l) => sum + l.price * l.qty, 0);

  const discountAmount = roundPaise((subtotal * pct) / 100);
  const taxable = subtotal - discountAmount;

  const cgst = gstEnabled ? roundPaise(taxable * TAX_CONFIG.cgstRate) : 0;
  const sgst = gstEnabled ? roundPaise(taxable * TAX_CONFIG.sgstRate) : 0;
  const gstTotal = cgst + sgst;
  const grandTotal = taxable + gstTotal;

  return {
    subtotal,
    discountPercent: pct,
    discountAmount,
    cgst,
    sgst,
    gstTotal,
    grandTotal,
  };
}
