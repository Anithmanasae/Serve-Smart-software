/**
 * Smart Serve — canonical data model.
 *
 * This is the single source of truth for document shapes across every module.
 * Subagents: import from here, do NOT redefine these types locally.
 *
 * Firestore layout (multi-tenant SaaS — one APK serves every restaurant; the
 * active restaurant is resolved at runtime from userIndex/{uid}):
 *   userIndex/{uid}          -> { restaurantId }   // login → restaurant
 *   restaurantCodes/{code}   -> { restaurantId }   // join code → restaurant
 *   restaurants/{restaurantId}/
 *     users/{uid}
 *     tables/{tableId}
 *     menuCategories/{categoryId}
 *     menuItems/{itemId}
 *     offers/{offerId}
 *     orders/{orderId}
 *     kots/{kotId}
 *     bills/{billId}
 *     dailySummaries/{yyyy-mm-dd}
 */

import type { Timestamp } from "firebase/firestore";

/** Firestore write time — a Timestamp once persisted, may be null pre-commit. */
export type Ts = Timestamp | null;

// ─────────────────────────────────────────────────────────────────────────────
// Roles & users
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "admin" | "waiter" | "cashier" | "kitchen";

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant profile (the restaurants/{id} ROOT doc)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What prints on the receipt header. Stored on the restaurant root doc so one
 * APK serves many restaurants: each tenant edits its own name/address from the
 * Account tab and bills print under that identity.
 */
export interface RestaurantProfile {
  name: string;
  addressLine?: string;
  /** Short human code (e.g. "K7MPQ2") owners share so staff can join this
   *  restaurant from the signup screen. Mirrored in restaurantCodes/{code}. */
  joinCode?: string;
  /** Whether new bills charge GST — written true at registration. The live
   *  billing switch is still the device-local SettingsContext. */
  gstEnabled?: boolean;
  /**
   * SELF-SERVE TRIALS. Stamped by the SERVER at registration — the create rule
   * demands `trialStartedAt == request.time`, which only a serverTimestamp()
   * sentinel satisfies, so a client can neither backdate nor omit it. The
   * deadline is COMPUTED as `trialStartedAt + 2 days` in firestore.rules
   * (`trialLength()`), never stored, so there is nothing to tamper with.
   *
   * Every new restaurant has this. Activating a paying customer DELETES it.
   */
  trialStartedAt?: Ts;
  /**
   * An explicit deadline that OVERRIDES the computed one — a custom trial
   * length, or a subscription's paid-through date. Written only through the
   * Admin SDK (scripts/seedTrial.js, the activation tooling); no client can
   * set, change or clear it.
   *
   * ABSENT trialStartedAt AND expiresAt = NEVER EXPIRES. Real customers have
   * neither field and are entirely unaffected by the expiry rules.
   */
  expiresAt?: Ts;
  updatedAt: Ts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant lookups (top-level collections, OUTSIDE /restaurants)
// ─────────────────────────────────────────────────────────────────────────────

/** userIndex/{uid} — which restaurant a login belongs to. Written once in the
 *  same batch as the user's profile doc; immutable thereafter (rules). */
export interface UserIndexEntry {
  restaurantId: string;
}

/** restaurantCodes/{code} — join-code → restaurant lookup. Created atomically
 *  with the restaurant at registration; immutable thereafter (rules). */
export interface RestaurantCodeEntry {
  restaurantId: string;
}

/**
 * Signup approval lifecycle. `status` is the one-time gate (did the cashier
 * accept this signup?); `active` is the day-to-day switch (restricted for the
 * day / fired). Only `approved` + `active` profiles can use the app.
 */
export type UserStatus = "pending" | "approved" | "denied";

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  active: boolean;
  photoUrl?: string;
  /** On staff self-signup: the join code the person entered. The rules verify
   *  it against the restaurant's real code, so knowing the code is enforced
   *  server-side — a client can't plant a pending profile in a restaurant
   *  whose code it doesn't know. */
  joinCode?: string;
  /**
   * TRIAL ACCOUNTS ONLY. Mirrors the workspace expiry onto the individual
   * login so the app can show a countdown and flip to the "trial ended" screen
   * without a second listener. ABSENT = NEVER EXPIRES.
   *
   * The client reads this for UX only — enforcement is firestore.rules against
   * request.time (the server clock). Written only by scripts/seedTrial.js.
   */
  expiresAt?: Ts;
  createdAt: Ts;
}

