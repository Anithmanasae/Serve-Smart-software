/**
 * ESC/POS receipt encoder — pure bytes, no native or Firebase imports, so it
 * runs anywhere (app, Expo Go, node scripts) and is unit-testable without a
 * printer.
 *
 * Layout contract (see the receipt spec): 32 columns on 58mm paper, 48 on
 * 80mm. Amounts print as "Rs." because thermal codepages have no ₹ glyph.
 * Money stays integer paise until the final string formatting — no float math.
 *
 * The encoder also produces a plain-text `preview` (exactly the characters
 * sent, minus control codes) so layouts can be eyeballed without hardware.
 */
import type { Bill, Kot, Order, RestaurantProfile } from "@/types/models";
import { formatDateIST, formatTimeIST } from "@/lib/date";
import { TAX_CONFIG } from "@/config/tax";

export type PaperWidth = 58 | 80;

export interface ReceiptInput {
  profile: Pick<RestaurantProfile, "name" | "addressLine">;
  bill: Bill;
  order: Order;
  cashierName: string;
  paperWidth: PaperWidth;
  /** Printed as "Payment : CASH". Omit the line by passing null (unpaid). */
  paymentLabel?: string | null;
}

export interface EncodedReceipt {
  bytes: Uint8Array;
  /** Text mirror of the printed characters, for logs/tests. */
  preview: string;
}

/** Columns per paper width (Font A, 12x24 dots). */
export function lineWidth(paper: PaperWidth): number {
  return paper === 58 ? 32 : 48;
}

/** Sequential bill number, zero-padded 6: 101 -> "000101". */
export function formatBillNumber(n: number | undefined): string {
  return n === undefined ? "------" : String(n).padStart(6, "0");
}

