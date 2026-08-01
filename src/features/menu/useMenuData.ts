/**
 * Live menu data — thin wrappers over the generic realtime hooks. Screens
 * subscribe through these so they always render current data (never polled,
 * never one-shot getDocs).
 */
import { useMemo } from "react";
import { orderBy, query } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import type { MenuCategory, MenuItem } from "@/types/models";

export type MenuCategoryDoc = MenuCategory & { id: string };
export type MenuItemDoc = MenuItem & { id: string };

/** All categories, ordered by sortOrder (ascending). */
export function useMenuCategories() {
  const q = useMemo(
    () => query(paths.menuCategories(), orderBy("sortOrder", "asc")),
    []
  );
  return useCollectionData<MenuCategory>(q);
}

/** All menu items, ordered by name. */
export function useMenuItems() {
  const q = useMemo(() => query(paths.menuItems(), orderBy("name", "asc")), []);
  return useCollectionData<MenuItem>(q);
}
