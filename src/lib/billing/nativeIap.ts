/**
 * THE ONLY FILE THAT TOUCHES THE IN-APP-PURCHASE NATIVE MODULE.
 *
 * Everything else in the app talks to `lib/billing/index.ts`, which talks to
 * this. That boundary exists so that swapping the billing library — or
 * reconciling this against its real API when it is finally installed — is one
 * file, not a search across screens.
 *
 * ## Not installed yet — and that is the point
 *
 * `expo-iap` is NOT in package.json. Until it is, every function here reports
 * "unavailable" and the app keeps its existing behaviour: the expiry screen
 * shows "Contact us" and nothing else changes. This is the same degradation
 * `kitchenChime` uses for `expo-audio` and `printerService` uses for the USB
 * module — a native module only exists in an APK built after it landed, so the
 * app must work without it rather than white-screen.
 *
 * To turn billing on:
 *
 *   npx expo install expo-iap
 *   npx expo prebuild --clean
 *
 * ...then reconcile the four call sites below against the installed version's
 * API. They are marked `VERIFY:`. The shapes here follow expo-iap's documented
 * surface, but a library version is a fact about the world and this file has
 * not met it — check each one rather than trusting it.
 *
 * ## The load-bearing decisions
 *
 * - **`require`, not a static import.** A static import is hoisted and
 *   evaluated when this module is first touched, which on a build without the
 *   native side throws before any try/catch of ours can run. Same reason
 *   `kitchenChime` uses a lazy require.
 * - **`obfuscatedAccountId` carries the RESTAURANT id, not the user id.** The
 *   entitlement belongs to the workspace: the owner buys on their phone and
 *   the waiter's tablet — a different Google account entirely — has to be
 *   unlocked by it. This field is what lets a Play notification arriving
 *   hours later find the restaurant it belongs to.
 * - **Nothing here grants access.** This file obtains a purchase token and
 *   hands it up. Entitlement is written by the server, onto the restaurant
 *   doc, and read back through the normal AuthContext listener. A client that
 *   could unlock itself would be a client that could lie.
 */
import { Platform } from "react-native";
import { SUBSCRIPTION_ID } from "./config";

/** A purchase as far as this app cares: a token to send to the server. */
export interface PurchaseResult {
  /** Play's purchase token — the only thing the server needs to verify. */
  purchaseToken: string;
  /** The product actually bought, for the server to cross-check. */
  productId: string;
}

/** One buyable base plan, already formatted for display by Play. */
export interface SubscriptionOffer {
  /** Play's offer token, needed to launch the flow for THIS base plan. */
  offerToken: string;
  /** e.g. "₹799.00" — localized and currency-correct, straight from Play.
   *  Never format a price yourself; Play knows the user's country. */
  formattedPrice: string;
  /** e.g. "P1M" (ISO 8601 duration) — monthly vs annual. */
  billingPeriod: string;
}

let iap: Record<string, Function> | null = null;
let resolved = false;
let connected = false;

/**
 * Resolve the native module once. `available` stays false forever on a build
 * that does not have it, so we never re-enter a throwing require.
 */
function load(): Record<string, Function> | null {
  if (resolved) return iap;
  resolved = true;
  // Play Billing is Android-only. iOS would need StoreKit and a second
  // verification path on the server; neither exists, and the product ships on
  // Android. Fail closed rather than half-working.
  if (Platform.OS !== "android") return null;
  try {
    // VERIFY: package name, when you install it.
    iap = require("expo-iap");
  } catch {
    iap = null;
  }
  return iap;
}

/** Whether this build can show a purchase dialog at all. */
export function isNativeBillingAvailable(): boolean {
  return load() != null;
}

/**
 * Open the connection to Play. Safe to call repeatedly — the second call is a
 * no-op. Returns false if billing is unavailable, so callers can fall back
 * without a try/catch of their own.
 */
