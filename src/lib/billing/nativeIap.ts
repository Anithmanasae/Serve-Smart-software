/**
 * THE ONLY FILE THAT TOUCHES THE IN-APP-PURCHASE NATIVE MODULE.
 *
 * Everything else in the app talks to `lib/billing/index.ts`, which talks to
 * this. That boundary exists so that swapping the billing library — or
 * following it through a breaking release — is one file, not a search across
 * screens.
 *
 * ## What is behind it
 *
 * `expo-iap` 5.x, which wraps Google Play Billing Library 9. Google refuses
 * uploads built on anything older than v8, so the library version is not a
 * detail: bumping `expo-iap` is how this app stays uploadable.
 *
 * It is a NATIVE module, so it only exists in an APK built after it landed.
 * On an older install every function here reports "unavailable" and the app
 * keeps its previous behaviour — the expiry screen shows "Contact us" and
 * nothing else changes. This is the same degradation `kitchenChime` uses for
 * `expo-audio` and `printerService` uses for the USB module.
 *
 * The shapes below were reconciled against expo-iap 5.8.2's own type
 * definitions. Three of them are NOT what the library's older docs (and this
 * file's first draft) said, and each fails silently rather than loudly:
 *
 *   - the request is keyed `google`, not `android`;
 *   - the id fields are `obfuscatedAccountId`, with no `Android` suffix —
 *     misspell it and the purchase goes through with NO restaurant stamped on
 *     it, which nobody notices until a renewal cannot find its workspace;
 *   - offers arrive as `subscriptionOffers[].offerTokenAndroid`, not
 *     `subscriptionOfferDetails[].offerToken`.
 *
 * Re-check all three after any major version bump.
 *
 * ## The load-bearing decisions
 *
 * - **`require`, not a static import.** A static import is hoisted and
 *   evaluated when this module is first touched, which on a build without the
 *   native side throws before any try/catch of ours can run. Same reason
 *   `kitchenChime` uses a lazy require. The `import type` below is erased at
 *   compile time and costs nothing.
 * - **`obfuscatedAccountId` carries the RESTAURANT id, not the user id.** The
 *   entitlement belongs to the workspace: the owner buys on their phone and
 *   the waiter's tablet — a different Google account entirely — has to be
 *   unlocked by it. This field is what lets a Play notification arriving
 *   hours later find the restaurant it belongs to.
 * - **Nothing here grants access.** This file obtains a purchase token and
 *   hands it up. Entitlement is written by the server, onto the restaurant
 *   doc, and read back through the normal AuthContext listener. A client that
 *   could unlock itself would be a client that could lie.
 * - **A PENDING purchase is not a purchase.** Play lets a buyer start a
 *   subscription with a payment that completes later (cash at a shop, a slow
 *   bank transfer — common in India). Such a token must be neither verified
 *   as paid nor acknowledged; Google's notification finishes the job on the
 *   server when the money actually arrives.
 */
import { Platform } from "react-native";
import type * as ExpoIap from "expo-iap";
import { SUBSCRIPTION_ID } from "./config";

type IapModule = typeof ExpoIap;

/** A purchase as far as this app cares: a token to send to the server. */
export interface PurchaseResult {
  /** Play's purchase token — the only thing the server needs to verify. */
  purchaseToken: string;
  /** The product actually bought, for the server to cross-check. */
  productId: string;
  /** True when Play accepted the order but has not been paid yet. Nothing is
   *  owed to the buyer in this state and the token must not be acknowledged. */
  pending: boolean;
  /** True when Play refused the sale because this Google account already
   *  holds the subscription, and this is that existing purchase handed back.
   *  It may have been bought for a DIFFERENT restaurant. */
  alreadyOwned?: boolean;
}

/** One buyable base plan, already formatted for display by Play. */
export interface SubscriptionOffer {
  /** Play's offer token, needed to launch the flow for THIS base plan. */
  offerToken: string;
  /** e.g. "₹799.00" — localized and currency-correct, straight from Play.
   *  Never format a price yourself; Play knows the user's country. */
  formattedPrice: string;
  /** The same recurring price as a number, in millionths of the currency
   *  unit. For ARITHMETIC only ("less than ₹17 a day") — anything that prints
   *  the price itself prints `formattedPrice`. */
  priceMicros: number;
  /** ISO 4217, e.g. "INR". */
  currencyCode: string;
  /** e.g. "P1M" (ISO 8601 duration) — monthly vs annual. */
  billingPeriod: string;
  /** e.g. "P3D" when this buyer would start on a free trial, else null. Play
   *  only returns a trial offer to an account that is still eligible for it,
   *  so a non-null value here is a promise we are allowed to print. */
  trialPeriod: string | null;
}

