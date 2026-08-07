/**
 * WHICH FIREBASE PROJECT EACH BUILD PROFILE IS ALLOWED TO TALK TO.
 *
 * One EAS project (app slug `sada-pos`) ships more than one white-labelled
 * restaurant product, each with its OWN Firebase backend. Nothing in a build
 * makes that visible: the app compiles, installs and brands itself identically
 * whichever project it points at, and only fails later — a valid login rejected
 * as "invalid email or password", because it is asking a different backend.
 *
 * It has already gone wrong once: the EAS `preview` environment was inherited
 * from another app, so a Smart Serve demo APK talked to the wrong Firestore.
 *
 * This table is the answer to "which backend SHOULD this profile use". It is
 * consumed by two checks:
 *
 *   scripts/assertBuildTarget.js  runs INSIDE every EAS build (package.json
 *                                 `eas-build-post-install`) and fails the build
 *                                 before a wrong-backend APK can exist.
 *   scripts/verifyBuildEnv.js     the same check, run locally on demand,
 *                                 against what EAS currently has stored.
 *
 * Because the build-time check is automatic, a mismatch can no longer reach a
 * customer's phone — the worst case is a build that stops with a clear message.
 *
 * ADDING A PROFILE: add it here too, or builds of it are only warned about,
 * not verified. `null` means "unverified on purpose" (local dev builds, which
 * take whatever .env.local says).
 */

/** EAS build profile (eas.json) → the Firebase project id it must resolve to. */
const BUILD_TARGETS = {
  // ---- Smart Serve — the product this repo is named for --------------------
  // Where firestore.rules (and therefore the 2-day trial enforcement) is
  // deployed. `.firebaserc` points here too.
  smartserve: "serve-smart-software",
  production: "serve-smart-software",

  // ---- Akila's restaurant software — a separate customer, separate backend -
  // NOT ours to repoint. If a Smart Serve build ever resolves to this project,
  // that is the bug this file exists to catch.
  preview: "akilas-restaurant-softwa-6b21c",
  demo: "akilas-restaurant-softwa-6b21c",

  // ---- local dev builds ----------------------------------------------------
  // Whatever .env.local holds; deliberately unchecked.
  development: null,
};

/** The Firebase config keys a build cannot run without. A build missing any of
 *  these produces an app that cannot reach any backend at all. */
const REQUIRED_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];

/**
 * Check one resolved set of build variables against an expected project id.
 *
 * Beyond "is the project id right", this catches a HALF-repointed environment —
 * someone updating PROJECT_ID but leaving AUTH_DOMAIN or STORAGE_BUCKET on the
 * old project, which yields an app that reads from one place and authenticates
 * against another.
 *
 * @param {Record<string,string|undefined>} env  resolved variables
 * @param {string|null} expected  project id from BUILD_TARGETS
 * @returns {string[]} problems; empty means it passes
 */
function checkFirebaseEnv(env, expected) {
  const problems = [];

  for (const key of REQUIRED_KEYS) {
    if (!env[key]) problems.push(`${key} is missing or empty`);
  }
  if (!expected) return problems;

  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (projectId && projectId !== expected) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_PROJECT_ID is "${projectId}", expected "${expected}"`,
    );
  }

  // Both are derived from the project id by Firebase itself, so they must
  // agree with it. (Bucket suffix varies: .appspot.com on older projects,
  // .firebasestorage.app on newer ones — so compare the stem only.)
  const authDomain = env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (authDomain && authDomain !== `${expected}.firebaseapp.com`) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN is "${authDomain}", expected ` +
        `"${expected}.firebaseapp.com"`,
    );
  }
  const bucket = env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (bucket && !bucket.startsWith(`${expected}.`)) {
    problems.push(
      `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET is "${bucket}", expected it to ` +
        `start with "${expected}."`,
    );
  }
  return problems;
}

module.exports = { BUILD_TARGETS, REQUIRED_KEYS, checkFirebaseEnv };
