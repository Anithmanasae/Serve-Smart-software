/**
 * STARTER DATA for a brand-new restaurant.
 *
 * A trial that opens onto an empty menu and no tables demos badly — the
 * prospect has to do twenty minutes of data entry before they can see the
 * thing work. This seeds a small, obviously-placeholder menu and eight tables
 * so they can take an order within seconds of registering, then edit or delete
 * it all from the Account screen.
 *
 * Written as a SEPARATE batch, after registration commits — deliberately NOT
 * folded into the atomic owner-registration batch, whose five docs are tied
 * together by getAfter checks in the rules. A failure here must not be able to
 * roll back a perfectly good restaurant, so it is best-effort: if it throws,
 * the owner simply lands on an empty menu and everything still works.
 *
 * The writes go through the ordinary client SDK as the newly-created cashier,
 * so they are subject to the same security rules as any other menu edit. Prices
 * are integer PAISE (see src/lib/money.ts) — ₹120.00 is 12000.
 */
import { serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { paths } from "@/lib/firestore/paths";
import type { MenuCategory, MenuItem, Table } from "@/types/models";

type StarterCategory = Omit<MenuCategory, "id"> & { id: string };
type StarterItem = Omit<MenuItem, "id"> & { id: string };

const CATEGORIES: StarterCategory[] = [
  { id: "starters", name: "Starters", sortOrder: 1, enabled: true },
  { id: "mains", name: "Main Course", sortOrder: 2, enabled: true },
  { id: "breads", name: "Breads & Rice", sortOrder: 3, enabled: true },
  { id: "drinks", name: "Drinks", sortOrder: 4, enabled: true },
  { id: "desserts", name: "Desserts", sortOrder: 5, enabled: true },
];

const ITEMS: StarterItem[] = [
  // Starters
  { id: "starter-paneer-tikka", name: "Paneer Tikka", categoryId: "starters", price: 22000, enabled: true },
  { id: "starter-chicken-65", name: "Chicken 65", categoryId: "starters", price: 24000, enabled: true },
  { id: "starter-veg-spring-roll", name: "Veg Spring Roll", categoryId: "starters", price: 16000, enabled: true },
  { id: "starter-gobi-manchurian", name: "Gobi Manchurian", categoryId: "starters", price: 18000, enabled: true },

  // Mains
  { id: "main-butter-chicken", name: "Butter Chicken", categoryId: "mains", price: 32000, enabled: true },
  { id: "main-paneer-butter-masala", name: "Paneer Butter Masala", categoryId: "mains", price: 26000, enabled: true },
  { id: "main-veg-biryani", name: "Veg Biryani", categoryId: "mains", price: 22000, enabled: true },
  { id: "main-chicken-biryani", name: "Chicken Biryani", categoryId: "mains", price: 28000, enabled: true },
  { id: "main-dal-tadka", name: "Dal Tadka", categoryId: "mains", price: 18000, enabled: true },

  // Breads & rice
  { id: "bread-butter-naan", name: "Butter Naan", categoryId: "breads", price: 5000, enabled: true },
  { id: "bread-tandoori-roti", name: "Tandoori Roti", categoryId: "breads", price: 3500, enabled: true },
  { id: "bread-jeera-rice", name: "Jeera Rice", categoryId: "breads", price: 14000, enabled: true },

  // Drinks
  { id: "drink-masala-chai", name: "Masala Chai", categoryId: "drinks", price: 3000, enabled: true },
  { id: "drink-sweet-lassi", name: "Sweet Lassi", categoryId: "drinks", price: 8000, enabled: true },
  { id: "drink-fresh-lime-soda", name: "Fresh Lime Soda", categoryId: "drinks", price: 7000, enabled: true },
  { id: "drink-mineral-water", name: "Mineral Water", categoryId: "drinks", price: 2000, enabled: true },

  // Desserts
  { id: "dessert-gulab-jamun", name: "Gulab Jamun", categoryId: "desserts", price: 9000, enabled: true },
  { id: "dessert-ice-cream", name: "Ice Cream", categoryId: "desserts", price: 8000, enabled: true },
];

/** Eight tables is enough to demo merging, occupancy and a busy floor. */
const TABLE_COUNT = 8;
const TABLE_CAPACITY = 4;

/**
 * Seed the starter menu and floor. Best-effort: never throws, because a
 * registration that succeeded must not look like it failed.
 *
 * Returns true if everything landed, false if it was skipped or partly failed
 * (the caller doesn't branch on it today — it's for logging).
 */
export async function seedStarterData(): Promise<boolean> {
  try {
    const batch = writeBatch(db);

    for (const category of CATEGORIES) {
      const { id, ...data } = category;
      batch.set(paths.menuCategory(id), data as MenuCategory);
    }
    for (const item of ITEMS) {
      const { id, ...data } = item;
      batch.set(paths.menuItem(id), data as MenuItem);
    }
    for (let n = 1; n <= TABLE_COUNT; n++) {
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

    await batch.commit();
    return true;
  } catch (e) {
    // An empty menu is a recoverable annoyance; a failed registration is not.
    console.warn("[signup] starter data could not be seeded:", e);
    return false;
  }
}
