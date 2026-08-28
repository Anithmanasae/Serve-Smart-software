/**
 * Writing `expiresAt` onto a restaurant — the one privileged act in this
 * codebase.
 *
 * `firestore.rules` forbids every client from touching `expiresAt` or
 * `trialStartedAt` (`expiresAtUnchanged` / `trialStartedAtUnchanged`). The
 * Admin SDK bypasses rules, which is why these fields can be written here and
 * nowhere else. Until now the only writer was `scripts/activateTenant.js`, run
 * by hand. This file is the second writer, and it is the automatic one.
 *
 * ## What is deliberately NOT done here
 *
 * - **Never delete both trial fields.** Absent-both means PERMANENT — the
 *   safety property the whole expiry system rests on. That is activation, it
 *   is a human decision about a customer, and it stays in `activateTenant.js`
 *   where a person types `--confirm`. A billing webhook must never be able to
 *   hand out a permanent restaurant.
 * - **`trialStartedAt` is left alone.** An explicit `expiresAt` already
 *   overrides it in both the rules and `AuthContext`, so removing it would
 *   change no behaviour while destroying the record of when this restaurant
 *   actually started. `auditTenants.js` still wants to know.
 * - **No `isPaid` flag, ever.** A boolean drifts out of sync with reality; a
 *   date cannot. The whole model is dates and absence.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

const db = () => getFirestore();

/**
 * purchaseToken → restaurant. A top-level collection, matched by NO security
 * rule, so it is unreachable from any client (rules deny by default).
 *
 * It exists because a Play notification months from now arrives with a token
 * and little else. Play does echo the `obfuscatedAccountId` we stamped at
 * purchase time, and that is the primary link — this index is the belt to that
 * pair of braces, and the only record of which tokens we have ever honoured.
 */
const PURCHASES = "playPurchases";

export interface PurchaseRecord {
  restaurantId: string;
  productId: string;
  /** Play's own state string, for support. */
  state: string;
  expiresAtMs: number | null;
  updatedAt: FirebaseFirestore.FieldValue;
}

/** Remember which restaurant a token belongs to. */
export async function recordPurchase(
  purchaseToken: string,
  record: Omit<PurchaseRecord, "updatedAt">,
): Promise<void> {
  await db()
    .collection(PURCHASES)
    .doc(purchaseToken)
    .set({ ...record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Which restaurant did this token unlock last time we saw it? */
export async function restaurantForToken(
  purchaseToken: string,
): Promise<string | null> {
  const snap = await db().collection(PURCHASES).doc(purchaseToken).get();
  return snap.exists ? ((snap.data()?.restaurantId as string) ?? null) : null;
}

/**
 * Set the restaurant's paid-through date.
 *
 * Idempotent by design: Play delivers notifications at-least-once, and the app
 * re-verifies the same token on every subscribe-screen mount. Writing the same
 * date twice must be — and is — a no-op that costs one write.
 *
 * A restaurant that does not exist is logged and skipped rather than created.
 * An `obfuscatedAccountId` that names no restaurant means someone hand-crafted
 * a purchase or we have a bug; either way, inventing a workspace to satisfy it
 * would be worse than doing nothing.
 */
export async function setEntitlement(
  restaurantId: string,
  expiresAtMs: number | null,
  context: { reason: string; state: string },
): Promise<boolean> {
  if (!restaurantId) return false;
  const ref = db().collection("restaurants").doc(restaurantId);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.error("entitlement: no such restaurant", { restaurantId, ...context });
    return false;
  }

  // No expiry from Play (a test purchase, or a lifetime grant) — hold the
  // restaurant open for a week and let the next notification correct it.
  // Deliberately NOT "permanent": see the header.
  const effective =
    expiresAtMs ?? Date.now() + 7 * 24 * 60 * 60 * 1000;

  await ref.set(
    {
      expiresAt: Timestamp.fromMillis(effective),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("entitlement written", {
    restaurantId,
    expiresAt: new Date(effective).toISOString(),
    ...context,
  });
  return true;
}

/**
 * Close a restaurant now — a refund or a revoked purchase.
 *
 * Written as an `expiresAt` in the past rather than by deleting fields,
 * because deleting both fields is what PERMANENT looks like. Getting that
 * backwards would hand a refunded customer the app forever.
 */
export async function revokeEntitlement(
  restaurantId: string,
  context: { reason: string; state: string },
): Promise<boolean> {
  return setEntitlement(restaurantId, Date.now() - 1000, context);
}