export async function connect(): Promise<boolean> {
  const mod = load();
  if (!mod) return false;
  if (connected) return true;
  try {
    // VERIFY: expo-iap exposes `initConnection()`.
    await mod.initConnection?.();
    connected = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * The base plans available for our one subscription product.
 *
 * Returns `[]` rather than throwing when billing is unavailable, so the
 * subscribe screen renders its "not available on this version" state through
 * the same path as "Play returned nothing".
 */
export async function fetchOffers(): Promise<SubscriptionOffer[]> {
  const mod = load();
  if (!mod || !SUBSCRIPTION_ID) return [];
  if (!(await connect())) return [];
  try {
    // VERIFY: method name and the shape it returns. On Android a subscription
    // carries `subscriptionOfferDetails`, one entry per base plan/offer.
    const products = await mod.fetchProducts?.({
      skus: [SUBSCRIPTION_ID],
      type: "subs",
    });
    const first = Array.isArray(products) ? products[0] : null;
    const details = first?.subscriptionOfferDetails ?? [];
    return details
      .map((d: Record<string, unknown>) => {
        const phases =
          (d.pricingPhases as { pricingPhaseList?: Record<string, string>[] })
            ?.pricingPhaseList ?? [];
        // The LAST phase is the recurring one. An intro or trial phase comes
        // first and costs ₹0 or less than the real price — showing that as
        // "the price" would misstate what the owner is agreeing to pay.
        const recurring = phases[phases.length - 1];
        return {
          offerToken: String(d.offerToken ?? ""),
          formattedPrice: String(recurring?.formattedPrice ?? ""),
          billingPeriod: String(recurring?.billingPeriod ?? ""),
        };
      })
      .filter((o: SubscriptionOffer) => o.offerToken && o.formattedPrice);
  } catch {
    return [];
  }
}

/**
 * Launch Play's purchase dialog and resolve with the token to verify.
 *
 * `restaurantId` is stamped onto the purchase as `obfuscatedAccountId`. That
 * is the ONLY link between a Google account's payment and a restaurant, and
 * it is what a Real-Time Developer Notification uses months later to find the
 * right workspace when a renewal or a refund lands.
 *
 * Resolves `null` if the owner backed out — a cancelled purchase is an
 * ordinary outcome, not an error to shout about.
 */
export async function purchase(
  restaurantId: string,
  offerToken: string,
): Promise<PurchaseResult | null> {
  const mod = load();
  if (!mod || !SUBSCRIPTION_ID) return null;
  if (!(await connect())) return null;

  // VERIFY: request shape. expo-iap takes a platform-keyed request object;
  // the Android half carries the sku, the offer token and the obfuscated ids.
  const result = await mod.requestPurchase?.({
    request: {
      android: {
        skus: [SUBSCRIPTION_ID],
        subscriptionOffers: [{ sku: SUBSCRIPTION_ID, offerToken }],
        // Both ids are set to the RESTAURANT. Play echoes them back on every
        // future notification about this subscription.
        obfuscatedAccountIdAndroid: restaurantId,
        obfuscatedProfileIdAndroid: restaurantId,
      },
    },
    type: "subs",
  });

  const p = Array.isArray(result) ? result[0] : result;
  const token = p?.purchaseTokenAndroid ?? p?.purchaseToken;
  if (!token) return null;
  return { purchaseToken: String(token), productId: SUBSCRIPTION_ID };
}

/**
 * Purchases Play already knows about for the signed-in Google account.
 *
 * This is the reinstall path and the "I paid on my old phone" path. It is also
 * why there is no "restore" button that does anything special: the subscribe
 * screen calls this on mount, and if a live purchase turns up it is re-sent to
 * the server for verification just like a fresh one.
 */
export async function getExistingPurchases(): Promise<PurchaseResult[]> {
  const mod = load();
  if (!mod) return [];
  if (!(await connect())) return [];
  try {
    // VERIFY: method name.
    const purchases = await mod.getAvailablePurchases?.();
    if (!Array.isArray(purchases)) return [];
    return purchases
      .map((p: Record<string, unknown>) => ({
        purchaseToken: String(p.purchaseTokenAndroid ?? p.purchaseToken ?? ""),
        productId: String(p.productId ?? SUBSCRIPTION_ID),
      }))
      .filter((p: PurchaseResult) => p.purchaseToken);
  } catch {
    return [];
  }
}

/**
 * Tell Play the purchase has been delivered.
 *
 * NOT OPTIONAL: Google AUTO-REFUNDS a subscription that is not acknowledged
 * within three days. It is called only after the server has verified the token
 * and written the entitlement, so acknowledging always means the restaurant
 * really was unlocked.
 */
export async function acknowledge(purchaseToken: string): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    // VERIFY: expo-iap's finish/acknowledge call. `isConsumable` must be false
    // — consuming a subscription would let it be bought again immediately.
    await mod.finishTransaction?.({
      purchase: { purchaseTokenAndroid: purchaseToken, purchaseToken },
      isConsumable: false,
    });
  } catch {
    // The server may also acknowledge from its side; a failure here is not
    // worth failing the unlock over.
  }
}

/** Close the Play connection. Called when the subscribe screen unmounts. */
export async function disconnect(): Promise<void> {
  const mod = load();
  if (!mod || !connected) return;
  try {
    await mod.endConnection?.();
  } catch {
    /* ignore */
  } finally {
    connected = false;
  }
}
