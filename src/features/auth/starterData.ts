/**
 * STARTER DATA for a brand-new restaurant, chosen by what kind of place it is.
 *
 * A trial that opens onto an empty menu demos badly — the prospect has to do
 * twenty minutes of data entry before they can see the thing work. This seeds
 * a small, obviously-placeholder menu and floor so they can take an order
 * within seconds, then edit or delete all of it from Menu Management.
 *
 * It used to seed ONE menu for everybody: an Indian restaurant card and eight
 * tables, handed alike to a 40-cover restaurant and to a food truck that has
 * no tables at all. The first thing a food-truck owner did with the app was
 * therefore delete eight tables. Now the setup wizard's answers pick the menu
 * and the floor, which is most of what makes setup feel like it did something.
 *
 * WHEN THIS RUNS: at the END of the setup wizard, not during registration —
 * the answers do not exist yet when the restaurant is created. See
 * `features/onboarding/onboardingApi`.
 *
 * The writes go through the ordinary client SDK as the newly-created cashier,
 * so they are subject to the same security rules as any other menu edit.
 * Prices are integer PAISE (see src/lib/money.ts) — ₹120.00 is 12000.
 */
import {
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { paths } from "@/lib/firestore/paths";
import type { BusinessType } from "@/features/settings/restaurantConfig";
import type { MenuCategory, MenuItem, Table } from "@/types/models";

type StarterCategory = Omit<MenuCategory, "id"> & { id: string };
type StarterItem = Omit<MenuItem, "id"> & { id: string };

interface StarterMenu {
  categories: StarterCategory[];
  items: StarterItem[];
}

// ── café ─────────────────────────────────────────────────────────────────────
const CAFE: StarterMenu = {
  categories: [
    { id: "coffee", name: "Coffee", sortOrder: 1, enabled: true },
    { id: "tea", name: "Tea", sortOrder: 2, enabled: true },
    { id: "cold", name: "Cold Drinks", sortOrder: 3, enabled: true },
    { id: "bakes", name: "Bakes", sortOrder: 4, enabled: true },
    { id: "snacks", name: "Snacks", sortOrder: 5, enabled: true },
  ],
  items: [
    { id: "cafe-espresso", name: "Espresso", categoryId: "coffee", price: 12000, enabled: true },
    { id: "cafe-cappuccino", name: "Cappuccino", categoryId: "coffee", price: 16000, enabled: true },
    { id: "cafe-latte", name: "Café Latte", categoryId: "coffee", price: 18000, enabled: true },
    { id: "cafe-filter-coffee", name: "Filter Coffee", categoryId: "coffee", price: 6000, enabled: true },
    { id: "cafe-masala-chai", name: "Masala Chai", categoryId: "tea", price: 3000, enabled: true },
    { id: "cafe-green-tea", name: "Green Tea", categoryId: "tea", price: 8000, enabled: true },
    { id: "cafe-cold-coffee", name: "Cold Coffee", categoryId: "cold", price: 18000, enabled: true },
    { id: "cafe-iced-tea", name: "Iced Tea", categoryId: "cold", price: 14000, enabled: true },
    { id: "cafe-lime-soda", name: "Fresh Lime Soda", categoryId: "cold", price: 7000, enabled: true },
    { id: "cafe-croissant", name: "Butter Croissant", categoryId: "bakes", price: 12000, enabled: true },
    { id: "cafe-muffin", name: "Chocolate Muffin", categoryId: "bakes", price: 10000, enabled: true },
    { id: "cafe-banana-bread", name: "Banana Bread", categoryId: "bakes", price: 9000, enabled: true },
    { id: "cafe-veg-sandwich", name: "Veg Sandwich", categoryId: "snacks", price: 14000, enabled: true },
    { id: "cafe-grilled-cheese", name: "Grilled Cheese Sandwich", categoryId: "snacks", price: 16000, enabled: true },
  ],
};

// ── quick service ────────────────────────────────────────────────────────────
const QSR: StarterMenu = {
  categories: [
    { id: "burgers", name: "Burgers", sortOrder: 1, enabled: true },
    { id: "rolls", name: "Rolls & Wraps", sortOrder: 2, enabled: true },
    { id: "sides", name: "Sides", sortOrder: 3, enabled: true },
    { id: "combos", name: "Combos", sortOrder: 4, enabled: true },
    { id: "beverages", name: "Beverages", sortOrder: 5, enabled: true },
  ],
  items: [
    { id: "qsr-veg-burger", name: "Veg Burger", categoryId: "burgers", price: 12000, enabled: true },
    { id: "qsr-chicken-burger", name: "Chicken Burger", categoryId: "burgers", price: 16000, enabled: true },
    { id: "qsr-cheese-burst", name: "Cheese Burst Burger", categoryId: "burgers", price: 18000, enabled: true },
    { id: "qsr-paneer-roll", name: "Paneer Roll", categoryId: "rolls", price: 14000, enabled: true },
    { id: "qsr-chicken-roll", name: "Chicken Roll", categoryId: "rolls", price: 16000, enabled: true },
    { id: "qsr-egg-roll", name: "Egg Roll", categoryId: "rolls", price: 12000, enabled: true },
    { id: "qsr-fries", name: "French Fries", categoryId: "sides", price: 9000, enabled: true },
    { id: "qsr-peri-fries", name: "Peri Peri Fries", categoryId: "sides", price: 11000, enabled: true },
    { id: "qsr-nuggets", name: "Chicken Nuggets", categoryId: "sides", price: 14000, enabled: true },
    { id: "qsr-burger-combo", name: "Burger + Fries + Drink", categoryId: "combos", price: 22000, enabled: true },
    { id: "qsr-roll-combo", name: "Roll + Fries", categoryId: "combos", price: 19000, enabled: true },
    { id: "qsr-cola", name: "Cola", categoryId: "beverages", price: 5000, enabled: true },
    { id: "qsr-cold-coffee", name: "Cold Coffee", categoryId: "beverages", price: 12000, enabled: true },
    { id: "qsr-water", name: "Mineral Water", categoryId: "beverages", price: 2000, enabled: true },
  ],
};

// ── food truck / stall ───────────────────────────────────────────────────────
// Deliberately the shortest list: a truck sells a handful of things, and a
// long placeholder menu is a long placeholder menu to delete.
const FOOD_TRUCK: StarterMenu = {
  categories: [
    { id: "street", name: "Street Food", sortOrder: 1, enabled: true },
    { id: "sides", name: "Sides", sortOrder: 2, enabled: true },
    { id: "drinks", name: "Drinks", sortOrder: 3, enabled: true },
  ],
  items: [
    { id: "truck-pav-bhaji", name: "Pav Bhaji", categoryId: "street", price: 10000, enabled: true },
    { id: "truck-vada-pav", name: "Vada Pav", categoryId: "street", price: 4000, enabled: true },
    { id: "truck-misal-pav", name: "Misal Pav", categoryId: "street", price: 9000, enabled: true },
    { id: "truck-chole-bhature", name: "Chole Bhature", categoryId: "street", price: 12000, enabled: true },
    { id: "truck-masala-fries", name: "Masala Fries", categoryId: "sides", price: 8000, enabled: true },
    { id: "truck-cheese-corn", name: "Cheese Corn", categoryId: "sides", price: 7000, enabled: true },
    { id: "truck-chai", name: "Masala Chai", categoryId: "drinks", price: 2000, enabled: true },
    { id: "truck-lemon-soda", name: "Lemon Soda", categoryId: "drinks", price: 4000, enabled: true },
    { id: "truck-buttermilk", name: "Buttermilk", categoryId: "drinks", price: 3000, enabled: true },
  ],
};

// ── full restaurant ──────────────────────────────────────────────────────────
// The original one-size-fits-all seed, now the seed for the kind of place it
// was actually written for.
const RESTAURANT: StarterMenu = {
  categories: [
    { id: "starters", name: "Starters", sortOrder: 1, enabled: true },
    { id: "mains", name: "Main Course", sortOrder: 2, enabled: true },
    { id: "breads", name: "Breads & Rice", sortOrder: 3, enabled: true },
    { id: "drinks", name: "Drinks", sortOrder: 4, enabled: true },
    { id: "desserts", name: "Desserts", sortOrder: 5, enabled: true },
  ],
  items: [
    { id: "starter-paneer-tikka", name: "Paneer Tikka", categoryId: "starters", price: 22000, enabled: true },
    { id: "starter-chicken-65", name: "Chicken 65", categoryId: "starters", price: 24000, enabled: true },
    { id: "starter-veg-spring-roll", name: "Veg Spring Roll", categoryId: "starters", price: 16000, enabled: true },
    { id: "starter-gobi-manchurian", name: "Gobi Manchurian", categoryId: "starters", price: 18000, enabled: true },
    { id: "main-butter-chicken", name: "Butter Chicken", categoryId: "mains", price: 32000, enabled: true },
    { id: "main-paneer-butter-masala", name: "Paneer Butter Masala", categoryId: "mains", price: 26000, enabled: true },
    { id: "main-veg-biryani", name: "Veg Biryani", categoryId: "mains", price: 22000, enabled: true },
    { id: "main-chicken-biryani", name: "Chicken Biryani", categoryId: "mains", price: 28000, enabled: true },
    { id: "main-dal-tadka", name: "Dal Tadka", categoryId: "mains", price: 18000, enabled: true },
    { id: "bread-butter-naan", name: "Butter Naan", categoryId: "breads", price: 5000, enabled: true },
    { id: "bread-tandoori-roti", name: "Tandoori Roti", categoryId: "breads", price: 3500, enabled: true },
    { id: "bread-jeera-rice", name: "Jeera Rice", categoryId: "breads", price: 14000, enabled: true },
    { id: "drink-masala-chai", name: "Masala Chai", categoryId: "drinks", price: 3000, enabled: true },
    { id: "drink-sweet-lassi", name: "Sweet Lassi", categoryId: "drinks", price: 8000, enabled: true },
    { id: "drink-fresh-lime-soda", name: "Fresh Lime Soda", categoryId: "drinks", price: 7000, enabled: true },
    { id: "drink-mineral-water", name: "Mineral Water", categoryId: "drinks", price: 2000, enabled: true },
    { id: "dessert-gulab-jamun", name: "Gulab Jamun", categoryId: "desserts", price: 9000, enabled: true },
    { id: "dessert-ice-cream", name: "Ice Cream", categoryId: "desserts", price: 8000, enabled: true },
  ],
};

const MENUS: Record<BusinessType, StarterMenu> = {
  cafe: CAFE,
  qsr: QSR,
  foodtruck: FOOD_TRUCK,
  restaurant: RESTAURANT,
};

/**
 * The kind of place whose menu is handed to anyone we don't recognise.
 *
 * `businessType` reaches this file from a wizard answer, from a stash written
 * by an OLDER build (`pendingSetup`), or from a restaurant document that
 * predates the question — so it can be null, or a string this build has never
 * heard of. Indexing `MENUS` with one of those yields `undefined`, the seed
 * then threw on `menu.categories`, and the throw was swallowed as
 * best-effort: the owner landed on an EMPTY menu, which is the single outcome
 * this file exists to prevent. The full restaurant menu is the safe stand-in —
 * it is the widest of the four, and every line of it is as editable and as
 * deletable as anything the owner types in themselves.
 */
const FALLBACK_TYPE: BusinessType = "restaurant";

/** A starter menu for ANY answer, including no answer and an unknown one. */
export function menuFor(
  businessType: BusinessType | null | undefined
): StarterMenu {
  return (businessType && MENUS[businessType]) || MENUS[FALLBACK_TYPE];
}

const TABLE_CAPACITY = 4;

/** How many items the chosen menu will add — the setup summary says so. */
export function starterItemCount(businessType: BusinessType): number {
  return menuFor(businessType).items.length;
}

/** Categories then items, at fixed ids, so seeding twice lands where once did. */
function queueMenu(batch: WriteBatch, menu: StarterMenu): void {
  for (const category of menu.categories) {
    const { id, ...data } = category;
    batch.set(paths.menuCategory(id), data as MenuCategory);
  }
  for (const item of menu.items) {
    const { id, ...data } = item;
    batch.set(paths.menuItem(id), data as MenuItem);
  }
}

/** `tableCount` of 0 queues no floor at all — see `seedStarterData`. */
function queueFloor(batch: WriteBatch, tableCount: number): void {
  for (let n = 1; n <= tableCount; n++) {
    const id = `t${n}`;
    batch.set(paths.table(id), {
      number: n,
      label: `T${n}`,
      capacity: TABLE_CAPACITY,
      status: "available",
      currentOrderId: null,
      mergedInto: null,
      updatedAt: serverTimestamp(),
    } as unknown as Table);
  }
}

/**
 * Seed the starter menu and floor for the kind of place this is.
 *
 * The MENU is not conditional on anything: every business type has one, an
 * unrecognised type gets the fallback, and there is no answer anywhere in the
 * wizard that leads to a restaurant with nothing to sell. The FLOOR is the
 * only part the answers switch off — `tableCount` of 0 seeds no tables at
 * all, which is the whole point for a counter business: nothing to delete.
 *
 * Best-effort: never throws. A setup that otherwise succeeded must not look
 * like it failed, and an empty menu is a recoverable annoyance — the owner
 * lands in a working app, and the next run of the wizard fills it in (see
 * `seedStarterMenuIfEmpty`).
 */
export async function seedStarterData(
  businessType: BusinessType,
  tableCount: number
): Promise<boolean> {
  try {
    const batch = writeBatch(db);
    queueMenu(batch, menuFor(businessType));
    queueFloor(batch, tableCount);
    await batch.commit();
    return true;
  } catch (e) {
    console.warn("[setup] starter data could not be seeded:", e);
    return false;
  }
}

/**
 * Put a menu on a restaurant that has NONE — and never touch one that has.
 *
 * The first-run seed can miss: a tablet that was offline at the end of the
 * wizard, a setup killed between the config write and the batch, a menu
 * emptied by hand. `needsSetup` is gone by then, so nothing sends that owner
 * back to the screen that seeds, and they keep an empty menu forever. This is
 * the second chance, and it is safe to call on any run of the wizard because
 * the guard is not "is this the first run" but "is there a single menu item":
 * an owner who has typed in their own dishes is left completely alone, which
 * is what makes re-answering the questions from Account a config change and
 * not a data change.
 *
 * A read failure counts as "has a menu", and reports SUCCESS: seeding on top
 * of a menu we merely failed to see is the one mistake worth ruling out, and
 * an owner with a full menu must not be told their starter menu failed. Only
 * a failed WRITE — we looked, there was nothing, and we could not fix it — is
 * worth putting on screen.
 */
export async function seedStarterMenuIfEmpty(
  businessType: BusinessType
): Promise<boolean> {
  let empty: boolean;
  try {
    empty = (await getDocs(query(paths.menuItems(), limit(1)))).empty;
  } catch (e) {
    console.warn("[setup] could not check for an existing menu:", e);
    return true;
  }
  if (!empty) return true;

  try {
    const batch = writeBatch(db);
    queueMenu(batch, menuFor(businessType));
    await batch.commit();
    return true;
  } catch (e) {
    console.warn("[setup] starter menu could not be back-filled:", e);
    return false;
  }
}

