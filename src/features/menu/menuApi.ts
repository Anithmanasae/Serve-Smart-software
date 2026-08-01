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
import { paths } from "@/lib/firestore/paths";
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
 * A Firestore document is hard-capped at 1 MiB *including* field names and
 * overhead, so the encoded photo is held well under that to leave room for the
 * item's own fields. Base64 costs ~33% over the raw JPEG bytes, so this budget
 * corresponds to roughly a 450 KB JPEG.
 */
export const MAX_IMAGE_DATA_URI_BYTES = 600 * 1024;

/**
 * Persist a menu photo as a base64 JPEG data URI on the item's `imageUrl`.
 *
 * Photos live INSIDE the Firestore document rather than in a Firebase Storage
 * bucket — that keeps the project on the free Spark plan (Storage requires
 * Blaze) and means one write, not an upload plus a download-URL round trip.
 * The trade-off is that every read of a menu item carries its photo, so the
 * caller MUST downscale and compress first (see `encodeMenuImage` in
 * MenuItemForm); this function only enforces the ceiling.
 *
 * `resolveMenuImage` and the item cards pass `imageUrl` straight to
 * expo-image as `{ uri }`, which accepts a `data:` URI unchanged — so nothing
 * on the render side needs to know the difference.
 */
export async function setMenuItemImage(
  itemId: string,
  dataUri: string
): Promise<string> {
  if (!dataUri.startsWith("data:image/")) {
    throw new Error(
      "Menu photo must be a base64 data URI — got a plain path, which would " +
        "only resolve on the device that uploaded it."
    );
  }
  if (dataUri.length > MAX_IMAGE_DATA_URI_BYTES) {
    throw new Error(
      `Photo is too large to store (${Math.round(dataUri.length / 1024)} KB ` +
        `encoded, limit ${Math.round(MAX_IMAGE_DATA_URI_BYTES / 1024)} KB).`
    );
  }
  await updateMenuItem(itemId, { imageUrl: dataUri });
  return dataUri;
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
