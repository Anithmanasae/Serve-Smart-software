/**
 * One-time / idempotent dev seed script.
 *
 * Creates the four staff logins (admin, waiter, cashier, kitchen) plus
 * sample menu categories, menu items, and tables in Firestore — enough to
 * exercise Menu Management, Tables, and the login flow without hand-entering
 * data through the app.
 *
 * Requires scripts/serviceAccount.json (a Firebase Admin SDK private key —
 * see console.firebase.google.com/project/<id>/settings/serviceaccounts/adminsdk).
 * That file is gitignored — never commit it.
 *
 * Safe to re-run: users are looked up by email before creating, and every
 * Firestore doc uses a deterministic id with `merge: true`, so running this
 * twice updates in place instead of duplicating data.
 *
 * Usage: npm run seed
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccount.json");
const RESTAURANT_ID = process.env.EXPO_PUBLIC_RESTAURANT_ID || "sada-main";

/** Shared password for every seeded staff login — change after first login. */
const STAFF_PASSWORD = "Sada@1234";

const STAFF = [
  { role: "admin", name: "Asha Rao", email: "admin@sada-pos.test" },
  { role: "waiter", name: "Ravi Kumar", email: "waiter@sada-pos.test" },
  { role: "cashier", name: "Priya Nair", email: "cashier@sada-pos.test" },
  { role: "kitchen", name: "Suresh Iyer", email: "kitchen@sada-pos.test" },
];

const CATEGORIES = [
  { id: "starters", name: "Starters", sortOrder: 0 },
  { id: "main-course", name: "Main Course", sortOrder: 1 },
  { id: "breads", name: "Breads & Rice", sortOrder: 2 },
  { id: "beverages", name: "Beverages", sortOrder: 3 },
  { id: "desserts", name: "Desserts", sortOrder: 4 },
];

/** price is in rupees here for readability; converted to paise on write. */
const MENU_ITEMS = [
  { id: "veg-manchurian", name: "Veg Manchurian", categoryId: "starters", price: 180, sku: "STR-001" },
  { id: "chicken-65", name: "Chicken 65", categoryId: "starters", price: 240, sku: "STR-002" },
  { id: "paneer-tikka", name: "Paneer Tikka", categoryId: "starters", price: 220, sku: "STR-003" },
  { id: "paneer-butter-masala", name: "Paneer Butter Masala", categoryId: "main-course", price: 260, sku: "MAIN-001" },
  { id: "butter-chicken", name: "Butter Chicken", categoryId: "main-course", price: 320, sku: "MAIN-002" },
  { id: "dal-tadka", name: "Dal Tadka", categoryId: "main-course", price: 160, sku: "MAIN-003" },
  { id: "veg-biryani", name: "Veg Biryani", categoryId: "breads", price: 220, sku: "BR-001" },
  { id: "chicken-biryani", name: "Chicken Biryani", categoryId: "breads", price: 280, sku: "BR-002" },
  { id: "butter-naan", name: "Butter Naan", categoryId: "breads", price: 45, sku: "BR-003" },
  { id: "jeera-rice", name: "Jeera Rice", categoryId: "breads", price: 150, sku: "BR-004" },
  { id: "masala-chai", name: "Masala Chai", categoryId: "beverages", price: 40, sku: "BEV-001" },
  { id: "fresh-lime-soda", name: "Fresh Lime Soda", categoryId: "beverages", price: 70, sku: "BEV-002" },
  { id: "mango-lassi", name: "Mango Lassi", categoryId: "beverages", price: 90, sku: "BEV-003" },
  { id: "gulab-jamun", name: "Gulab Jamun (2 pc)", categoryId: "desserts", price: 80, sku: "DES-001" },
  { id: "gajar-halwa", name: "Gajar Ka Halwa", categoryId: "desserts", price: 110, sku: "DES-002" },
];

const TABLES = [
  { id: "t1", number: 1, label: "T1", capacity: 2 },
  { id: "t2", number: 2, label: "T2", capacity: 2 },
  { id: "t3", number: 3, label: "T3", capacity: 4 },
  { id: "t4", number: 4, label: "T4", capacity: 4 },
  { id: "t5", number: 5, label: "T5", capacity: 4 },
  { id: "t6", number: 6, label: "T6", capacity: 6 },
  { id: "t7", number: 7, label: "T7", capacity: 6 },
  { id: "t8", number: 8, label: "T8", capacity: 4 },
  { id: "t9", number: 9, label: "Patio 1", capacity: 2 },
  { id: "t10", number: 10, label: "Patio 2", capacity: 8 },
];

function rupeesToPaise(rupees) {
  return Math.round(rupees * 100);
}

