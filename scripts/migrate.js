/**
 * One-off multi-tenant migration (idempotent — safe to re-run).
 *
 * Brings a pre-SaaS restaurant (data seeded under a fixed env RESTAURANT_ID,
 * users with no userIndex) up to the multi-tenant data model:
 *   1. restaurants/{id} root profile gets a joinCode (generated if missing)
 *   2. restaurantCodes/{joinCode} -> { restaurantId } lookup is created
 *   3. userIndex/{uid} -> { restaurantId } is written for every existing user
 *
 * Requires scripts/serviceAccount.json (same as seed.js).
 *
 * Usage: node scripts/migrate.js [restaurantId]
 *        (defaults to EXPO_PUBLIC_RESTAURANT_ID or "sada-main")
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccount.json");
const RESTAURANT_ID =
  process.argv[2] || process.env.EXPO_PUBLIC_RESTAURANT_ID || "sada-main";

/** Same unambiguous alphabet as the app (no 0/O, 1/I/L lookalikes). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomJoinCode() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("Missing scripts/serviceAccount.json — see seed.js header.");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  });
  const db = admin.firestore();

  const rootRef = db.doc(`restaurants/${RESTAURANT_ID}`);
  const root = await rootRef.get();
  if (!root.exists) {
    console.error(
      `restaurants/${RESTAURANT_ID} does not exist — nothing to migrate ` +
        "(run scripts/seed.js first, or pass the right restaurant id).",
    );
    process.exit(1);
  }

  // 1. joinCode on the root profile
  let joinCode = root.data().joinCode;
  if (!joinCode) {
    // Avoid the (tiny) chance of colliding with another restaurant's code.
    do {
      joinCode = randomJoinCode();
    } while ((await db.doc(`restaurantCodes/${joinCode}`).get()).exists);
    await rootRef.set({ joinCode }, { merge: true });
    console.log(`+ joinCode generated: ${joinCode}`);
  } else {
    console.log(`= joinCode already set: ${joinCode}`);
  }

  // 2. restaurantCodes/{code} lookup
  const codeRef = db.doc(`restaurantCodes/${joinCode}`);
  const code = await codeRef.get();
  if (!code.exists) {
    await codeRef.set({ restaurantId: RESTAURANT_ID });
    console.log(`+ restaurantCodes/${joinCode} -> ${RESTAURANT_ID}`);
  } else if (code.data().restaurantId !== RESTAURANT_ID) {
    console.error(
      `restaurantCodes/${joinCode} already points at ` +
        `"${code.data().restaurantId}" — resolve manually.`,
    );
    process.exit(1);
  } else {
    console.log(`= restaurantCodes/${joinCode} already correct`);
  }

  // 3. userIndex/{uid} for every existing member
  const users = await db.collection(`restaurants/${RESTAURANT_ID}/users`).get();
  let created = 0;
  for (const doc of users.docs) {
    const idxRef = db.doc(`userIndex/${doc.id}`);
    const idx = await idxRef.get();
    if (idx.exists) {
      if (idx.data().restaurantId !== RESTAURANT_ID) {
        console.warn(
          `! userIndex/${doc.id} points at "${idx.data().restaurantId}" — ` +
            "left untouched (a login belongs to one restaurant).",
        );
      }
      continue;
    }
    await idxRef.set({ restaurantId: RESTAURANT_ID });
    created++;
    console.log(`+ userIndex/${doc.id} -> ${RESTAURANT_ID} (${doc.data().email})`);
  }

  console.log(
    `\nDone. ${users.size} user(s) checked, ${created} index entrie(s) created.` +
      `\nStaff join code for ${RESTAURANT_ID}: ${joinCode}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
