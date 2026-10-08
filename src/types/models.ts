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
  /** Whether new bills charge GST — written true at registration, and again
   *  by the setup wizard when the owner answers the question there. It is the
   *  DEFAULT a device adopts when it has no local answer of its own; the live
   *  billing switch stays the device-local SettingsContext. */
  gstEnabled?: boolean;
  /**
   * The owner has actually been ASKED about GST and answered.
   *
   * Distinct from `gstEnabled` on purpose: that field is written `true` at
   * registration, so its value cannot tell "the owner chose to charge GST"
   * from "nobody has ever been asked". Charging tax by default and never
   * raising it is the kind of thing a restaurant discovers from its
   * accountant, so the checklist needs to know the difference. Absent = never
   * asked, which is every restaurant that predates the question.
   */
  gstDecidedAt?: Ts;
  /**
   * FIRST-RUN ACTIVATION IS FINISHED — the getting-started checklist is done
   * with this restaurant and must not appear again on ANY device.
   *
   * It lives here rather than only in AsyncStorage because the checklist is
   * about the RESTAURANT, not about a tablet: with a local-only flag the
   * owner's second device, and every waiter's phone, opened a months-old
   * restaurant and offered to walk it through taking its first order. The
   * local flag is kept as a cache so the card never flashes on a cold start.
   *
   * Absent = still activating, matching `needsSetup` and the trial fields:
   * absence is the state every restaurant that predates this field is in, and
   * they graduate the moment they meet the auto-retire test instead.
   */
  activationDoneAt?: Ts;

  // ── HOW THIS RESTAURANT WORKS (the first-run setup wizard's answers) ──────
  //
  // ABSENT = the app exactly as it was before the wizard existed: kitchen
  // tickets on, a floor of tables. That is the same absence-is-the-safe-
  // default property the trial fields rely on, and it is what makes these
  // safe to add to a live product — every restaurant that registered before
  // this shipped has none of them and is completely unaffected.
  //
  // They live HERE, on the restaurant, and NOT in the device-local
  // SettingsContext: the cashier's tablet and a waiter's phone have to agree
  // about whether this restaurant has a kitchen display, or one of them shows
  // a Send-KOT button whose ticket the other can never see.

  /** What kind of place this is. Drives nothing on its own — it is the reason
   *  the other two are what they are, and what the starter menu was seeded
   *  from. Kept so the setup screen can show what was picked. */
  businessType?: "cafe" | "qsr" | "foodtruck" | "restaurant";
  /**
   * Do orders go to the kitchen as a ticket before they are billed?
   *
   * `false` is QUICK BILLING: no KDS tab, no Send-KOT step, the order screen
   * bills straight from the cart, and the billing guard stops demanding a
   * completed ticket. ABSENT = true.
   */
  kotEnabled?: boolean;
  /** Does this restaurant seat guests at tables? `false` hides the floor and
   *  the table setup screen, and takeaway becomes the only order type.
   *  ABSENT = true. */
  tablesEnabled?: boolean;
  /**
   * FIRST-RUN MARKER. Written `true` by the owner-registration batch and
   * DELETED when the wizard finishes; while it is true the owner is routed to
   * /setup on every launch, so an interrupted setup resumes rather than
   * leaving a half-configured restaurant.
   *
   * The wizard is gated on this rather than on "no config fields yet"
   * precisely because every restaurant that predates the wizard also has no
   * config fields — gating on absence would have shown the wizard to the
   * entire existing customer base on their next launch.
   */
  needsSetup?: boolean;
  /**
   * DEAD FIELD — kept only so old documents still type-check.
   *
   * It used to start the 3-day self-serve trial: the create rule demanded
   * `trialStartedAt == request.time` and the deadline was computed from it.
   * THERE IS NO TRIAL ANY MORE. Nothing reads this — not the rules, not
   * AuthContext — and the create rule now REJECTS it, so no new restaurant
   * can have one. Restaurants registered under the old build still carry the
   * stamp; ignoring it is exactly what stops them from locking out.
   *
   * Do not read it, and do not write it. `scripts/stripLegacyTrials.js`
   * removes it from existing documents.
   */
  trialStartedAt?: Ts;
  /**
   * THE ONLY DEADLINE. A subscription's paid-through date, or a manual
   * lockout. Written only through the Admin SDK; no client can set, change or
   * clear it. The writers are the Play Billing functions in `functions/`
   * (automatic — renewals push this forward, refunds push it into the past)
   * and `scripts/activateTenant.js` (manual). See CLAUDE.md.
   *
   * ABSENT = NEVER EXPIRES, which is now the ordinary case: a new restaurant
   * is born without it and is entirely unaffected by the expiry rules.
   */
  expiresAt?: Ts;
  /**
   * What Google Play last said about this restaurant's subscription. Written
   * by the billing functions next to `expiresAt`, absent on a restaurant that
   * has never subscribed.
   *
   * DISPLAY ONLY. It exists so the Account screen can say "Renews on 8 Nov"
   * instead of counting down to a date that is about to move. Nothing gates
   * on it — access is `expiresAt` and nothing else, in the rules and in
   * AuthContext alike.
   */
  subscription?: {
    /** Google will charge again at the end of the period. */
    autoRenew: boolean;
    /** The end of the period already paid for (or of the free trial).
     *  `expiresAt` sits a little after this while `autoRenew` is true. */
    paidThrough?: Ts;
  };
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
  /**
   * The owner's mobile number in E.164 (`+919876543210`) — collected on the
   * signup screen, India only (see `features/auth/phone.ts` for why there is
   * no country picker).
   *
   * OPTIONAL, and it has to stay optional: every restaurant registered before
   * the field existed carries no phone, and staff who join with a code are
   * never asked for one — the number is how we reach the person who pays, and
   * that is the owner. Absent means "never collected", so nothing may treat
   * its absence as a bad number.
   */
  phone?: string;
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

