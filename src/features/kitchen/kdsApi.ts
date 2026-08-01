/**
 * Kitchen Display (KDS) — Firestore write helpers.
 *
 * The kitchen and cashier roles may ONLY change `status` and `printedCount`
 * (plus the `updatedAt` bookkeeping field). This is enforced server-side by
 * `firestore.rules`:
 *
 *   hasAnyRole(['kitchen', 'cashier']) && incomingDiffers(['status', 'printedCount', 'updatedAt'])
 *
 * so every update below touches *only* those keys — never items, prices, etc.
 * All writes go through `paths.kot(id)`; no component builds a path by hand.
 */
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import type { Kot } from "@/types/models";

/** Move a ticket from `new` → `preparing` (kitchen has started cooking). */
export async function startKot(kotId: string): Promise<void> {
  await updateDoc(paths.kot(kotId), {
    status: "preparing",
    updatedAt: serverTimestamp(),
  });
}

/** Move a ticket → `ready` (food is plated / ready to serve). */
export async function markReady(kotId: string): Promise<void> {
  await updateDoc(paths.kot(kotId), {
    status: "ready",
    updatedAt: serverTimestamp(),
  });
}

/** Move a ticket → `completed`; it then leaves the live board. */
export async function completeKot(kotId: string): Promise<void> {
  await updateDoc(paths.kot(kotId), {
    status: "completed",
    updatedAt: serverTimestamp(),
  });
}

/** Reprint a ticket: bump `printedCount` (never resets the timer/status). */
export async function reprintKot(kot: Pick<Kot, "id" | "printedCount">): Promise<void> {
  await updateDoc(paths.kot(kot.id), {
    printedCount: (kot.printedCount ?? 0) + 1,
    updatedAt: serverTimestamp(),
  });
}
