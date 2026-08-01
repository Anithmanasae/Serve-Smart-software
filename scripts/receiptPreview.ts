/**
 * Receipt layout sanity check — renders the ESC/POS encoder's text preview for
 * a sample bill at both paper widths (58mm/32 cols and 80mm/48 cols) so the
 * layout can be eyeballed without a printer.
 *
 * Usage: npx tsx scripts/receiptPreview.ts
 * (pure TS, no Firebase/native imports — safe to run in plain node)
 */
import { encodeReceipt, lineWidth } from "../src/lib/printer/escpos";
import type { Bill, Order, Ts } from "../src/types/models";

/** Minimal Timestamp stand-in — the encoder only calls toDate(). */
const at = (iso: string) => ({ toDate: () => new Date(iso) }) as unknown as Ts;
const createdAt = at("2026-07-02T15:15:00.000Z"); // 08:45 PM IST

const order = {
  id: "order-1",
  tableId: "t5",
  orderType: "dine-in",
  waiterId: "w1",
  status: "billed",
  items: [
    { name: "Benne Dose", price: 7000, qty: 2 },
    { name: "Masala Dose Extra Butter Special", price: 9000, qty: 1 },
    { name: "Idli Vada Combo", price: 6000, qty: 3 },
    { name: "Filter Coffee", price: 2500, qty: 4 },
    { name: "Cancelled Item", price: 9999, qty: 1, voided: true },
  ].map((i, n) => ({
    lineId: `l${n}`,
    menuItemId: `m${n}`,
    name: i.name,
    price: i.price,
    qty: i.qty,
    kotStatus: "served" as const,
    kotId: "kot-1",
    voided: i.voided ?? false,
    addedAt: createdAt,
  })),
  subtotal: 54000,
  billId: "bill-1",
  createdAt,
  updatedAt: createdAt,
} as Order;

const bill = {
  id: "bill-1",
  billNumber: 125,
  orderId: "order-1",
  tableId: "t5",
  tableLabel: "T-05",
  subtotal: 54000,
  discountPercent: 0,
  discountAmount: 0,
  cgst: 1350,
  sgst: 1350,
  gstTotal: 2700,
  grandTotal: 56700,
  status: "paid",
  paymentMode: "cash",
  requestedBy: "w1",
  cashierId: "c1",
  printedCount: 0,
  createdAt,
  paidAt: createdAt,
} as Bill;

for (const paperWidth of [58, 80] as const) {
  const cols = lineWidth(paperWidth);
  const { bytes, preview } = encodeReceipt({
    profile: { name: "Hotel Sada Grand", addressLine: "12 MG Road, Bengaluru" },
    bill,
    order,
    cashierName: "Priya Nair",
    paperWidth,
    paymentLabel: "Cash",
  });
  console.log(`\n===== ${paperWidth}mm (${cols} cols, ${bytes.length} bytes) =====`);
  console.log("|" + "-".repeat(cols) + "|");
  for (const line of preview.split("\n")) {
    console.log("|" + line.padEnd(cols) + "|");
    if (line.length > cols) {
      throw new Error(`Line overflows ${cols} cols: "${line}"`);
    }
  }
  console.log("|" + "-".repeat(cols) + "|");
}