/**
 * One priced choice of a dish — "Chicken ₹220", "Veg ₹180", "Crunchy ₹250".
 *
 * A variant is a PRICE, not a product: it shares the parent's category, photo
 * and offer scope, which is why offers keep working untouched (they scope by
 * `menuItemId`/`categoryId`, and a variant changes neither).
 *
 * `id` is minted client-side and is stable for the life of the variant. Order
 * lines snapshot it, so RENAMING or REPRICING a variant never reaches back
 * into an order that already used it — the same rule the offer stamps follow.
 */
export interface MenuVariant {
  id: string;
  name: string;
  /** Price in paise (integer) for THIS choice. Overrides MenuItem.price. */
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  categoryId: string;
  /**
   * Price in paise (integer) to avoid float rounding. ₹85.00 => 8500.
   *
   * With `variants` present this is the CHEAPEST variant's price, maintained
   * on every write by the menu form. It is what "from ₹180" reads, and it is
   * why nothing that predates variants had to change: every existing reader
   * still finds a sane single price here instead of a zero or a stale one.
   */
  price: number;
  /**
   * Priced choices for this dish. ABSENT or EMPTY = a plain item that adds
   * straight to the order at `price`; one or more variants means the waiter
   * must pick one, so the card opens the Customize sheet instead of adding.
   *
   * Never let this hold exactly one variant as a way of "labelling" a price —
   * a single choice is not a choice, and the sheet would ask a question with
   * one answer.
   */
  variants?: MenuVariant[];
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
  /**
   * What the line is CALLED, everywhere it is read — the cart, the kitchen
   * ticket, the thermal print, the bill. For a variant line this is composed
   * as `Burger (Chicken)` at the moment of adding.
   *
   * Composing it here rather than leaving each reader to join the two parts is
   * deliberate: the KOT, the ESC/POS encoder, the KDS card and the bill all
   * already print `name`, so the cook and the guest see the right thing with
   * no code in any of those paths knowing variants exist.
   */
  name: string;
  /**
   * Which variant was chosen, when the item had any. `variantId` is the key
   * the order screen matches on — two variants of one dish are two lines, and
   * tapping ＋ on the card must find the right one. `variantName` is the bare
   * choice ("Chicken"), kept apart from the composed `name` so a report can
   * still group by it. ABSENT on a plain item, and on every line written
   * before variants existed.
   */
  variantId?: string;
  variantName?: string;
  /** Snapshot of price (paise) at time of adding — never trust live price.
   *  For a variant line this is the VARIANT's price, not the item's. */
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
