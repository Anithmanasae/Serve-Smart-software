/**
 * CLEAR THE DEAD `trialStartedAt` STAMP off every restaurant.
 *
 * The 3-day self-serve trial is gone. `firestore.rules` no longer reads
 * `trialStartedAt`, AuthContext no longer computes a deadline from it, and the
 * create rule now REJECTS it — so a restaurant registered under the old build
 * already never expires. This script does not change any behaviour; it removes
 * a field that nothing reads.
 *
 * WHY BOTHER, THEN? Because a document carrying a field named "trialStartedAt"
 * reads, to the next person or script that opens it, like a restaurant on a
 * trial. That is the same class of mistake the whole expiry design avoids by
 * having absence mean permanent: the safest state is the one with nothing in it
 * to misread. Running this is optional and can wait; leaving it undone is safe.
 *
 * WHAT IT WILL NEVER TOUCH: `expiresAt`. That field is live — it is a
 * subscription's paid-through date or a deliberate lockout, and deleting it
 * would silently hand a lapsed or revoked customer the app forever. Use
 * scripts/activateTenant.js for that, which asks first and says what it found.
 *
 * Requires scripts/serviceAccount.json (Admin SDK key — gitignored, never
 * commit it). The Admin SDK BYPASSES security rules, which is the only way
 * this field can be written at all.
 *
 * READ-ONLY BY DEFAULT, like activateTenant.js. Without --confirm it lists what
 * it would change and writes nothing.
 *
 * Usage:
 *   node scripts/stripLegacyTrials.js                      # dry run
 *   node scripts/stripLegacyTrials.js --confirm            # clear them
 *   node scripts/stripLegacyTrials.js --tenant <rid>       # one tenant
 */
const { admin, initAdmin } = require("./trialConfig");
const { trialStatus } = require("./trialStatus");

const { FieldValue } = admin.firestore;

function parseArgs(argv) {
  const opts = { confirm: false, restaurantId: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--tenant") opts.restaurantId = argv[++i];
    else die(`Unknown option "${arg}".`);
  }
  return opts;
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { db, projectId } = initAdmin();
  const now = new Date();

  console.log(`\n  STRIP LEGACY TRIAL STAMPS — project ${projectId}`);
  console.log(
    `  ${opts.confirm ? "LIVE — will write" : "DRY RUN — no writes"}\n`,
  );

  const docs = opts.restaurantId
    ? [await db.doc(`restaurants/${opts.restaurantId}`).get()]
    : (await db.collection("restaurants").get()).docs;

  const carrying = docs.filter(
    (d) => d.exists && d.data().trialStartedAt !== undefined,
  );

  if (!carrying.length) {
    console.log("  Nothing to do — no restaurant carries trialStartedAt.\n");
    return;
  }

  console.log(`  ${carrying.length} restaurant(s) carry the dead stamp:\n`);
  for (const doc of carrying) {
    const data = doc.data();
    const status = trialStatus(data, now);
    console.log(`    ${doc.id.padEnd(26)} ${data.name ?? "—"}`);
    console.log(`      ${status.label}`);
    // Said out loud for every row, because this is the one thing that would
    // make the script dangerous if it were ever wrong.
    if (status.kind === "override") {
      console.log(`      expiresAt is KEPT — only trialStartedAt is removed.`);
    }
  }

  if (!opts.confirm) {
    console.log(`\n  Dry run. Re-run with --confirm to clear them.\n`);
    return;
  }

  // Batched in chunks: Firestore caps a WriteBatch at 500 operations, and a
  // restaurant list can outgrow that long before anyone thinks to check.
  const CHUNK = 400;
  for (let i = 0; i < carrying.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of carrying.slice(i, i + CHUNK)) {
      batch.set(
        doc.ref,
        { trialStartedAt: FieldValue.delete() },
        { merge: true },
      );
    }
    await batch.commit();
  }

  console.log(
    `\n  ✔ cleared trialStartedAt on ${carrying.length} restaurant(s). ` +
      `expiresAt untouched.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
