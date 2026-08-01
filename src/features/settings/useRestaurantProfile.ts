/**
 * Live subscription to the restaurant profile (the restaurants/{id} root doc)
 * plus the write used by the Account tab's "Receipt details" card.
 *
 * The profile is what prints on every receipt header — name + address line —
 * so it lives in Firestore (shared across devices), not AsyncStorage.
 */
import { useMemo } from "react";
import { serverTimestamp, setDoc } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import { useDocData } from "@/lib/firestore/useRealtime";
import type { RestaurantProfile } from "@/types/models";

export function useRestaurantProfile() {
  const ref = useMemo(() => paths.restaurantProfile(), []);
  return useDocData<RestaurantProfile>(ref);
}

/** Save the receipt header. Rules enforce admin/cashier + 1–60 char name. */
export async function saveRestaurantProfile(
  name: string,
  addressLine: string
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Restaurant name cannot be empty.");
  if (trimmed.length > 60) {
    throw new Error("Restaurant name must be 60 characters or fewer.");
  }
  await setDoc(
    paths.restaurantProfile(),
    {
      name: trimmed,
      addressLine: addressLine.trim(),
      updatedAt: serverTimestamp() as unknown as RestaurantProfile["updatedAt"],
    },
    { merge: true }
  );
}
