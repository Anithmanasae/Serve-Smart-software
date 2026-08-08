/**
 * Live offer data — thin wrappers over the generic realtime hooks, matching
 * useMenuData's shape.
 *
 * The waiter's order screen subscribes to this too, not just the owner's
 * management screen: switching an offer on has to reach every device mid-
 * service without anyone reloading anything.
 */
import { useMemo } from "react";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import type { Offer } from "@/types/models";

export type OfferDoc = Offer & { id: string };

/**
 * Every offer, newest first — including disabled ones, which the management
 * screen must still list so they can be switched back on.
 *
 * Sorted on the client rather than with `orderBy("createdAt")` because a
 * just-created doc holds an unresolved serverTimestamp locally: Firestore
 * sorts that as null, so the offer the owner just added would appear at the
 * BOTTOM of a descending list and then jump to the top a moment later. Here a
 * pending timestamp sorts as "right now", which is what it will turn out to be.
 */
export function useOffers() {
  const q = useMemo(() => paths.offers(), []);
  const state = useCollectionData<Offer>(q);

  const data = useMemo(() => {
    const at = (o: OfferDoc) => o.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
    return [...state.data].sort((a, b) => at(b) - at(a));
  }, [state.data]);

  return { ...state, data };
}
