/**
 * Smart Serve Cloud Functions.
 *
 * ONE JOB: turn a Google Play subscription into `expiresAt` on a restaurant
 * document. Nothing else in the product needs a server, and nothing else
 * should be added here without a reason as good as "the client is not allowed
 * to know this".
 *
 *   verifyPurchase       callable — the owner just paid, unlock now
 *   onPlayNotification   Pub/Sub  — renewals, cancellations, refunds, forever
 *
 * Both write through `entitlement.ts`, which is the only place the privileged
 * fields are touched. See `../../CLAUDE.md` for why absence means permanent
 * and why there is no `isPaid` flag.
 */
import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();

// ⚠️ SET THIS to your Firestore database's region before the first deploy.
// Firebase console → Firestore → the location is shown at the top (e.g.
// asia-south1 for Mumbai, us-central1 for the default). Co-locating avoids a
// cross-region hop on every entitlement write; more importantly, a callable
// deployed to a different region than the client expects fails to resolve.
//
// `maxInstances` is a cost guard, not a capacity limit: this workload is a
// handful of calls per restaurant per month, and an unbounded function is how
// a retry loop turns into a bill.
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { verifyPurchase } from "./verifyPurchase";
export { onPlayNotification } from "./onPlayNotification";
