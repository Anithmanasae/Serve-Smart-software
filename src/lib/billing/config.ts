/**
 * What we sell, and where the server that verifies it lives.
 *
 * Product ids are set at BUILD time (Expo only exposes EXPO_PUBLIC_* to the
 * bundle) because they are a property of the Play listing, not of a
 * restaurant. A tenant cannot have its own price.
 *
 *   EXPO_PUBLIC_PLAY_SUBSCRIPTION_ID   the subscription product id created in
 *                                      Play Console (e.g. "smartserve_pro")
 *
 * With nothing configured `isBillingConfigured` is false and the whole
 * subscribe path hides itself, leaving the existing "contact us" flow on the
 * expiry screen exactly as it is today. That is what lets this ship BEFORE
 * Play Console is set up: the code is inert until the id exists.
 */

/** The Play subscription product id. One product, many base plans — a monthly
 *  and an annual base plan are offers ON this id, not separate ids. */
export const SUBSCRIPTION_ID =
  process.env.EXPO_PUBLIC_PLAY_SUBSCRIPTION_ID ?? "";

export const isBillingConfigured = SUBSCRIPTION_ID.length > 0;

// NO FREE-TRIAL OFFER ON THE PLAY BASE PLAN.
//
// The app already runs its own trial: every restaurant is born with a
// server-stamped `trialStartedAt` and gets `trialLength()` for free before it
// ever sees a paywall. Adding Play's own free-trial offer on top would hand out
// two trials back to back — ours, then Google's — and, worse, would leave two
// systems each believing they own "is this restaurant in its trial?". Ours is
// the one the security rules enforce, so ours is the one that exists.
// Configure the base plan in Play Console with NO trial offer.

/**
 * Where `verifyPurchase` is deployed.
 *
 * MUST match `setGlobalOptions({ region })` in `functions/src/index.ts`. The
 * Firebase SDK defaults to us-central1 and builds the callable's URL from this
 * string — point it at the wrong region and every purchase fails to verify
 * with a "not found" that looks nothing like a region mismatch. The two values
 * are in different packages and nothing checks them against each other, so
 * they are written down in both places and changed together.
 */
export const FUNCTIONS_REGION = "us-central1";
