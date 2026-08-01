/**
 * SADA POS — canonical data model.
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
  qty: number;
  notes?: string;
  kotStatus: KotItemStatus;
  /** Which KOT ticket this line was sent on (null until sent). */
  kotId: string | null;
  voided: boolean;
  addedAt: Ts;
}

export interface Order {
  id: string;
  tableId: string | null; // null for takeaway/delivery
  orderType: OrderType;
  waiterId: string;
  status: OrderStatus;
  items: OrderItem[];
  /** Sum of non-voided line totals (paise). Recomputed on every write. */
  subtotal: number;
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
  discountPercent: number; // 0–100
  discountAmount: number;
  cgst: number;
  sgst: number;
  gstTotal: number;
  grandTotal: number;
  status: BillStatus;
  paymentMode: PaymentMode | null;
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
  updatedAt: Ts;
}
