/**
 * Plain-text bill for WhatsApp — the message the cashier sends when the
 * customer asks for their bill on WhatsApp. Mirrors the printed receipt's
 * content (same fields, same Bill-doc values, no money recomputed here) but
 * uses WhatsApp's *bold* markup and the ₹ symbol instead of ESC/POS columns,
 * since chat bubbles aren't monospace.
 */
import type { Bill, Order, RestaurantProfile } from "@/types/models";
import { formatDateIST, formatTimeIST } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { TAX_CONFIG } from "@/config/tax";
import { formatBillNumber } from "@/lib/printer/escpos";

export interface WhatsAppReceiptInput {
  profile: Pick<RestaurantProfile, "name" | "addressLine">;
  bill: Bill;
  order: Order;
  /** Shown as "Payment: CASH". Pass null to omit (unpaid bill). */
  paymentLabel?: string | null;
}

function pct(rate: number): string {
  const p = rate * 100;
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}

export function formatWhatsAppReceipt(input: WhatsAppReceiptInput): string {
  const { profile, bill, order, paymentLabel } = input;
  const createdAt = bill.createdAt ? bill.createdAt.toDate() : new Date();
  const lines = order.items.filter((i) => !i.voided && i.qty > 0);

  const out: string[] = [];
  out.push(`*${profile.name.toUpperCase()}*`);
  if (profile.addressLine) out.push(profile.addressLine);
  out.push("");
  out.push(`Bill No: ${formatBillNumber(bill.billNumber)}`);
  out.push(`Table: ${bill.tableLabel}`);
  out.push(`Date: ${formatDateIST(createdAt)} ${formatTimeIST(createdAt)}`);
  out.push("");
  out.push("*Items*");
  for (const i of lines) {
    out.push(`${i.qty} × ${i.name} — ${formatMoney(i.price * i.qty)}`);
  }
  out.push("");
  out.push(`Subtotal: ${formatMoney(bill.subtotal)}`);
  if (bill.discountAmount > 0) {
    out.push(
      `Discount (${bill.discountPercent}%): -${formatMoney(bill.discountAmount)}`
    );
  }
  if (bill.gstTotal > 0) {
    out.push(`CGST (${pct(TAX_CONFIG.cgstRate)}): ${formatMoney(bill.cgst)}`);
    out.push(`SGST (${pct(TAX_CONFIG.sgstRate)}): ${formatMoney(bill.sgst)}`);
  }
  out.push(`*Grand Total: ${formatMoney(bill.grandTotal)}*`);
  if (paymentLabel) {
    out.push("");
    out.push(`Payment: ${paymentLabel.toUpperCase()}`);
  }
  out.push("");
  out.push("Thank you! Visit again 🙏");
  return out.join("\n");
}

/**
 * Normalize a cashier-typed Indian mobile number to WhatsApp's digits-only
 * international form ("91XXXXXXXXXX"). Returns null when the input can't be
 * a valid number (so the caller can show a validation message).
 */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}
