/**
 * Typed Firestore collection/document reference helpers.
 *
 * Every read/write in the app goes through these — no component builds a
 * collection path by hand. This keeps the multi-tenant prefix
 * (`restaurants/{id}/…`) in exactly one place.
 *
 * MULTI-TENANT: the restaurant id is resolved at RUNTIME (from
 * userIndex/{uid} after sign-in — see AuthContext), not baked in at build
 * time. One APK serves every restaurant; `setActiveRestaurantId` switches
 * which tenant all subsequent refs point at.
 */
import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
} from "firebase/firestore";
import { db, RESTAURANT_ID } from "@/lib/firebase";
import type {
  AppUser,
  Bill,
  BootstrapMeta,
  DailySummary,
  Kot,
  MenuCategory,
  MenuItem,
  Order,
  RestaurantCodeEntry,
  RestaurantProfile,
  Table,
  UserIndexEntry,
} from "@/types/models";

let activeRestaurantId: string | null = null;

/** Point every path helper at this restaurant (null on sign-out). Called by
 *  AuthContext after resolving userIndex/{uid}, and by the signup flows. */
export function setActiveRestaurantId(id: string | null): void {
  activeRestaurantId = id;
}

/**
 * The restaurant every ref is scoped to. Throws if no restaurant has been
 * resolved yet — a query firing before AuthContext resolved the tenant is a
 * bug (it would silently read the wrong restaurant otherwise).
 *
 * In dev builds only, falls back to the env RESTAURANT_ID so pre-migration
 * logins and local tooling keep working.
 */
export function getActiveRestaurantId(): string {
  if (activeRestaurantId) return activeRestaurantId;
  if (typeof __DEV__ !== "undefined" && __DEV__ && RESTAURANT_ID) {
    return RESTAURANT_ID;
  }
  throw new Error(
    "No active restaurant. getActiveRestaurantId() was called before " +
      "sign-in resolved the tenant (userIndex/{uid}) — no Firestore query " +
      "may run before AuthContext sets the restaurant id.",
  );
}

/** Like getActiveRestaurantId but null instead of throwing (no dev fallback). */
export function getActiveRestaurantIdOrNull(): string | null {
  return activeRestaurantId;
}

function root(): string {
  return `restaurants/${getActiveRestaurantId()}`;
}

function col<T>(name: string): CollectionReference<T> {
  return collection(db, `${root()}/${name}`) as CollectionReference<T>;
}

function ref<T>(name: string, id: string): DocumentReference<T> {
  return doc(db, `${root()}/${name}/${id}`) as DocumentReference<T>;
}

export const paths = {
  /** The restaurant ROOT doc — holds the receipt-header profile (name/address)
   *  and the staff join code. */
  restaurantProfile: () =>
    doc(db, root()) as DocumentReference<RestaurantProfile>,

  users: () => col<AppUser>("users"),
  user: (id: string) => ref<AppUser>("users", id),

  /** One-time cashier signup claim flag (see BootstrapMeta). */
  bootstrap: () => ref<BootstrapMeta>("meta", "bootstrap"),

  tables: () => col<Table>("tables"),
  table: (id: string) => ref<Table>("tables", id),

  menuCategories: () => col<MenuCategory>("menuCategories"),
  menuCategory: (id: string) => ref<MenuCategory>("menuCategories", id),

  menuItems: () => col<MenuItem>("menuItems"),
  menuItem: (id: string) => ref<MenuItem>("menuItems", id),

  orders: () => col<Order>("orders"),
  order: (id: string) => ref<Order>("orders", id),

  kots: () => col<Kot>("kots"),
  kot: (id: string) => ref<Kot>("kots", id),

  bills: () => col<Bill>("bills"),
  bill: (id: string) => ref<Bill>("bills", id),

  dailySummaries: () => col<DailySummary>("dailySummaries"),
  dailySummary: (date: string) => ref<DailySummary>("dailySummaries", date),

  /** Monotonic counters (e.g. "kotTicket", "billNumber") for human-facing
   *  sequence numbers. Increment inside a runTransaction. */
  counter: (name: string) => ref<{ value: number }>("counters", name),

  // ── Top-level multi-tenant lookups (NOT under restaurants/{id}) ───────────

  /** userIndex/{uid} → { restaurantId }: which restaurant a login belongs to. */
  userIndex: (uid: string) =>
    doc(db, `userIndex/${uid}`) as DocumentReference<UserIndexEntry>,

  /** restaurantCodes/{code} → { restaurantId }: join-code lookup. */
  restaurantCode: (code: string) =>
    doc(db, `restaurantCodes/${code}`) as DocumentReference<RestaurantCodeEntry>,
};
