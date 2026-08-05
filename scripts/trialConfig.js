/**
 * Shared configuration + SAFETY GUARDS for the trial/sandbox scripts
 * (seedTrial.js, resetTrial.js, auditTenants.js).
 *
 * The single job of this file is to make it structurally impossible for a
 * sandbox script to touch the live restaurant:
 *
 *   - assertTenantsDistinct() refuses to run if the trial tenant resolves to
 *     the live one, or if it doesn't carry the "demo-" prefix.
 *   - trialPath() builds every WRITE path from TRIAL_RESTAURANT_ID, so a write
 *     cannot be addressed at the live tenant even by mistake.
 *   - livePath() is used ONLY for reads when cloning reference data. Nothing in
 *     these scripts ever writes to a path built by it.
 *
 * Requires scripts/serviceAccount.json (Admin SDK key — gitignored, never
 * commit it). The Admin SDK BYPASSES security rules, which is why `expiresAt`
 * can be stamped here and nowhere else.
 *
 * Environment overrides:
 *   LIVE_RESTAURANT_ID    default: EXPO_PUBLIC_RESTAURANT_ID, else "sada-main"
 *   TRIAL_RESTAURANT_ID   default: "demo-trial"   (must start with "demo-")
 *   TRIAL_DAYS            default: 2
 *   DEMO_EMAIL_DOMAIN     default: "demo.test"
 *   DEMO_PASSWORD         default: "Demo@1234"
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccount.json");

/**
 * The real tenant whose menu/tables the sandbox is cloned FROM. Read-only —
 * nothing here ever writes to it.
 *
 * NOTE: tenant ids are generated at registration (slug + random suffix), not
 * chosen. "sada-main" is the historical single-tenant id from the .env example
 * and does NOT exist in this project — don't fall back to it, or the clone
 * silently finds nothing. Override with LIVE_RESTAURANT_ID when you add more
 * restaurants.
 */
const LIVE_RESTAURANT_ID =
  process.env.LIVE_RESTAURANT_ID || "grace-r72gnh";

/** The isolated sandbox tenant the prospect gets. */
const TRIAL_RESTAURANT_ID = process.env.TRIAL_RESTAURANT_ID || "demo-trial";

/** Every sandbox tenant id must carry this prefix — a second interlock so a
 *  typo'd TRIAL_RESTAURANT_ID can't quietly name a real customer. */
const TRIAL_ID_PREFIX = "demo-";

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 2);

const DEMO_EMAIL_DOMAIN = process.env.DEMO_EMAIL_DOMAIN || "demo.test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";

/** The three logins the prospect gets — one per role in the service loop. */
const TRIAL_STAFF = [
  { role: "cashier", name: "Demo Cashier", email: `cashier@${DEMO_EMAIL_DOMAIN}` },
  { role: "waiter", name: "Demo Waiter", email: `waiter@${DEMO_EMAIL_DOMAIN}` },
  { role: "kitchen", name: "Demo Kitchen", email: `kitchen@${DEMO_EMAIL_DOMAIN}` },
];

/** Reference data cloned from live and KEPT across resets. */
const REFERENCE_COLLECTIONS = ["menuCategories", "menuItems", "tables"];

/** Per-prospect data wiped on reset. */
const TRANSACTIONAL_COLLECTIONS = [
  "orders",
  "kots",
  "bills",
  "dailySummaries",
  "counters",
];

// ── guards ───────────────────────────────────────────────────────────────────

function fail(lines) {
  console.error(`\n  REFUSING TO RUN\n`);
  for (const line of lines) console.error(`   - ${line}`);
  console.error(
    `\n  live tenant:  ${LIVE_RESTAURANT_ID}\n` +
      `  trial tenant: ${TRIAL_RESTAURANT_ID}\n`,
  );
  process.exit(1);
}

/**
 * The check every sandbox script runs before doing anything. Refuses if the
 * trial tenant is the live tenant, or isn't demo-prefixed.
 */