/**
 * restaurants/{id}/meta/bootstrap — single doc guarding the one-time cashier
 * ("2nd owner") self-signup. Once claimed, the cashier option disappears from
 * the signup screen and the rules reject any further cashier self-creation.
 */
export interface BootstrapMeta {
  cashierClaimed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

export type TableStatus = "available" | "occupied" | "billed";

export type OrderType = "dine-in" | "takeaway" | "delivery";

export interface Table {
  id: string;
  number: number;
  label?: string; // e.g. "T12", "Patio 3"
  capacity: number;
  status: TableStatus;
  /** The open order occupying this table, if any. */
  currentOrderId: string | null;
  /** When merged, secondary tables point at the primary table id. */
  mergedInto: string | null;
  updatedAt: Ts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu
// ─────────────────────────────────────────────────────────────────────────────

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  categoryId: string;
  /** Price in paise (integer) to avoid float rounding. ₹85.00 => 8500. */
  price: number;
  enabled: boolean;
  imageUrl?: string;
  description?: string;
  sku?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers (product discounts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How an offer computes its discount. Deliberately only four, because every
 * promotion an owner asks for is one of these plus a SCHEDULE:
 *
 *   "Monday Madness"  = `percent` + days:[1]
 *   "BOGO"            = `bogo`, buyQty 1 / freeQty 1
 *   "Couple Coffee"   = `bundle`, bundleQty 2 / bundlePrice 19900
 *   "Happy Hour"      = `percent` + startMinutes/endMinutes
 *
 * Adding a fifth kind should feel wrong — check whether it is really a
 * schedule or a scope on one of these first.
 */
export type OfferKind =
  /** X% off each covered unit. */
  | "percent"
  /** A flat ₹X off each covered unit (never below free). */
  | "flat"
  /** Buy N, get M free — the M CHEAPEST covered units cost nothing. */
  | "bogo"
  /** Any N covered units for a fixed price (a combo/meal deal). */
  | "bundle";

export const OFFER_KINDS: readonly OfferKind[] = [
  "percent",
  "flat",
  "bogo",
  "bundle",
];

export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  percent: "% Off",
  flat: "₹ Off",
  bogo: "Buy N Get M",
  bundle: "Combo Price",
};

/** Sun-first, matching `istDayOfWeek()`. Index = the stored day number. */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A restaurant's discount rule, e.g. "Monday Madness — 30% off Desserts".
 *
 * An offer is never applied by hand: the pricing engine (`src/lib/offers.ts`)
 * matches live offers against the order's lines and stamps the resulting
 * discount onto each line. What it stamps is a SNAPSHOT (`offerName` and the
 * paise amount live on the order line), so editing or deleting an offer never
 * reaches back and rewrites a bill that already used it.
 *
 * ABSENT schedule fields = always live, which mirrors the trial fields'
 * "absence is the safe default" property: a promo the owner never restricted
 * runs every day rather than silently never running.
 */
export interface Offer {
  id: string;
  /** What the customer sees on the bill, e.g. "Monday Madness". */
  name: string;
  kind: OfferKind;
  /** The day-to-day switch. `false` = configured but not running. */
  enabled: boolean;

  // ── Scope: which products it covers ──────────────────────────────────────
  /** Specific menu items. */
  itemIds: string[];
  /** Whole categories — new items added to one join the offer automatically. */
  categoryIds: string[];

