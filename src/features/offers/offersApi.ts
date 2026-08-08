/**
 * Offer write helpers — the only place this module talks to Firestore for
 * writes, built on `paths` like menuApi.
 *
 * Nothing here computes a discount. Creating an offer only records the RULE;
 * the money is worked out by `src/lib/offers.ts` when an order is priced. That
 * separation is what makes "delete an offer at any stage" safe: removing the
 * rule stops it applying to new orders and touches no bill that already used
 * it, because the amount and name were snapshotted onto those order lines.
 */
import {
  addDoc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import type { Offer } from "@/types/models";

/** Editable fields of an offer (id is assigned by Firestore). */
export type OfferInput = Omit<Offer, "id" | "createdAt" | "updatedAt">;

/** Create an offer. Returns the generated document id. */
export async function createOffer(input: OfferInput): Promise<string> {
  const docRef = await addDoc(paths.offers(), {
    ...stripUndefined(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as unknown as Offer);
  return docRef.id;
}

/**
 * Patch an existing offer.
 *
 * `stripUndefined` matters more here than elsewhere: switching an offer from
 * "30% off" to "Buy 1 Get 1" leaves `percentOff` behind unless the caller
 * clears it, so OfferForm sends the full field-set for the chosen kind and
 * lets the unused ones go. A stale `percentOff` would be harmless today (the
 * engine reads only the fields its `kind` uses) and confusing forever after.
 */
export async function updateOffer(
  id: string,
  patch: Partial<OfferInput>
): Promise<void> {
  await updateDoc(paths.offer(id), {
    ...stripUndefined(patch),
    updatedAt: serverTimestamp(),
  });
}

/**
 * The day-to-day switch. Preferred over deleting: an owner pausing a promo
 * mid-service usually wants it back next week, and a disabled offer keeps its
 * configuration intact.
 */
export function setOfferEnabled(id: string, enabled: boolean): Promise<void> {
  return updateOffer(id, { enabled });
}

/** Permanently delete an offer. Bills already priced under it are unaffected —
 *  they carry their own snapshot of the name and the amount. */
export async function deleteOffer(id: string): Promise<void> {
  await deleteDoc(paths.offer(id));
}

/** Firestore rejects `undefined` values; drop optional fields that are unset. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
