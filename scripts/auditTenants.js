/**
 * READ-ONLY AUDIT — the before/after proof.
 *
 * Prints, for both the live and the trial tenant:
 *   - a document count per collection
 *   - every account with its role, status, active flag and expiresAt
 *
 * Performs ZERO writes. Run it before and after deploying the rules change and
 * compare: every live account must read "no expiry — permanent", and the live
 * document counts must be identical either side of the deploy.
 *
 * Usage:
 *   node scripts/auditTenants.js
 *   TRIAL_RESTAURANT_ID=demo-acme node scripts/auditTenants.js
 */
const {
  LIVE_RESTAURANT_ID,
  TRIAL_RESTAURANT_ID,
  REFERENCE_COLLECTIONS,
  TRANSACTIONAL_COLLECTIONS,
  initAdmin,
} = require("./trialConfig");

const COLLECTIONS = [
  "users",
  ...REFERENCE_COLLECTIONS,
  ...TRANSACTIONAL_COLLECTIONS,
];

/** "2026-08-07T09:30:00.000Z (in 2d 0h)" | "no expiry — permanent" */
function describeExpiry(value, now) {
  if (value === undefined || value === null) return "no expiry — permanent";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return `INVALID (${JSON.stringify(value)})`;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) {
    const past = -ms;
    return `${date.toISOString()}  (EXPIRED ${Math.floor(past / 3600000)}h ago)`;
  }
  const hours = Math.floor(ms / 3600000);
  return `${date.toISOString()}  (in ${Math.floor(hours / 24)}d ${hours % 24}h)`;
}

async function auditTenant(db, restaurantId, label, now) {
  const rule = "═".repeat(72);
  console.log(`\n${rule}\n  ${label}: restaurants/${restaurantId}\n${rule}`);

  const rootSnap = await db.doc(`restaurants/${restaurantId}`).get();
  if (!rootSnap.exists) {
    console.log("  (no root document — this tenant does not exist)\n");
    return;
  }
  const root = rootSnap.data();
  console.log(`  name           ${root.name ?? "—"}`);
  console.log(`  joinCode       ${root.joinCode ?? "—"}`);
  console.log(`  gstEnabled     ${root.gstEnabled ?? "—"}`);
  console.log(`  WORKSPACE      ${describeExpiry(root.expiresAt, now)}`);

  console.log(`\n  documents per collection`);
  for (const name of COLLECTIONS) {
    // count() aggregation: no document payloads are read.
    const agg = await db.collection(`restaurants/${restaurantId}/${name}`).count().get();
    console.log(`    ${name.padEnd(16)} ${String(agg.data().count).padStart(6)}`);
  }

  const usersSnap = await db.collection(`restaurants/${restaurantId}/users`).get();
  console.log(`\n  accounts (${usersSnap.size})`);
  if (usersSnap.empty) console.log("    (none)");
  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const flags = `${u.status ?? "?"}/${u.active === true ? "active" : "inactive"}`;
    console.log(
      `    ${(u.role ?? "?").padEnd(8)} ${(u.email ?? doc.id).padEnd(28)} ` +
        `${flags.padEnd(18)} ${describeExpiry(u.expiresAt, now)}`,
    );
  }
}

async function main() {
  const { db, projectId } = initAdmin();
  const now = new Date();

  console.log(`\nREAD-ONLY AUDIT — project ${projectId}`);
  console.log(`Local time ${now.toISOString()} (expiry is enforced against the`);
  console.log(`server clock; treat the countdowns below as approximate)`);

  await auditTenant(db, LIVE_RESTAURANT_ID, "LIVE", now);
  await auditTenant(db, TRIAL_RESTAURANT_ID, "TRIAL", now);

  console.log(
    `\nExpected: every LIVE account reads "no expiry — permanent", and every\n` +
      `TRIAL account carries a deadline. No writes were performed.\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nAudit failed:", err);
  process.exit(1);
});