/** Same unambiguous alphabet as the app (no 0/O, 1/I/L lookalikes). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomJoinCode() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

async function seedRestaurantProfile(db) {
  console.log(`\n--- Restaurant profile (restaurants/${RESTAURANT_ID}) ---`);
  const rootRef = db.doc(`restaurants/${RESTAURANT_ID}`);

  // Multi-tenant: the root doc carries the staff join code, mirrored in the
  // top-level restaurantCodes lookup. Keep an existing code stable.
  const existing = await rootRef.get();
  let joinCode = existing.exists ? existing.data().joinCode : null;
  if (!joinCode) {
    do {
      joinCode = randomJoinCode();
    } while ((await db.doc(`restaurantCodes/${joinCode}`).get()).exists);
  }

  // The root doc: what prints on the receipt header. Editable later from the
  // Account tab (admin/cashier), so only merge in defaults.
  await rootRef.set(
    {
      name: "SADA Restaurant",
      addressLine: "Bengaluru, Karnataka",
      gstEnabled: true,
      joinCode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await db.doc(`restaurantCodes/${joinCode}`).set({ restaurantId: RESTAURANT_ID });
  console.log(`  receipt header seeded (name + address), join code ${joinCode}`);
}

async function seedStaff(db) {
  console.log(`\n--- Staff logins (restaurants/${RESTAURANT_ID}/users) ---`);
  const created = [];

  for (const staff of STAFF) {
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(staff.email);
      console.log(`= ${staff.email} already exists (uid ${userRecord.uid}) — updating profile`);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      userRecord = await admin.auth().createUser({
        email: staff.email,
        password: STAFF_PASSWORD,
        displayName: staff.name,
      });
      console.log(`+ created ${staff.email} (uid ${userRecord.uid})`);
    }

    const userRef = db.doc(`restaurants/${RESTAURANT_ID}/users/${userRecord.uid}`);
    const existing = await userRef.get();

    await userRef.set(
      {
        uid: userRecord.uid,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        status: "approved",
        active: true,
        ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    // Multi-tenant: the app resolves the login's restaurant from this index.
    await db
      .doc(`userIndex/${userRecord.uid}`)
      .set({ restaurantId: RESTAURANT_ID });

    created.push({ ...staff, uid: userRecord.uid, password: STAFF_PASSWORD });
  }

  // Seeding provisions a cashier, so the one-time cashier self-signup claim
  // must read as taken — otherwise the signup screen would offer a second
  // cashier seat.
  await db
    .doc(`restaurants/${RESTAURANT_ID}/meta/bootstrap`)
    .set({ cashierClaimed: true });

  return created;
}

async function seedMenu(db) {
  console.log(`\n--- Menu (restaurants/${RESTAURANT_ID}/menuCategories, menuItems) ---`);
  const batch = db.batch();

  for (const cat of CATEGORIES) {
    const ref = db.doc(`restaurants/${RESTAURANT_ID}/menuCategories/${cat.id}`);
    batch.set(ref, { id: cat.id, name: cat.name, sortOrder: cat.sortOrder, enabled: true }, { merge: true });
  }

  for (const item of MENU_ITEMS) {
    const ref = db.doc(`restaurants/${RESTAURANT_ID}/menuItems/${item.id}`);
    batch.set(
      ref,
      {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        price: rupeesToPaise(item.price),
        enabled: true,
        sku: item.sku,
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`  ${CATEGORIES.length} categories, ${MENU_ITEMS.length} items`);
}

async function seedTables(db) {
  console.log(`\n--- Tables (restaurants/${RESTAURANT_ID}/tables) ---`);
  const batch = db.batch();

  for (const t of TABLES) {
    const ref = db.doc(`restaurants/${RESTAURANT_ID}/tables/${t.id}`);
    batch.set(
      ref,
      {
        id: t.id,
        number: t.number,
        label: t.label,
        capacity: t.capacity,
        status: "available",
        currentOrderId: null,
        mergedInto: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`  ${TABLES.length} tables`);
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `\nMissing ${SERVICE_ACCOUNT_PATH}\n` +
        "Download it from Firebase console > Project settings > Service accounts > " +
        "Generate new private key, and save it at scripts/serviceAccount.json.\n"
    );
    process.exit(1);
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  const db = admin.firestore();

  console.log(`Seeding project "${serviceAccount.project_id}", tenant "${RESTAURANT_ID}"...`);

  await seedRestaurantProfile(db);
  const staff = await seedStaff(db);
  await seedMenu(db);
  await seedTables(db);

  console.log("\n=== Done ===");
  console.log("\nStaff logins (all share one password for this seed):");
  console.log(`  password: ${STAFF_PASSWORD}\n`);
  for (const s of staff) {
    console.log(`  ${s.role.padEnd(8)} ${s.email.padEnd(24)} uid=${s.uid}`);
  }
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
