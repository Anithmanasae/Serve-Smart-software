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

/**
 * Record that the owner has actually ANSWERED the GST question, and what they
 * said, on the restaurant itself.
 *
 * Two fields for one answer, on purpose. `gstEnabled` is written `true` at
 * registration, so it can never distinguish "this restaurant charges GST"
 * from "nobody has ever asked" — and an unregistered place that quietly added
 * 5% to every bill for a fortnight is the failure this exists to catch.
 * `gstDecidedAt` is what the getting-started checklist reads.
 *
 * The value written here is also what a device with no local answer of its
 * own adopts, so answering on the owner's phone settles the cashier's tablet
 * too. See `SettingsContext`.
 *
 * Best-effort: the switch is device-local and has already taken effect, so a
 * failed write must not bounce it back under the owner's finger.
 */
export async function markGstDecided(enabled: boolean): Promise<void> {
  try {
    await setDoc(
      paths.restaurantProfile(),
      {
        gstEnabled: enabled,
        gstDecidedAt:
          serverTimestamp() as unknown as RestaurantProfile["gstDecidedAt"],
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[settings] failed to record the GST decision:", e);
  }
}
