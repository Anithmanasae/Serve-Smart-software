/**
 * RESET THE SANDBOX between prospects.
 *
 * Wipes the last prospect's transactional data and their logins, KEEPS the
 * cloned reference data (menu, categories, tables), so the same sandbox can be
 * handed to the next prospect without re-cloning. Run seedTrial.js afterwards
 * to mint fresh logins and restart the clock.
 *
 *   WIPED   orders, kots, bills, dailySummaries, counters,
 *           every users/{uid} in the trial tenant + their Auth login + userIndex
 *   KEPT    root profile (+ join code + expiresAt), menuCategories, menuItems,
 *           tables (reset to available), meta/bootstrap
 *
 * ACCOUNTS ARE TARGETED BY MEMBERSHIP — this script enumerates
 * restaurants/{TRIAL_ID}/users and nothing else. It NEVER calls listUsers(),
 * which would sweep up real customers' logins across every tenant in the
 * project. Before deleting any Auth login it re-checks that the account's
 * userIndex still points at the trial tenant, and skips it loudly if not.
 *
 * Usage:
 *   node scripts/resetTrial.js
 *   TRIAL_RESTAURANT_ID=demo-acme node scripts/resetTrial.js
 */
const {
  admin,
  LIVE_RESTAURANT_ID,
  TRIAL_RESTAURANT_ID,
  TRANSACTIONAL_COLLECTIONS,
  assertTenantsDistinct,
  initAdmin,
  trialPath,
  commitInChunks,
} = require("./trialConfig");

const { FieldValue } = admin.firestore;

async function wipeCollection(db, name) {
  const snap = await db.collection(trialPath(name)).get();
  await commitInChunks(db, snap.docs, (batch, doc) => batch.delete(doc.ref));
  console.log(`  ${name.padEnd(15)} ${snap.size} doc(s) deleted`);
  return snap.size;
}

/**
 * Delete the trial's staff: profile doc, userIndex entry, and Auth login —
 * strictly the uids found inside this tenant's users collection.
 */
async function wipeTrialAccounts(db, auth) {
  const snap = await db.collection(trialPath("users")).get();
  console.log(`  ${snap.size} account(s) in ${TRIAL_RESTAURANT_ID}`);

  let deleted = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    const d = doc.data();

    // Belt and braces: the login must still resolve to THIS sandbox. If a uid
    // somehow points elsewhere, leave the Auth account completely alone.
    const idxSnap = await db.doc(`userIndex/${uid}`).get();
    const indexedAt = idxSnap.exists ? idxSnap.data().restaurantId : null;
    if (indexedAt && indexedAt !== TRIAL_RESTAURANT_ID) {
      console.warn(
        `  ! SKIPPING ${uid} (${d.email}) — userIndex points at ` +
          `"${indexedAt}", not the sandbox. Auth login left untouched.`,
      );
      skipped++;
      continue;
    }

    await doc.ref.delete();
    if (idxSnap.exists) await idxSnap.ref.delete();
    try {
      await auth.deleteUser(uid);
      console.log(`  - ${d.role ?? "?"} ${d.email ?? uid} (login deleted)`);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      console.log(`  - ${d.email ?? uid} (profile only; no Auth login)`);
    }
    deleted++;
  }
  return { deleted, skipped };
}

/** Put the floor back to a clean state without re-cloning it. */
async function resetTables(db) {
  const snap = await db.collection(trialPath("tables")).get();
  await commitInChunks(db, snap.docs, (batch, doc) =>
    batch.set(
      doc.ref,
      {
        status: "available",
        currentOrderId: null,
        mergedInto: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
  );
  console.log(`  ${"tables".padEnd(15)} ${snap.size} reset to available (kept)`);
}

async function main() {
  assertTenantsDistinct();
  const { db, auth, projectId } = initAdmin();

  console.log(
    `\nProject       ${projectId}\n` +
      `Resetting     ${TRIAL_RESTAURANT_ID}\n` +
      `Live tenant   ${LIVE_RESTAURANT_ID}  (untouched)\n`,
  );

  console.log("--- Transactional data (wiped) ---");
  for (const name of TRANSACTIONAL_COLLECTIONS) await wipeCollection(db, name);

  console.log("\n--- Accounts (wiped, scoped to this tenant) ---");
  const { deleted, skipped } = await wipeTrialAccounts(db, auth);

  console.log("\n--- Reference data (kept) ---");
  await resetTables(db);
  for (const name of ["menuCategories", "menuItems"]) {
    const snap = await db.collection(trialPath(name)).get();
    console.log(`  ${name.padEnd(15)} ${snap.size} doc(s) kept`);
  }

  console.log(
    `\n=== Sandbox reset ===\n` +
      `  ${deleted} account(s) removed${skipped ? `, ${skipped} skipped` : ""}\n` +
      `  Menu and tables preserved.\n\n` +
      `  Next: node scripts/seedTrial.js   (fresh logins, clock restarts)\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nReset failed:", err);
  process.exit(1);
});
