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

// THE FREE TRIAL LIVES ON THE PLAY BASE PLAN, AND NOWHERE ELSE.
//
// The app used to run its own trial off a server-stamped `trialStartedAt`.
// That is gone — a new restaurant is born permanent and nothing reads the old
// stamp (see CLAUDE.md, "THERE IS NO FREE TRIAL"). So the trial is a free
// introductory offer on the base plan in Play Console: Google starts it,
// bills at the end of it and mails about it. `nativeIap.fetchOffers` reads the
// free phase back and the subscribe screen prints it. Do NOT also revive an
// in-app clock — two systems each believing they own "is this restaurant in
// its trial?" is one too many.

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
