/**
 * Asking Google whether a purchase is real.
 *
 * The client can hand us any string it likes and call it a purchase token. The
 * only thing that makes one true is Google saying so, which is what this file
 * does — `purchases.subscriptionsv2.get` on the Android Publisher API.
 *
 * ## Credentials
 *
 * Runs on the function's own service account. That account must be granted
 * access in TWO places, and it is the step people miss:
 *
 *   1. Play Console → Users and permissions → invite the service account
 *      email → grant "View financial data, orders, and cancellation survey
 *      responses" plus "Manage orders and subscriptions" for this app.
 *   2. Google Cloud Console → enable the "Google Play Android Developer API"
 *      on the same project.
 *
 * Permission changes in Play Console can take up to 24 hours to take effect.
 * A 401 the day you set it up is usually just that, not a wrong key.
 */
import { google, androidpublisher_v3 } from "googleapis";
import { defineString } from "firebase-functions/params";

/**
 * The Android package name of the published app.
 *
 * MUST equal `expo.android.package` in `app.json` — that is the identity Play
 * knows this app by, and every lookup below is scoped to it. The two live in
 * different packages and nothing checks them against each other, so they are
 * written down twice and changed together. The failure mode if they drift is
 * nasty and unobvious: Play answers a mismatched package with a 404, so every
 * purchase verification fails looking like "no such purchase" rather than like
 * a configuration error.
 *
 * DEFAULTED rather than left blank on purpose. An unset `defineString` prompts
 * interactively at deploy and fails outright in CI, and a hurried operator
 * answering that prompt wrong is exactly how the drift above happens. Override
 * per project only if the package ever changes:
 *
 *   firebase functions:params:set PLAY_PACKAGE_NAME com.example.other
 */
export const PLAY_PACKAGE_NAME = defineString("PLAY_PACKAGE_NAME", {
  default: "com.smartserve",
  description: "Android package name as published on Play. Must match app.json.",
});

let client: androidpublisher_v3.Androidpublisher | null = null;

async function publisher(): Promise<androidpublisher_v3.Androidpublisher> {
  if (client) return client;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  client = google.androidpublisher({ version: "v3", auth });
  return client;
}

/** What we need to know about a subscription, stripped of Play's shape. */
export interface SubscriptionState {
  /** True while the restaurant should be unlocked — active, in a grace period
   *  after a failed payment, or cancelled-but-not-yet-expired. */
  entitled: boolean;
  /** True when the order exists but no money has moved — the buyer chose a
   *  payment that completes later, or abandoned one. It says NOTHING about
   *  the restaurant's access either way and must not be written as a date. */
  unpaid: boolean;
  /** The subscription product Play says this token is for. Play's word, not
   *  the client's — it is what acknowledgement is addressed to. */
  productId: string | null;
  /** When access should end, epoch millis. Null means Play gave no expiry. */
  expiresAtMs: number | null;
  /** The restaurant this purchase was made for, echoed back by Play from the
   *  `obfuscatedAccountId` the app stamped at purchase time. */
  restaurantId: string | null;
  /** Play's raw state, kept for logging — it is what you will want when a
   *  customer says "I paid" and the doc says otherwise. */
  rawState: string;
  /** Whether Google is still waiting for the app to acknowledge delivery. */
  needsAcknowledgement: boolean;
}

/**
 * States in which the restaurant stays open. This is Google's own table
 * (developer.android.com/google/play/billing/lifecycle/subscriptions), not a
 * policy of ours — where the two could differ, theirs is the one the buyer
 * was told about.
 *
 * `IN_GRACE_PERIOD` is the important one: a card that failed to renew is a
 * payment problem, not a decision to leave, and Google is still retrying.
 * Locking a working restaurant out mid-service over a bank's declined
 * transaction is how you lose a customer who fully intended to pay. Play
 * extends `expiryTime` to cover the grace period, so the date we write moves
 * with it. `CANCELED` also stays open — a cancellation runs to the end of the
 * period already paid for, and `expiresAtMs` is what closes it.
 *
 * `ON_HOLD` is deliberately NOT here. It is what follows a grace period that
 * ran out: Google has stopped extending the date (`expiryTime` is already in
 * the past) and tells the buyer in so many words that access is suspended
 * until the payment method is fixed. Account hold lasts up to two months, so
 * treating it as open would be two months of service nobody is paying for.
 * Recovery arrives as its own notification and reopens the restaurant.
 * How long the bank gets is therefore ONE setting — the grace period on the
 * base plan in Play Console — and not a second opinion held here.
 */
const ENTITLED_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
]);

/**
 * An order with no money behind it. `PENDING` is a buyer who picked a payment
 * that completes later (cash at a shop, a bank transfer); `PENDING_PURCHASE_
 * CANCELED` is that same order abandoned. Neither is a subscription that
 * ended, so neither may close a restaurant — one that was open before the
 * owner started a purchase must still be open after they walk away from it.
 */
const UNPAID_STATES = new Set([
  "SUBSCRIPTION_STATE_PENDING",
  "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
]);

/**
 * Look up a purchase token.
 *
 * Throws on a network or auth failure — the caller must NOT treat that as "not
 * entitled". Failing to reach Google is our problem, and taking a paying
 * restaurant offline because our function could not authenticate would be the
 * worst possible reading of an outage.
 */
export async function getSubscription(
  purchaseToken: string,
): Promise<SubscriptionState> {
  const api = await publisher();
  const res = await api.purchases.subscriptionsv2.get({
    packageName: PLAY_PACKAGE_NAME.value(),
    token: purchaseToken,
  });
  const d = res.data;
  const rawState = d.subscriptionState ?? "UNKNOWN";

  // A subscription can have several line items (a plan change in flight). The
  // LATEST expiry is the one that matters — it is when access actually ends.
  let expiresAtMs: number | null = null;
  let productId: string | null = null;
  for (const line of d.lineItems ?? []) {
    productId ??= line.productId ?? null;
    if (!line.expiryTime) continue;
    const ms = Date.parse(line.expiryTime);
    if (Number.isFinite(ms) && (expiresAtMs === null || ms > expiresAtMs)) {
      expiresAtMs = ms;
    }
  }

  return {
    entitled: ENTITLED_STATES.has(rawState),
    unpaid: UNPAID_STATES.has(rawState),
    productId,
    expiresAtMs,
    restaurantId: d.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    rawState,
    needsAcknowledgement:
      d.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
  };
}

/**
 * Tell Google the goods were delivered.
 *
 * The app acknowledges from its side too, but only the server's word survives
 * an owner who pays and immediately kills the app. Unacknowledged subscriptions
 * are AUTO-REFUNDED after three days, so this is not optional — it is the
 * difference between a paying customer and a refunded one.
 */
export async function acknowledge(
  purchaseToken: string,
  productId: string,
): Promise<void> {
  const api = await publisher();
  // There is no v2 acknowledge; the v1 endpoint is still the one, and it wants
  // the product id alongside the token.
  await api.purchases.subscriptions.acknowledge({
    packageName: PLAY_PACKAGE_NAME.value(),
    subscriptionId: productId,
    token: purchaseToken,
  });
}
