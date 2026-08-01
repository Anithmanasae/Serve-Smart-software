/**
 * Menu Management write helpers — the only place this module talks to Firestore
 * for writes. Built on top of `paths` so the multi-tenant prefix lives in one
 * place, mirroring the `tablesApi` pattern.
 *
 * All reads for live views go through the realtime hooks in `useMenuData.ts`;
 * this file is create/update/delete only.
 */
import {
  addDoc,
  deleteDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { getActiveRestaurantId, paths } from "@/lib/firestore/paths";
import { storage } from "@/lib/firebase";
import type { MenuCategory, MenuItem } from "@/types/models";

// ── Menu items ───────────────────────────────────────────────────────────────

/** Editable fields of a menu item (id is assigned by Firestore). */
export type MenuItemInput = Omit<MenuItem, "id">;

/** Create a new menu item. Returns the generated document id. */
export async function createMenuItem(input: MenuItemInput): Promise<string> {
  const docRef = await addDoc(paths.menuItems(), {
    ...stripUndefined(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as unknown as MenuItem);
  return docRef.id;
}

/** Patch an existing menu item. */
export async function updateMenuItem(
  id: string,
  patch: Partial<MenuItemInput>
): Promise<void> {
  await updateDoc(paths.menuItem(id), {
    ...stripUndefined(patch),
    updatedAt: serverTimestamp(),
  });
}

/** Toggle the enabled flag of a menu item. */
export function setMenuItemEnabled(id: string, enabled: boolean): Promise<void> {
  return updateMenuItem(id, { enabled });
}

/** Update just the price (paise) of a menu item — used for inline edits. */
export function setMenuItemPrice(id: string, price: number): Promise<void> {
  return updateMenuItem(id, { price });
}

/** Permanently delete a menu item. */
export async function deleteMenuItem(id: string): Promise<void> {
  await deleteDoc(paths.menuItem(id));
}

/**
 * Upload an image to Firebase Storage at
 * `restaurants/{restaurantId}/menu/{itemId}/{filename}` and persist the
 * resulting download URL to the item's `imageUrl`. Returns the URL.
 */
export async function uploadMenuItemImage(
  itemId: string,
  blob: Blob,
  fileName = `${Date.now()}.jpg`
): Promise<string> {
  // In React Native the caller turns a local image uri into a Blob first:
  //   const blob = await (await fetch(uri)).blob();
  const path = `restaurants/${getActiveRestaurantId()}/menu/${itemId}/${fileName}`;
  const objectRef = storageRef(storage, path);
  await uploadBytes(objectRef, blob);
  const url = await getDownloadURL(objectRef);
  await updateMenuItem(itemId, { imageUrl: url });
  return url;
}

// ── Menu categories ──────────────────────────────────────────────────────────

export type MenuCategoryInput = Omit<MenuCategory, "id">;

/** Create a category. Pass a fresh id from the caller (uses setDoc). */
export async function createMenuCategory(
  id: string,
  input: MenuCategoryInput
): Promise<void> {
  await setDoc(paths.menuCategory(id), input);
}

export async function updateMenuCategory(
  id: string,
  patch: Partial<MenuCategoryInput>
): Promise<void> {
  await updateDoc(paths.menuCategory(id), stripUndefined(patch));
}

export function setMenuCategoryEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  return updateMenuCategory(id, { enabled });
}

export function setMenuCategorySortOrder(
  id: string,
  sortOrder: number
): Promise<void> {
  return updateMenuCategory(id, { sortOrder });
}

/** Delete a category. Items are not cascaded — the caller decides. */
export async function deleteMenuCategory(id: string): Promise<void> {
  await deleteDoc(paths.menuCategory(id));
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Firestore rejects `undefined` values; drop optional fields that are unset. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
