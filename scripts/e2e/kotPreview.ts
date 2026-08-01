/**
 * KOT layout preview — logs the plain-text mirror of `encodeKot` at both
 * paper widths (58mm/32 cols and 80mm/48 cols) for a sample ticket, so the
 * layout can be eyeballed without a printer. Pure — no Firebase, no network.
 *
 *   npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/kotPreview.ts
 */
import { Timestamp } from "firebase/firestore";
import { encodeKot, lineWidth, type PaperWidth } from "@/lib/printer/escpos";
import type { Kot } from "@/types/models";

const sampleKot: Pick<Kot, "ticketNumber" | "tableLabel" | "orderType" | "items"> &
  Partial<Pick<Kot, "createdAt">> = {
  ticketNumber: 4092,
  tableLabel: "T-05",
  orderType: "dine-in",
  createdAt: Timestamp.fromDate(new Date("2026-07-11T14:12:00+05:30")),
  items: [
    {
      lineId: "l1",
      menuItemId: "benne-dose",
      name: "Benne Dose",
      qty: 2,
      notes: "extra butter",
      voided: false,
    },
    {
      lineId: "l2",
      menuItemId: "masala-dosa",
      name: "Masala Dosa",
      qty: 1,
      notes: "",
      voided: false,
    },
    {
      lineId: "l3",
      menuItemId: "paneer-butter-masala",
      name: "Paneer Butter Masala Special Family Pack",
      qty: 3,
      notes: "less spicy\nno onion",
      voided: false,
    },
    {
      lineId: "l4",
      menuItemId: "idli-vada",
      name: "Idli Vada",
      qty: 1,
      notes: "",
      voided: true,
    },
  ],
};

for (const paperWidth of [58, 80] as PaperWidth[]) {
  const { preview, bytes } = encodeKot({
    profile: { name: "Hotel Sada Deluxe" },
    kot: sampleKot,
    paperWidth,
  });
  const cols = lineWidth(paperWidth);
  console.log(`\n═══ ${paperWidth}mm (${cols} cols, ${bytes.length} bytes) ═══`);
  console.log("+" + "-".repeat(cols) + "+");
  for (const line of preview.split("\n")) {
    console.log("|" + line.padEnd(cols) + "|");
  }
  console.log("+" + "-".repeat(cols) + "+");
}
