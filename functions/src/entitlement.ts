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
  /** Whether Play said this token keeps the restaurant open. */
  entitled: boolean;
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
 * Is some OTHER purchase still paying for this restaurant?
 *
 * One restaurant collects several tokens over its life: Play issues a new one
 * when an owner resubscribes after a lapse, or buys again from a new phone.
 * The old token does not go quiet — it still gets its own EXPIRED or REVOKED
 * notification, sometimes weeks later. Without this check that stale
 * notification writes a date in the past over a restaurant that is paid up
 * on the newer token, and a paying customer is locked out by their own
 * history.
 *
 * So news that ENDS access is only believed when no other token is live.
 * News that extends it needs no such check: a later date is never wrong.
 */
export async function hasOtherLivePurchase(
  restaurantId: string,
  purchaseToken: string,
): Promise<boolean> {
  const snap = await db()
    .collection(PURCHASES)
    .where("restaurantId", "==", restaurantId)
    .get();
  const now = Date.now();
  return snap.docs.some((d) => {
    if (d.id === purchaseToken) return false;
    const p = d.data() as Partial<PurchaseRecord>;
    return p.entitled === true && (p.expiresAtMs ?? 0) > now;
  });
}

/**
 * How long past Play's paid-through time a RENEWING restaurant stays open.
 *
 * A renewal is not instantaneous. The old period ends, Google charges the
 * card, and only then does its notification reach `onPlayNotification` and
 * move the date forward. Measured on the first real test purchase that gap
 * was 28 seconds — 28 seconds, once a month, in which a restaurant that had
 * done nothing wrong was thrown out to the paywall mid-service. A delayed or
 * redelivered notification makes it minutes or hours.
 *
 * So while Google says it will charge again, the door stays open a day past
 * the period it has already been paid for. The slack is NOT free service:
 * the moment a subscription stops renewing (cancelled, on hold, expired,
 * refunded) the next write carries no slack and the true date applies.
 * The worst case is a renewal notification lost outright, which costs one
 * day — against the alternative of locking paying customers every month.
 */
export const RENEWAL_SLACK_MS = 24 * 60 * 60 * 1000;

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
  /** Pass `autoRenewing: true` only for a subscription Play says is entitled
   *  AND will charge again; it is what earns `RENEWAL_SLACK_MS`. */
  renewal: { autoRenewing: boolean } = { autoRenewing: false },
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
  const paidThrough =
    expiresAtMs ?? Date.now() + 7 * 24 * 60 * 60 * 1000;
  const effective =
    paidThrough + (renewal.autoRenewing ? RENEWAL_SLACK_MS : 0);

  await ref.set(
    {
      expiresAt: Timestamp.fromMillis(effective),
      // DISPLAY ONLY — what the Account screen says about the subscription
      // ("Renews on 8 Nov" rather than a countdown to a date that is about to
      // move). Nothing may ever gate on this: `expiresAt` above is the only
      // thing the rules and AuthContext read, and it stays that way. It is
      // also not an `isPaid` flag by another name — it records what Play said
      // about renewal, not whether the restaurant may be used.
      subscription: {
        autoRenew: renewal.autoRenewing,
        paidThrough: Timestamp.fromMillis(paidThrough),
        // Play's own word for where the subscription stands, so the app can
        // tell a declined card (grace period, account hold) from a healthy
        // renewal or a plain lapse. Display only, like the rest of this map.
        state: context.state,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("entitlement written", {
    restaurantId,
    expiresAt: new Date(effective).toISOString(),
    paidThrough: new Date(paidThrough).toISOString(),
    autoRenewing: renewal.autoRenewing,
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