  // ── The numbers. Only the fields its `kind` uses are set. ────────────────
  /** `percent`: 0–100. */
  percentOff?: number;
  /** `flat`: paise off each unit. */
  amountOff?: number;
  /** `bogo`: units that must be paid for. */
  buyQty?: number;
  /** `bogo`: units given free per set. */
  freeQty?: number;
  /** `bundle`: units in one combo. */
  bundleQty?: number;
  /** `bundle`: paise the combo costs in total. */
  bundlePrice?: number;

  // ── Schedule (all IST — see istDayOfWeek/istMinutesOfDay) ────────────────
  /** 0=Sun … 6=Sat. Absent/empty = every day. THIS is "Monday Madness". */
  days?: number[];
  /** Minutes past IST midnight. Both bounds or neither; absent = all day.
   *  `startMinutes > endMinutes` is a window that wraps midnight (22:00–02:00). */
  startMinutes?: number;
  endMinutes?: number;
  /** Campaign window, yyyy-mm-dd IST inclusive. Absent = unbounded. */
  startsOn?: string;
  endsOn?: string;

  /** Cap on how many times the offer may trigger within ONE order (bogo sets /
   *  bundle sets). Absent = uncapped. */
  maxPerOrder?: number;
  /** Tie-break when two offers give a line the same discount; higher wins. */
  priority: number;
  createdAt: Ts;
  updatedAt: Ts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders & KOT
// ─────────────────────────────────────────────────────────────────────────────

export type OrderStatus = "open" | "billed" | "closed" | "cancelled";

/** Per-item KOT lifecycle so "add extra items later" only fires new items. */
export type KotItemStatus = "pending" | "sent" | "preparing" | "ready" | "served";

export interface OrderItem {
  /** Stable line id (uuid) — items with the same menuItemId but different
   *  notes are distinct lines. */
  lineId: string;
  menuItemId: string;
  name: string;
  /** Snapshot of price (paise) at time of adding — never trust live price. */
  price: number;
  /** Snapshot of the item's category, so category-scoped offers can be priced
   *  from the order alone without a menu lookup. Absent on lines created
   *  before offers existed — such a line simply misses category offers. */
  categoryId?: string;
  qty: number;
  notes?: string;
  kotStatus: KotItemStatus;
  /** Which KOT ticket this line was sent on (null until sent). */
  kotId: string | null;
  voided: boolean;
  /**
   * OFFERS. `price` above stays the UNDISCOUNTED menu price and `qty` the real
   * quantity — a BOGO line is 2 units at full price with one unit's worth
   * knocked off here, NOT 2 units at half price. That distinction is what lets
   * the reports separate "we sold ₹300 of coffee" from "₹150 of it was given
   * away", and it is why the kitchen ticket needs no knowledge of offers at
   * all: it reads `qty` and sends out two coffees.
   *
   * `offerName` is snapshotted so deleting the offer never rewrites history.
   * ABSENT = no offer applied.
   */
  offerId?: string;
  offerName?: string;
  /** Paise off this WHOLE line (not per unit). Never exceeds price * qty. */
  offerDiscount?: number;
  addedAt: Ts;
}

export interface Order {
  id: string;
  tableId: string | null; // null for takeaway/delivery
  orderType: OrderType;
  waiterId: string;
  status: OrderStatus;
  items: OrderItem[];
  /** Sum of non-voided line totals (paise), BEFORE offers. Recomputed on every
   *  write. Deliberately gross so the figure keeps meaning what it always did. */
  subtotal: number;
  /** Σ of the lines' `offerDiscount` (paise). What the customer actually owes
   *  before tax is `subtotal - offerDiscount`. Absent = no offers on this
   *  order; always read with `?? 0`. */
  offerDiscount?: number;
  billId: string | null;
  createdAt: Ts;
  updatedAt: Ts;
}

export type KotStatus = "new" | "preparing" | "ready" | "completed";

export interface KotItem {
  lineId: string;
  menuItemId: string;
  name: string;
  qty: number;
  notes?: string;
  voided: boolean;
}

/** A kitchen ticket: one batch of items sent to the kitchen at once. */
export interface Kot {
  id: string;
  orderId: string;
  tableId: string | null;
  tableLabel: string; // denormalized for the KDS card header
  orderType: OrderType;
  ticketNumber: number; // human-facing #4092
  items: KotItem[];
  status: KotStatus;
  printedCount: number;
  createdAt: Ts;
  updatedAt: Ts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bills & payments
// ─────────────────────────────────────────────────────────────────────────────

export type BillStatus = "requested" | "finalized" | "paid" | "void";

export type PaymentMode = "cash" | "upi" | "card";

/**
 * Why a bill was comped (see `Bill.nonChargeable`). A fixed set rather than
 * free text, because the owner's question is "what did staff meals cost me
 * this month?" — only a stable key can be totalled. The detail goes in
 * `ncNote`.
 */
export type NcReason = "owner" | "staff" | "complaint" | "pr" | "other";

/** Display order for the reason chips and the NC report breakdown. */
export const NC_REASONS: readonly NcReason[] = [
  "owner",
  "staff",
  "complaint",
  "pr",
  "other",
];

export const NC_REASON_LABELS: Record<NcReason, string> = {
  owner: "Owner / Family",
  staff: "Staff Meal",
  complaint: "Complaint / Remake",
  pr: "PR / Influencer",
  other: "Other",
};

/**
 * Why a settled bill was CANCELLED (see `Bill.voidReason`). Same fixed-set
 * reasoning as `NcReason`: the owner's question is "how often are we having to
 * refund bad food?", and only a stable key can be totalled.
 *
 * A void is not a comp. NC is decided BEFORE money changes hands — the meal is
 * given away. A void undoes a payment that was already taken: the customer was
 * charged, something went wrong, and the money goes back.
 */
export type VoidReason =
  | "bad-food"
  | "wrong-order"
  | "customer-complaint"
  | "billing-error"
  | "other";

/** Display order for the reason chips. */
export const VOID_REASONS: readonly VoidReason[] = [
  "bad-food",
  "wrong-order",
  "customer-complaint",
  "billing-error",
  "other",
];

export const VOID_REASON_LABELS: Record<VoidReason, string> = {
  "bad-food": "Bad Food",
  "wrong-order": "Wrong Order",
  "customer-complaint": "Customer Complaint",
  "billing-error": "Billing Error",
  other: "Other",
};

export interface Bill {
  id: string;
  /** Sequential human-facing number minted from counters/billNumber (printed
   *  zero-padded, e.g. "000101"). Absent on bills created before the counter
   *  existed. */
  billNumber?: number;
  orderId: string;
  tableId: string | null;
  tableLabel: string;
  /** All money fields in paise (integer). */
  subtotal: number;
  /**
   * MANUAL discount — a cashier typing "10% off this table". Pinned to 0 by
   * firestore.rules and there is no UI for it: an ad-hoc discount at the till
   * is indistinguishable from theft. Offers are a different thing entirely and
   * live in `offerDiscount` below, which is why these two stay at zero.
   */
  discountPercent: number; // 0–100
  discountAmount: number;
  /**
   * OFFERS — Σ of the order lines' `offerDiscount` (paise). A discount the
   * OWNER configured in advance, applied automatically by the pricing engine,
   * as opposed to the manual one above that nobody may grant.
   *
   * `subtotal` stays gross, so `subtotal - offerDiscount` is the taxable base
   * and the receipt can show the customer what they saved. Absent on bills
   * created before offers existed; always read with `?? 0`.
   */
  offerDiscount?: number;
  cgst: number;
  sgst: number;
  gstTotal: number;
  grandTotal: number;
  status: BillStatus;
  paymentMode: PaymentMode | null;
  /**
   * NON-CHARGEABLE ("NC") — the meal was comped: nothing was collected and this
   * bill is excluded from every revenue figure. ABSENT = an ordinary chargeable
   * bill; the same "absence is the safe default" property the trial fields use,
   * so a bill can only become free if someone explicitly said so.
   *
   * Written ONLY on the settle write (`settleBill`), never at bill creation,
   * and frozen afterwards because the bill is then `paid` (rules). That same
   * write is pinned by the rules to the bill's existing subtotal/gstTotal/
   * grandTotal, so the value of a comp can never be zeroed out to hide it.
   */
  nonChargeable?: boolean;
  /** Why it was comped. The rules require it whenever nonChargeable is true. */
  ncReason?: NcReason;
  /** Optional free-text detail alongside the preset reason (<= 140 chars). */
  ncNote?: string;
  /**
   * CANCELLED ("VOID") — the bill was settled and then reversed, and the sale
   * has been backed out of that day's summary. ABSENT = a live transaction,
   * the same "absence is the safe default" property NC and the trial fields
   * use: a bill is only cancelled because someone explicitly cancelled it.
   *
   * Only a bill paid on the CURRENT IST business day can be cancelled (rules),
   * so a day whose figures the owner has already read never changes underneath
   * them. `status` moves 'paid' -> 'void' and stays there — void is terminal.
   *
   * The bill keeps its real totals. What the cancellation was worth is the
   * whole point of recording it.
   */
  voidedAt?: Ts;
  voidedBy?: string; // cashier/admin uid, pinned to request.auth.uid by rules
  voidReason?: VoidReason;
  /** Optional free-text detail alongside the preset reason (<= 140 chars). */
  voidNote?: string;
  requestedBy: string; // waiter uid
  cashierId: string | null;
  printedCount: number;
  createdAt: Ts;
  paidAt: Ts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

export interface DailySummary {
  id: string; // yyyy-mm-dd
  date: string;
  totalRevenue: number; // paise
  orderCount: number;
  voidedItemCount: number;
  byPaymentMode: Record<PaymentMode, number>;
  bySource: Record<OrderType, number>;
  /** menuItemId -> { name, qty, revenue } */
  itemSales: Record<string, { name: string; qty: number; revenue: number }>;
  /**
   * NON-CHARGEABLE totals. Comped bills are deliberately absent from
   * totalRevenue, orderCount, byPaymentMode, bySource and itemSales — they are
   * tallied only here, so the owner can see what comps cost without them
   * inflating sales or dragging down avg order value.
   *
   * Absent on summaries written before NC existed; always read with `?? 0`.
   */
  ncCount?: number;
  ncAmount?: number; // paise — the value given away
  byNcReason?: Record<NcReason, number>; // paise per reason
  /**
   * CANCELLED bills. A void REVERSES its sale out of the buckets above — the
   * figures stay truthful — and is tallied here so the reversal is still
   * visible. Without these two the money would simply vanish from the day and
   * nobody could tell a cancelled sale from one that never happened.
   *
   * Absent on summaries written before voids existed; always read with `?? 0`.
   */
  voidedBillCount?: number;
  voidedRevenue?: number; // paise refunded
  /**
   * OFFERS. `totalRevenue` is what was actually taken, so it is already NET of
   * offers — this is the money the promotions gave away to earn it, which is
   * the only way the owner can answer "is Monday Madness worth running?".
   *
   * `byOffer` breaks that down per offer so a promo that costs a lot and sells
   * nothing is visible next to one that pays for itself. Keyed by offer id
   * with the name snapshotted, so a deleted offer keeps its history readable.
   *
   * Absent on summaries written before offers existed; always read with `?? 0`.
   */
  offerDiscount?: number;
  byOffer?: Record<string, { name: string; count: number; amount: number }>;
  updatedAt: Ts;
}
