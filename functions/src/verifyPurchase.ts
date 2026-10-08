/**
 * "I just paid" — the callable the app hits the moment Play's sheet closes.
 *
 * Real-Time Developer Notifications (see `onPlayNotification`) are the durable
 * channel and would eventually deliver this same entitlement on their own. But
 * "eventually" is seconds to minutes, and the owner is standing there looking
 * at a locked screen having just been charged. This exists so the unlock is
 * immediate; the notification that arrives later writes the same date again
 * and changes nothing.
 *
 * ## Whose word counts
 *
 * The client's, for exactly one thing: which purchase token to look up. Every
 * other fact — is it real, is it active, when does it end, which restaurant is
 * it for — comes from Google.
 *
 * In particular the caller does NOT get to name the restaurant it unlocks.
 * `restaurantId` is passed for cross-checking, but the id that gets written is
 * the one Play echoes back from the purchase, and the caller must independently
 * prove membership of it through `userIndex`. A cashier at restaurant A cannot
 * unlock restaurant B, and a token bought for A cannot be replayed to unlock B.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { acknowledge, getSubscription } from "./playApi";
import { recordPurchase, restaurantForToken, setEntitlement } from "./entitlement";

interface Req {
  purchaseToken?: string;
  productId?: string;
  restaurantId?: string;
}

export const verifyPurchase = onCall<Req>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const purchaseToken = String(request.data?.purchaseToken ?? "").trim();
  const productId = String(request.data?.productId ?? "").trim();
  if (!purchaseToken || !productId) {
    throw new HttpsError("invalid-argument", "Missing purchase details.");
  }

  const db = getFirestore();

  // ── who is calling, and where do they actually belong? ─────────────────────
  // Read from userIndex rather than trusting request.data.restaurantId. This
  // is the same doc AuthContext resolves a login through, and it is immutable
  // once written (rules), so it cannot be pointed at someone else's workspace.
  const idxSnap = await db.collection("userIndex").doc(uid).get();
  const callerRestaurantId = idxSnap.exists
    ? ((idxSnap.data()?.restaurantId as string) ?? null)
    : null;
  if (!callerRestaurantId) {
    throw new HttpsError("permission-denied", "This account has no restaurant.");
  }

  // Only the OWNER may buy. Staff joining by code are on someone else's
  // payment method by definition, and a waiter who could subscribe could also
  // subscribe by accident.
  const profileSnap = await db
    .doc(`restaurants/${callerRestaurantId}/users/${uid}`)
    .get();
  if (profileSnap.data()?.role !== "cashier") {
    throw new HttpsError(
      "permission-denied",
      "Only the restaurant owner can manage the subscription.",
    );
  }

  // ── ask Google ────────────────────────────────────────────────────────────
  let sub;
  try {
    sub = await getSubscription(purchaseToken);
  } catch (e) {
    // Could not reach Play, or the service account is not authorised yet.
    // UNAVAILABLE, never "not entitled" — the app retries, and a paying
    // restaurant is not punished for our outage.
    logger.error("verifyPurchase: Play lookup failed", {
      uid,
      restaurantId: callerRestaurantId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new HttpsError(
      "unavailable",
      "Couldn't reach Google Play just now. Your purchase is safe — try again in a moment.",
    );
  }

  // The restaurant Play says this was bought for. When Play returned no
  // identifier at all (a resubscribe made from the Play Store app rather than
  // ours carries none), the next best witness is our own record of which
  // restaurant this token unlocked before. Only a token nobody has ever seen
  // falls through to the caller — otherwise one paid token, passed around,
  // would unlock every restaurant whose owner was handed it.
  const target =
    sub.restaurantId ??
    (await restaurantForToken(purchaseToken)) ??
    callerRestaurantId;
  if (target !== callerRestaurantId) {
    logger.warn("verifyPurchase: token belongs to another restaurant", {
      uid,
      caller: callerRestaurantId,
      target,
    });
    throw new HttpsError(
      "permission-denied",
      "That purchase belongs to a different restaurant.",
    );
  }

  // Play's product id, not the caller's: it is recorded, and it is what the
  // acknowledgement below is addressed to.
  const boughtProductId = sub.productId ?? productId;

  await recordPurchase(purchaseToken, {
    restaurantId: target,
    productId: boughtProductId,
    state: sub.rawState,
    entitled: sub.entitled,
    expiresAtMs: sub.expiresAtMs,
  });

  if (sub.unpaid) {
    logger.info("verifyPurchase: payment pending", { target, state: sub.rawState });
    return {
      ok: false,
      pending: true,
      expiresAt: null,
      reason:
        "Google Play is waiting for your payment to complete. Your restaurant unlocks by itself as soon as it does.",
    };
  }

  if (!sub.entitled) {
    logger.info("verifyPurchase: not entitled", { target, state: sub.rawState });
    return {
      ok: false,
      expiresAt: null,
      reason:
        sub.rawState === "SUBSCRIPTION_STATE_ON_HOLD"
          ? "Google Play couldn't charge your payment method. Update it in the Play Store and your restaurant unlocks by itself."
          : "This subscription isn't active. If you just paid, wait a moment and try again.",
    };
  }

  await setEntitlement(
    target,
    sub.expiresAtMs,
    { reason: "verifyPurchase", state: sub.rawState },
    { autoRenewing: sub.autoRenewing },
  );

  // Acknowledge from the server too. The app also acknowledges, but only the
  // server's word survives an owner who pays and immediately closes the app —
  // and an unacknowledged subscription is auto-refunded after three days.
  if (sub.needsAcknowledgement) {
    await acknowledge(purchaseToken, boughtProductId).catch((e) =>
      logger.error("verifyPurchase: acknowledge failed", {
        target,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  return { ok: true, expiresAt: sub.expiresAtMs };
});