let iap: IapModule | null = null;
let resolved = false;
let connected = false;
/** In-flight open / close, so a mount racing an unmount waits its turn. */
let opening: Promise<boolean> | null = null;
let closing: Promise<void> | null = null;

/**
 * Resolve the native module once. `available` stays false forever on a build
 * that does not have it, so we never re-enter a throwing require.
 */
function load(): IapModule | null {
  if (resolved) return iap;
  resolved = true;
  // Play Billing is Android-only. iOS would need StoreKit and a second
  // verification path on the server; neither exists, and the product ships on
  // Android. Fail closed rather than half-working.
  if (Platform.OS !== "android") return null;
  try {
    iap = require("expo-iap") as IapModule;
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
  // A close still in flight belongs to the screen that just unmounted. Let it
  // land first, or it lands on top of the connection opened below.
  if (closing) await closing;
  if (connected) return true;
  // One open at a time: the subscribe screen's restore and its price list both
  // call this, and so does a second mount racing the first.
  opening ??= mod
    .initConnection()
    .then(
      (ok) => {
        connected = ok === true;
        if (!connected) console.warn("[billing] Play connection refused.");
        return connected;
      },
      (e) => {
        console.warn("[billing] Play connection failed:", e);
        return false;
      },
    )
    .finally(() => {
      opening = null;
    });
  return opening;
}

/** A phase Play charges nothing for — the free trial, when there is one. */
function isFree(phase: ExpoIap.PricingPhaseAndroid): boolean {
  return Number(phase.priceAmountMicros) === 0;
}

/**
 * The base plans available for our one subscription product.
 *
 * Play returns one entry per OFFER, not per base plan: a monthly plan with a
 * free trial comes back twice, once with the trial and once without. Showing
 * both would put two buttons at the same price on screen and let the owner
 * tap the one that skips their trial. So this keeps one entry per base plan,
 * preferring the one that starts free.
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
    const products = await mod.fetchProducts({
      skus: [SUBSCRIPTION_ID],
      type: "subs",
    });
    const product = (products ?? []).find(
      (p) => p.id === SUBSCRIPTION_ID && p.type === "subs",
    ) as ExpoIap.ProductSubscriptionAndroid | undefined;

    const byPlan = new Map<string, SubscriptionOffer>();
    for (const o of product?.subscriptionOffers ?? []) {
      const phases = o.pricingPhasesAndroid?.pricingPhaseList ?? [];
      // The LAST phase is the recurring one. A trial or intro phase comes
      // first and costs ₹0 or less than the real price — showing that as
      // "the price" would misstate what the owner is agreeing to pay.
      const recurring = phases[phases.length - 1];
      if (!o.offerTokenAndroid || !recurring?.formattedPrice) continue;
      const trial = phases.length > 1 ? phases.find(isFree) : undefined;
      const offer: SubscriptionOffer = {
        offerToken: o.offerTokenAndroid,
        formattedPrice: recurring.formattedPrice,
        priceMicros: Number(recurring.priceAmountMicros) || 0,
        currencyCode: recurring.priceCurrencyCode ?? "",
        billingPeriod: recurring.billingPeriod,
        trialPeriod: trial?.billingPeriod ?? null,
      };
      const plan = o.basePlanIdAndroid ?? o.offerTokenAndroid;
      const kept = byPlan.get(plan);
      if (!kept || (!kept.trialPeriod && offer.trialPeriod)) {
        byPlan.set(plan, offer);
      }
    }
    if (byPlan.size === 0) {
      console.warn(
        `[billing] Play returned no offers for "${SUBSCRIPTION_ID}" (${(products ?? []).length} product(s)).`,
      );
    }
    return [...byPlan.values()];
  } catch (e) {
    console.warn("[billing] fetching offers failed:", e);
    return [];
  }
}

function toResult(p: ExpoIap.Purchase): PurchaseResult | null {
  if (!p.purchaseToken) return null;
  return {
    purchaseToken: p.purchaseToken,
    productId: p.productId || SUBSCRIPTION_ID,
    pending: p.purchaseState !== "purchased",
  };
}

/**
 * Launch Play's purchase dialog and resolve with the token to verify.
 *
 * `restaurantId` is stamped onto the purchase as `obfuscatedAccountId`. That
 * is the ONLY link between a Google account's payment and a restaurant, and
 * it is what a Real-Time Developer Notification uses months later to find the
 * right workspace when a renewal or a refund lands. Google caps the field at
 * 64 characters and forbids personal data in it; a Firestore document id is
 * neither long nor personal.
 *
 * Resolves `null` if the owner backed out — a cancelled purchase is an
 * ordinary outcome, not an error to shout about. Anything else throws.
 */
export async function purchase(
  restaurantId: string,
  offerToken: string,
): Promise<PurchaseResult | null> {
  const mod = load();
  if (!mod || !SUBSCRIPTION_ID) return null;
  if (!(await connect())) return null;

  try {
    const result = await mod.requestPurchase({
      type: "subs",
      request: {
        google: {
          skus: [SUBSCRIPTION_ID],
          subscriptionOffers: [{ sku: SUBSCRIPTION_ID, offerToken }],
          // Both ids are set to the RESTAURANT. Play echoes them back on
          // every future notification about this subscription.
          obfuscatedAccountId: restaurantId,
          obfuscatedProfileId: restaurantId,
        },
      },
    });
    const list = Array.isArray(result) ? result : result ? [result] : [];
    const bought = list.find((p) => p.productId === SUBSCRIPTION_ID) ?? list[0];
    return bought ? toResult(bought) : null;
  } catch (e) {
    if (mod.isUserCancelledError(e)) return null;
    // "You already own this" — this Google account is subscribed and the app
    // simply has not heard. Hand back the purchase Play is holding so it goes
    // through verification like a new one, instead of showing the owner an
    // error for having already paid.
    if ((e as { code?: string })?.code === mod.ErrorCode.AlreadyOwned) {
      const owned = (await getExistingPurchases()).find(
        (p) => p.productId === SUBSCRIPTION_ID,
      );
      if (owned) return { ...owned, alreadyOwned: true };
    }
    throw e;
  }
}

/**
 * What to tell the owner when Play's sheet ended in an error.
 *
 * The library's own messages describe the Billing API, not what happened:
 * a DECLINED CARD comes back as `billing-unavailable`, whose text is "Billing
 * API version is not supported" — shown raw, that told an owner whose card had
 * just been refused that their phone was too old. Play has already put the
 * real reason on its own sheet, so these only need to be true and point at
 * the Play Store.
 */
export function describePurchaseError(e: unknown): string {
  const mod = load();
  const code = (e as { code?: string })?.code;
  if (mod && code) {
    const C = mod.ErrorCode;
    if (code === C.NetworkError || code === C.ServiceError) {
      return "Couldn't reach Google Play. Check your internet connection and try again.";
    }
    if (code === C.BillingUnavailable || code === C.PurchaseError) {
      return "Google Play couldn't complete the payment. Check your payment method in the Play Store, then try again.";
    }
    if (code === C.ItemUnavailable) {
      return "This subscription isn't available on your Google account right now. Please try again later.";
    }
  }
  return "Google Play couldn't complete the purchase. Please try again.";
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
    const purchases = await mod.getAvailablePurchases();
    return (purchases ?? [])
      .map(toResult)
      .filter((p): p is PurchaseResult => p !== null);
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
 *
 * This is acknowledge, never consume — consuming a subscription would let it
 * be bought again immediately.
 */
export async function acknowledge(purchaseToken: string): Promise<void> {
  const mod = load();
  if (!mod) return;
  try {
    await mod.acknowledgePurchaseAndroid(purchaseToken);
  } catch {
    // The server acknowledges from its side too, and acknowledging twice is
    // an error Play reports rather than a problem. A failure here is not
    // worth failing the unlock over.
  }
}

/** Close the Play connection. Called when the subscribe screen unmounts. */
export async function disconnect(): Promise<void> {
  const mod = load();
  if (!mod || !connected) return;
  // Cleared BEFORE the await, not after it. The post-signup redirects mount
  // the subscribe screen, unmount it and mount it again inside a second; with
  // the flag still up, the second mount believed it was connected, asked a
  // closing connection for the price list, got nothing, and told a brand-new
  // owner that subscriptions were not available.
  connected = false;
  closing = mod
    .endConnection()
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      closing = null;
    });
  await closing;
}