/** 54000 paise -> "540.00" (integer math only; no grouping on paper). */
function paiseToPlain(paise: number): string {
  const neg = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${neg}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 54000 paise -> "Rs.540.00" — the on-paper money format. */
function paiseToRs(paise: number): string {
  return `Rs.${paiseToPlain(paise)}`;
}

/** Thermal printers speak single-byte codepages: force printable ASCII. */
function toAscii(s: string): string {
  let out = s.replace(/₹/g, "Rs.");
  try {
    out = out.normalize("NFKD");
  } catch {
    // Hermes without normalize support — fall through to the strip below.
  }
  // eslint-disable-next-line no-control-regex
  return out.replace(/[^\x20-\x7E]/g, "?");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

// ── ESC/POS control sequences ────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTER = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE_HEIGHT = [GS, 0x21, 0x01];
/** Feed then partial cut (GS V 66 n). Cutter-less printers ignore it. */
const FEED_AND_CUT = [GS, 0x56, 66, 3];

/** Byte + preview-text accumulator. */
class ReceiptWriter {
  private bytes: number[] = [];
  private previewLines: string[] = [];
  private centered = false;

  constructor(private cols: number) {}

  raw(codes: number[]): void {
    this.bytes.push(...codes);
  }

  /** Set alignment (bytes + preview mirror together). */
  align(mode: "left" | "center"): void {
    this.centered = mode === "center";
    this.raw(mode === "center" ? ALIGN_CENTER : ALIGN_LEFT);
  }

  /** One printed line: ASCII-sanitized text followed by a line feed. */
  line(text = ""): void {
    const ascii = toAscii(text);
    for (let i = 0; i < ascii.length; i++) this.bytes.push(ascii.charCodeAt(i));
    this.bytes.push(LF);
    // Mirror the printer's centering in the text preview.
    const pad =
      this.centered && ascii.length < this.cols
        ? Math.floor((this.cols - ascii.length) / 2)
        : 0;
    this.previewLines.push(" ".repeat(pad) + ascii);
  }

  done(): EncodedReceipt {
    return {
      bytes: Uint8Array.from(this.bytes),
      preview: this.previewLines.join("\n"),
    };
  }
}

/** label padded to the widest key, then " : value" — the header block rows. */
function kv(label: string, value: string): string {
  return `${label.padEnd(7)} : ${value}`;
}

/** Left label, value right-aligned to the full line width. */
function spread(label: string, value: string, cols: number): string {
  const pad = Math.max(1, cols - label.length - value.length);
  return label + " ".repeat(pad) + value;
}

/** One item row: name (truncated), qty and amount right-aligned in columns. */
function itemRow(name: string, qty: string, amt: string, cols: number): string {
  const QTY_W = 4;
  const AMT_W = 9;
  const nameW = cols - QTY_W - AMT_W;
  return (
    truncate(toAscii(name), nameW).padEnd(nameW) +
    qty.padStart(QTY_W) +
    amt.padStart(AMT_W)
  );
}

function pct(rate: number): string {
  const p = rate * 100;
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;
}

/**
 * Encode the full customer receipt. All money values come straight off the
 * Bill doc (already computed by `computeBill` at bill time) — never recompute.
 */
export function encodeReceipt(input: ReceiptInput): EncodedReceipt {
  const { profile, bill, order, cashierName, paperWidth, paymentLabel } = input;
  const cols = lineWidth(paperWidth);
  const divider = "-".repeat(cols);
  const w = new ReceiptWriter(cols);

  const createdAt = bill.createdAt ? bill.createdAt.toDate() : new Date();
  const lines = order.items.filter((i) => !i.voided && i.qty > 0);
  const totalQty = lines.reduce((sum, i) => sum + i.qty, 0);

  w.raw(INIT);

  // Header: restaurant identity, centered; name double-height bold.
  w.align("center");
  w.raw(SIZE_DOUBLE_HEIGHT);
  w.raw(BOLD_ON);
  w.line(profile.name.toUpperCase());
  w.raw(BOLD_OFF);
  w.raw(SIZE_NORMAL);
  if (profile.addressLine) w.line(profile.addressLine);
  w.align("left");

  w.line(divider);
  w.line(kv("Bill No", formatBillNumber(bill.billNumber)));
  w.line(kv("Table", bill.tableLabel));
  w.line(kv("Date", formatDateIST(createdAt)));
  w.line(kv("Time", formatTimeIST(createdAt)));
  w.line(kv("Cashier", cashierName));
  w.line(divider);

  // Items table.
  w.line(itemRow("Item", "Qty", "Amt", cols));
  w.line(divider);
  for (const i of lines) {
    w.line(itemRow(i.name, String(i.qty), paiseToPlain(i.price * i.qty), cols));
  }
  w.line(divider);

  // Totals — straight off the Bill doc.
  w.line(`Items : ${totalQty}`);
  w.line(spread("Subtotal", paiseToRs(bill.subtotal), cols));
  if (bill.gstTotal > 0) {
    w.line(spread(`CGST (${pct(TAX_CONFIG.cgstRate)})`, paiseToRs(bill.cgst), cols));
    w.line(spread(`SGST (${pct(TAX_CONFIG.sgstRate)})`, paiseToRs(bill.sgst), cols));
  }
  w.line(divider);

  // Grand total: bold + double height. (Double WIDTH would halve the columns
  // and overflow "Grand Total … Rs.x" on 58mm paper, so emphasis is vertical.)
  w.raw(BOLD_ON);
  w.raw(SIZE_DOUBLE_HEIGHT);
  w.line(spread("Grand Total", paiseToRs(bill.grandTotal), cols));
  w.raw(SIZE_NORMAL);
  w.raw(BOLD_OFF);
  w.line(divider);

  if (paymentLabel) w.line(kv("Payment", toAscii(paymentLabel).toUpperCase()));
  w.align("center");
  w.line("Thank You!");
  w.line("Visit Again");
  w.align("left");

  w.line();
  w.line();
  w.line();
  w.raw(FEED_AND_CUT);

  return w.done();
}

// ── Kitchen Order Ticket ─────────────────────────────────────────────────────

export interface KotInput {
  profile: Pick<RestaurantProfile, "name">;
  /** The kots doc. `createdAt` may still be null right after the send
   *  transaction (serverTimestamp unresolved) — the ticket prints "now" then. */
  kot: Pick<Kot, "ticketNumber" | "tableLabel" | "orderType" | "items"> &
    Partial<Pick<Kot, "createdAt">>;
  paperWidth: PaperWidth;
}

/** Qty column width on the KOT items table (qty + gap before the name). */
const KOT_QTY_W = 5;

/** Greedy word-wrap to `width` chars, hard-splitting words that don't fit. */
function wrap(text: string, width: number): string[] {
  const words = toAscii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function orderTypeLabel(t: Kot["orderType"]): string {
  switch (t) {
    case "dine-in":
      return "Dine In";
    case "takeaway":
      return "Takeaway";
    case "delivery":
      return "Delivery";
    default:
      return t;
  }
}

/**
 * Encode a Kitchen Order Ticket. A KOT is a KITCHEN document, not a bill:
 * item names, quantities and notes only — deliberately NO prices, GST or
 * totals anywhere. Item rows print double-height bold so the kitchen reads
 * them at a glance; voided lines sink to the end flagged "(VOID)".
 */
export function encodeKot({ profile, kot, paperWidth }: KotInput): EncodedReceipt {
  const cols = lineWidth(paperWidth);
  const divider = "-".repeat(cols);
  const nameW = cols - KOT_QTY_W;
  const w = new ReceiptWriter(cols);

  const createdAt = kot.createdAt ? kot.createdAt.toDate() : new Date();
  const active = kot.items.filter((i) => !i.voided && i.qty > 0);
  const voided = kot.items.filter((i) => i.voided);

  w.raw(INIT);

  // Header: restaurant name + the ticket's destination, centered bold.
  w.align("center");
  w.raw(BOLD_ON);
  w.line(profile.name.toUpperCase());
  w.line("KITCHEN");
  w.raw(BOLD_OFF);
  w.align("left");
  w.line(divider);

  // Ticket number is the hero — kitchen and waiters talk in KOT numbers.
  w.raw(BOLD_ON);
  w.raw(SIZE_DOUBLE_HEIGHT);
  w.line(`KOT #${kot.ticketNumber}`);
  w.raw(SIZE_NORMAL);
  w.line(
    kot.orderType === "dine-in"
      ? `Table ${kot.tableLabel} - Dine In`
      : orderTypeLabel(kot.orderType)
  );
  w.raw(BOLD_OFF);
  w.line(
    spread(`Date: ${formatDateIST(createdAt)}`, `Time: ${formatTimeIST(createdAt)}`, cols)
  );
  w.line(divider);

  // Items table — no amounts column, the whole width belongs to the name.
  w.line("QTY".padEnd(KOT_QTY_W) + "ITEM");
  w.line(divider);
  w.raw(SIZE_DOUBLE_HEIGHT);
  for (const item of [...active, ...voided]) {
    const nameLines = wrap(item.name + (item.voided ? " (VOID)" : ""), nameW);
    w.raw(BOLD_ON);
    w.line(String(item.qty).padEnd(KOT_QTY_W) + nameLines[0]);
    for (const rest of nameLines.slice(1)) {
      w.line(" ".repeat(KOT_QTY_W) + rest);
    }
    w.raw(BOLD_OFF);
    // Notes as indented sub-lines under their item.
    const notes = (item.notes ?? "")
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    for (const note of notes) {
      for (const line of wrap(`- ${note}`, nameW)) {
        w.line(" ".repeat(KOT_QTY_W) + line);
      }
    }
  }
  w.raw(SIZE_NORMAL);
  w.line(divider);

  w.line();
  w.line();
  w.line();
  w.raw(FEED_AND_CUT);

  return w.done();
}

/** Tiny ticket for the Account tab's "Test print" button. */
export function encodeTestTicket(paperWidth: PaperWidth): EncodedReceipt {
  const cols = lineWidth(paperWidth);
  const now = new Date();
  const w = new ReceiptWriter(cols);
  w.raw(INIT);
  w.align("center");
  w.raw(BOLD_ON);
  w.line("SADA POS");
  w.raw(BOLD_OFF);
  w.line("Printer test OK");
  w.line(`${paperWidth}mm / ${cols} cols`);
  w.line(`${formatDateIST(now)} ${formatTimeIST(now)}`);
  w.line("-".repeat(cols));
  w.align("left");
  w.line();
  w.line();
  w.raw(FEED_AND_CUT);
  return w.done();
}