function assertTenantsDistinct() {
  const problems = [];
  if (!LIVE_RESTAURANT_ID) problems.push("LIVE_RESTAURANT_ID is empty.");
  if (!TRIAL_RESTAURANT_ID) problems.push("TRIAL_RESTAURANT_ID is empty.");
  if (TRIAL_RESTAURANT_ID === LIVE_RESTAURANT_ID) {
    problems.push(
      `the trial tenant resolves to the LIVE tenant ("${LIVE_RESTAURANT_ID}"). ` +
        "This script would have written demo data into a real restaurant.",
    );
  }
  if (TRIAL_RESTAURANT_ID && !TRIAL_RESTAURANT_ID.startsWith(TRIAL_ID_PREFIX)) {
    problems.push(
      `trial tenant "${TRIAL_RESTAURANT_ID}" does not start with ` +
        `"${TRIAL_ID_PREFIX}" — sandbox tenants must be unmistakable.`,
    );
  }
  if (problems.length) fail(problems);
}

function requireServiceAccount() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `\nMissing ${SERVICE_ACCOUNT_PATH}\n` +
        "Firebase console > Project settings > Service accounts > " +
        "Generate new private key, saved as scripts/serviceAccount.json.\n",
    );
    process.exit(1);
  }
  return require(SERVICE_ACCOUNT_PATH);
}

/** Initialize the Admin SDK once and hand back { db, auth, projectId }. */
function initAdmin() {
  const serviceAccount = requireServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }
  return {
    db: admin.firestore(),
    auth: admin.auth(),
    projectId: serviceAccount.project_id,
  };
}

// ── path builders ────────────────────────────────────────────────────────────

/** WRITE paths. Always rooted at the trial tenant — cannot address live. */
function trialPath(suffix) {
  return suffix
    ? `restaurants/${TRIAL_RESTAURANT_ID}/${suffix}`
    : `restaurants/${TRIAL_RESTAURANT_ID}`;
}

/** READ-ONLY paths into the live tenant, used when cloning reference data.
 *  Nothing in these scripts writes to a path built here. */
function livePath(suffix) {
  return suffix
    ? `restaurants/${LIVE_RESTAURANT_ID}/${suffix}`
    : `restaurants/${LIVE_RESTAURANT_ID}`;
}

// ── server clock ─────────────────────────────────────────────────────────────

/** Top-level, matched by no security rule → unreachable from any client. */
const CLOCK_PROBE_PATH = "_serverClock/probe";

/**
 * The SERVER's current time, not this machine's.
 *
 * Writes a serverTimestamp and reads it straight back, so the trial deadline is
 * anchored to the same clock `request.time` uses in the security rules. If we
 * used Date.now() here, a skewed laptop clock would silently hand the prospect
 * a longer (or already-dead) trial.
 */
async function serverNow(db) {
  const ref = db.doc(CLOCK_PROBE_PATH);
  await ref.set({ at: admin.firestore.FieldValue.serverTimestamp() });
  const snap = await ref.get();
  const at = snap.data().at.toDate();
  await ref.delete().catch(() => {});
  return at;
}

/** Trial deadline = server now + TRIAL_DAYS. */
function expiryFrom(serverNowDate) {
  if (!Number.isFinite(TRIAL_DAYS) || TRIAL_DAYS <= 0) {
    fail([`TRIAL_DAYS must be a positive number (got "${process.env.TRIAL_DAYS}").`]);
  }
  return new Date(serverNowDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

// ── batching ─────────────────────────────────────────────────────────────────

/** Firestore caps a batch at 500 writes; stay under it. */
const BATCH_LIMIT = 400;

/** Apply `write(batch, item)` over `items` in safely sized batches. */
async function commitInChunks(db, items, write) {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const item of items.slice(i, i + BATCH_LIMIT)) write(batch, item);
    await batch.commit();
  }
}

module.exports = {
  admin,
  LIVE_RESTAURANT_ID,
  TRIAL_RESTAURANT_ID,
  TRIAL_ID_PREFIX,
  TRIAL_DAYS,
  DEMO_EMAIL_DOMAIN,
  DEMO_PASSWORD,
  TRIAL_STAFF,
  REFERENCE_COLLECTIONS,
  TRANSACTIONAL_COLLECTIONS,
  assertTenantsDistinct,
  initAdmin,
  trialPath,
  livePath,
  serverNow,
  expiryFrom,
  commitInChunks,
  fail,
};
