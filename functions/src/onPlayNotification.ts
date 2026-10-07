/**
 * Real-Time Developer Notifications — the durable half of billing.
 *
 * `verifyPurchase` handles the moment of purchase, while someone is watching.
 * Everything AFTER that happens when nobody is: the card renews at 3am, the
 * bank declines it, the owner cancels from the Play Store app, Google issues a
 * refund. None of those events open the app, and none of them would ever reach
 * the restaurant document without this function.
 *
 * WITHOUT THIS, EVERY PAYING CUSTOMER LOCKS OUT AT THEIR FIRST RENEWAL. That
 * is worth stating plainly, because the system looks like it works right up
 * until the end of the first billing period.
 *
 * ## Setup
 *
 *   1. Google Cloud → Pub/Sub → create topic `play-billing`.
 *   2. Grant `google-play-developer-notifications@system.gserviceaccount.com`
 *      the "Pub/Sub Publisher" role on that topic. Play cannot publish
 *      without it, and the failure is silent.
 *   3. Play Console → Monetisation setup → Real-time developer notifications →
 *      paste the full topic name, then "Send test notification".
 *
 * ## Shape of the message
 *
 * Play publishes base64 JSON. The half we care about is
 * `subscriptionNotification: { notificationType, purchaseToken, subscriptionId }`.
 * We deliberately do NOT act on `notificationType` alone — the type tells us
 * something changed, and then we ask Play what the truth now is. Acting on the
 * type would mean maintaining our own copy of Google's state machine, and
 * getting RENEWED/RECOVERED/RESTARTED subtly wrong is how a working restaurant
 * gets locked out.
 */
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions";
import { acknowledge, getSubscription } from "./playApi";
import {
  hasOtherLivePurchase,
  recordPurchase,
  restaurantForToken,
  revokeEntitlement,
  setEntitlement,
} from "./entitlement";

/** Must match the Pub/Sub topic configured in Play Console. */
export const PLAY_TOPIC = "play-billing";

/** Google's numeric notification types, for logs that a human can read. */
const TYPE_NAMES: Record<number, string> = {
  1: "RECOVERED",
  2: "RENEWED",
  3: "CANCELED",
  4: "PURCHASED",
  5: "ON_HOLD",
  6: "IN_GRACE_PERIOD",
  7: "RESTARTED",
  8: "PRICE_CHANGE_CONFIRMED",
  9: "DEFERRED",
  10: "PAUSED",
  11: "PAUSE_SCHEDULE_CHANGED",
  12: "REVOKED",
  13: "EXPIRED",
  20: "PENDING_PURCHASE_CANCELED",
};

/** REVOKED means Google took the money back — access ends immediately, not at
 *  the end of the period. It is the one type we act on directly, because
 *  "refunded" is a fact about the past that a state lookup can report as
 *  merely "expired at some future date". */
const REVOKED = 12;

export const onPlayNotification = onMessagePublished(
  { topic: PLAY_TOPIC, retry: true },
  async (event) => {
    const raw = event.data.message.data
      ? Buffer.from(event.data.message.data, "base64").toString("utf8")
      : "";
    if (!raw) return;

    let payload: {
      subscriptionNotification?: {
        notificationType?: number;
        purchaseToken?: string;
        subscriptionId?: string;
      };
      testNotification?: unknown;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      logger.error("play notification: unparseable payload", { raw });
      return;
    }

    // Play Console's "Send test notification" button. Reaching here proves the
    // topic, the IAM grant and this function are all wired up correctly.
    if (payload.testNotification) {
      logger.info("play notification: test received — wiring is correct");
      return;
    }

    const n = payload.subscriptionNotification;
    if (!n?.purchaseToken) return; // one-time products; we sell none

    const typeName = TYPE_NAMES[n.notificationType ?? -1] ?? String(n.notificationType);
    const purchaseToken = n.purchaseToken;
    const notifiedProductId = n.subscriptionId ?? "";

    // Ask Play what is true NOW rather than inferring it from the event type.
    // Throwing here is correct: `retry: true` means Pub/Sub redelivers, which
    // is exactly what should happen when Google is briefly unreachable. Doing
    // nothing would silently drop a renewal.
    const sub = await getSubscription(purchaseToken);

    // Play echoes the restaurant id we stamped at purchase time. The index is
    // the fallback for purchases made before that, or if Play omits it.
    const restaurantId =
      sub.restaurantId ?? (await restaurantForToken(purchaseToken));
    if (!restaurantId) {
      logger.error("play notification: no restaurant for token", {
        typeName,
        state: sub.rawState,
      });
      return;
    }

    const productId = sub.productId ?? notifiedProductId;
    const context = { reason: `RTDN ${typeName}`, state: sub.rawState };

    await recordPurchase(purchaseToken, {
      restaurantId,
      productId,
      state: sub.rawState,
      entitled: sub.entitled,
      expiresAtMs: sub.expiresAtMs,
    });

    // An order nobody has paid for, or one abandoned before paying. It is not
    // a subscription ending, so it must not touch the date: a restaurant that
    // was open before its owner tried a cash payment stays exactly as open
    // when they change their mind. The PURCHASED notification that follows a
    // completed payment is what unlocks.
    if (sub.unpaid) {
      logger.info("play notification: unpaid order, access unchanged", {
        restaurantId,
        ...context,
      });
      return;
    }

    if (sub.entitled && n.notificationType !== REVOKED) {
      await setEntitlement(restaurantId, sub.expiresAtMs, context);

      // The app normally acknowledges, but a payment that completes LATER —
      // cash at a shop, a slow transfer — lands here with no app open and no
      // screen that will ever run again for it. Unacknowledged, Google
      // refunds it after three days and the restaurant that just paid is
      // locked. Only after the entitlement is written, so acknowledging
      // always means the restaurant really was unlocked.
      if (sub.needsAcknowledgement && productId) {
        await acknowledge(purchaseToken, productId).catch((e) =>
          logger.error("play notification: acknowledge failed", {
            restaurantId,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      return;
    }

    // Everything below ENDS access — expired, on hold, paused, revoked. Believe
    // it only if this token is the one actually paying for the restaurant.
    if (await hasOtherLivePurchase(restaurantId, purchaseToken)) {
      logger.info("play notification: superseded token, access unchanged", {
        restaurantId,
        ...context,
      });
      return;
    }

    if (n.notificationType === REVOKED) {
      await revokeEntitlement(restaurantId, context);
      return;
    }

    // Never later than now: Play reports these states with an expiry already
    // in the past, and that true date is the one worth keeping on record —
    // but a state that means "no access" must not leave the door open just
    // because a date came back in the future, or did not come back at all.
    await setEntitlement(
      restaurantId,
      Math.min(sub.expiresAtMs ?? Infinity, Date.now() - 1000),
      context,
    );
  },
);
