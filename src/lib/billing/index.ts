/**
 * Subscriptions — the only billing surface the app imports.
 *
 * Screens import from here and never from `nativeIap`, the same way every
 * screen imports `printerService` and never a transport. What sits behind it
 * is one native module today and might be another tomorrow.
 *
 * ## What a purchase actually is
 *
 * Buying does NOT unlock the app. It produces a purchase token, which is sent
 * to the `verifyPurchase` Cloud Function, which asks Google whether that token
 * is real and — only then — writes `expiresAt` onto the restaurant document
 * with the Admin SDK. `AuthContext` is already watching that document, so the
 * unlock arrives through the ordinary listener, on every device in the
 * restaurant at once, with no special-casing anywhere.
 *
 * That indirection is the whole security model:
 *
 * - `firestore.rules` forbids ANY client from writing `expiresAt`
 *   (`expiresAtUnchanged`). A device that could unlock itself is a device that
 *   could lie about having paid.
 * - Entitlement lands on the RESTAURANT, not the buyer. Play ties a purchase
 *   to a Google account; a restaurant is three tablets signed into three
 *   different ones. Only the workspace-level field unlocks the kitchen screen
 *   when the owner paid on their own phone.
 * - Absence still means permanent. Nothing here ever writes a "paid" boolean,
 *   so the invariant the rules and `activateTenant.js` rely on is untouched.
 *
 * ## Degrades to nothing
 *
 * Until `expo-iap` is installed AND `EXPO_PUBLIC_PLAY_SUBSCRIPTION_ID` is set,
 * `isBillingAvailable()` is false and every screen falls back to the existing
 * "contact us to activate" path. Shipping this file changes no behaviour.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import { FUNCTIONS_REGION, isBillingConfigured, SUBSCRIPTION_ID } from "./config";
import {
  acknowledge,
  disconnect,
  fetchOffers,
  getExistingPurchases,
  isNativeBillingAvailable,
  purchase,
  type PurchaseResult,
  type SubscriptionOffer,
} from "./nativeIap";

export type { SubscriptionOffer };

/** What `verifyPurchase` sends back. `expiresAt` is epoch millis, or null if
 *  the subscription is valid but Play reported no expiry (rare — a lifetime
 *  grant or a test purchase). */
export interface VerifyResult {
  ok: boolean;
  expiresAt: number | null;
  /** Present when ok is false — safe to show the owner. */
  reason?: string;
}

/**
 * Can this build sell anything?
 *
 * BOTH halves must be true: the native module has to exist in the APK, and a
 * product id has to have been configured at build time. Either missing means
 * the subscribe screen never appears and the expiry screen keeps its
 * "Contact us" button.
 */
export function isBillingAvailable(): boolean {
  return isBillingConfigured && isNativeBillingAvailable();
}

/** The base plans on offer, straight from Play with Play's own prices. */
export function getOffers(): Promise<SubscriptionOffer[]> {
  return fetchOffers();
}

function verifyCallable() {
  return httpsCallable<
    { purchaseToken: string; productId: string; restaurantId: string },
    VerifyResult
  >(getFunctions(app, FUNCTIONS_REGION), "verifyPurchase");
}

/**
 * Send a token to the server and let it decide.
 *
 * Acknowledgement happens HERE rather than in `nativeIap`, and only after the
 * server said yes — acknowledging a purchase we failed to honour would tell
 * Google the goods were delivered while the restaurant sat locked. The other
 * direction is safe: Google auto-refunds anything unacknowledged after three
 * days, so a purchase we never verify undoes itself.
 */
async function verifyAndAcknowledge(
  p: PurchaseResult,
  restaurantId: string,
): Promise<VerifyResult> {
  const res = await verifyCallable()({
    purchaseToken: p.purchaseToken,
    productId: p.productId,
    restaurantId,
  });
  const data = res.data;
  if (data?.ok) await acknowledge(p.purchaseToken);
  return data ?? { ok: false, expiresAt: null, reason: "No response." };
}

/**
 * Buy a base plan for this restaurant.
 *
 * Resolves `null` when the owner dismissed Play's sheet — an ordinary outcome
 * that callers should treat as "nothing happened", not as a failure.
 */
export async function subscribe(
  restaurantId: string,
  offerToken: string,
): Promise<VerifyResult | null> {
  if (!isBillingAvailable()) {
    return { ok: false, expiresAt: null, reason: "Billing isn't available on this version of the app." };
  }
  const result = await purchase(restaurantId, offerToken);
  if (!result) return null; // cancelled
  return verifyAndAcknowledge(result, restaurantId);
}

/**
 * Re-send any purchase Play already holds for this Google account.
 *
 * Covers reinstalls, a replaced device, and the case where verification failed
 * the first time (bad network right after paying) and the restaurant is still
 * locked despite a real, paid subscription. Called on the subscribe screen's
 * mount, so it usually fixes itself before the owner can press anything.
 *
 * Resolves the first successful verification, or null if there was nothing to
 * restore.
 */
export async function restore(restaurantId: string): Promise<VerifyResult | null> {
  if (!isBillingAvailable()) return null;
  const existing = await getExistingPurchases();
  for (const p of existing) {
    if (p.productId !== SUBSCRIPTION_ID) continue;
    try {
      const res = await verifyAndAcknowledge(p, restaurantId);
      if (res.ok) return res;
    } catch {
      // Try the next one; a stale token from an old product is not an error.
    }
  }
  return null;
}

/** Release the Play connection. Call from a screen's unmount. */
export function closeBilling(): Promise<void> {
  return disconnect();
}
