/**
 * ⚠️  DESTRUCTIVE, PROJECT-WIDE — NOT TENANT-SCOPED.
 *
 * Step 2 below calls admin.auth().listUsers() and deletes EVERY Firebase Auth
 * login in the project. That was written when this project served a single
 * restaurant; it predates multi-tenancy. Running it today would delete every
 * real customer's login across every restaurant, not just this tenant's.
 *
 * It is kept only for wiping a scratch/dev project from zero. To reset a demo
 * sandbox between prospects, use scripts/resetTrial.js instead — that one
 * targets accounts by MEMBERSHIP of the trial tenant and never enumerates all
 * users.
 *
 * Guarded behind an explicit opt-in so it cannot be run by muscle memory:
 *   I_UNDERSTAND_THIS_DELETES_EVERY_LOGIN=yes node scripts/resetUsers.js
 *
 * Requires scripts/serviceAccount.json (same as seed.js).
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccount.json");
const RESTAURANT_ID = process.env.EXPO_PUBLIC_RESTAURANT_ID || "sada-main";

async function main() {
  if (process.env.I_UNDERSTAND_THIS_DELETES_EVERY_LOGIN !== "yes") {
    console.error(
      "\n  REFUSING TO RUN\n\n" +
        "  This script deletes EVERY Firebase Auth login in the project —\n" +
        "  every restaurant, every customer — not just " +
        `"${RESTAURANT_ID}".\n\n` +
        "  To reset a demo sandbox between prospects, use:\n" +
        "      node scripts/resetTrial.js\n\n" +
        "  If you really do want to wipe the whole project:\n" +
        "      I_UNDERSTAND_THIS_DELETES_EVERY_LOGIN=yes node scripts/resetUsers.js\n",
    );
    process.exit(1);
  }
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("Missing scripts/serviceAccount.json — see seed.js header.");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  });
  const db = admin.firestore();

  // 1. Profile docs (+ their multi-tenant userIndex entries)
  const usersCol = db.collection(`restaurants/${RESTAURANT_ID}/users`);
  const snap = await usersCol.get();
  console.log(`--- Profiles in restaurants/${RESTAURANT_ID}/users: ${snap.size} ---`);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(`  deleting profile ${doc.id} (${d.role} · ${d.name} · ${d.email})`);
    await doc.ref.delete();
    await db.doc(`userIndex/${doc.id}`).delete();
  }

  // 2. Auth logins (all of them — this project serves only this app)
  console.log(`\n--- Firebase Auth logins ---`);
  let pageToken;
  let authCount = 0;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      console.log(`  deleting auth user ${u.uid} (${u.email ?? "no email"})`);
      await admin.auth().deleteUser(u.uid);
      await db.doc(`userIndex/${u.uid}`).delete(); // orphaned index, if any
      authCount++;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`  ${authCount} auth login(s) deleted`);

  // 3. Reopen the one-time cashier claim
  await db.doc(`restaurants/${RESTAURANT_ID}/meta/bootstrap`).delete();
  console.log(`\nmeta/bootstrap deleted — cashier signup is open again.`);

  console.log(
    `\nDone. First person to sign up can claim the Cashier (owner) seat.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
