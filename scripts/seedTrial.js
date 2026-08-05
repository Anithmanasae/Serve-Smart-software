/**
 * SEED A SANDBOX TRIAL — clone the live restaurant's reference data into an
 * isolated demo tenant, create the three prospect logins, and stamp a
 * server-clock expiry on both the workspace and every account.
 *
 * The prospect never touches the live restaurant. Their orders, KOTs, bills,
 * bill numbers and daily revenue all live under restaurants/{TRIAL_ID}/, which
 * the security rules isolate completely.
 *
 * WHAT IS CLONED (read from live, written to trial):
 *   root profile   name (+ " (Demo)"), addressLine, gstEnabled
 *   menuCategories  every doc, verbatim
 *   menuItems       every doc, verbatim. Images are stored as base64 data URIs
 *                   ON the menu item doc (not Firebase Storage), so the clone
 *                   is fully self-contained — the sandbox has no runtime
 *                   dependency on the live tenant or its Storage objects.
 *   tables          every doc, reset to available / unmerged / no open order
 *
 * WHAT IS NOT CLONED:
 *   joinCode        the trial gets a FRESH code — the live one never leaks
 *                   (and restaurantCodes is immutable, so a leaked code could
 *                   never be revoked)
 *   users, orders, kots, bills, counters, dailySummaries
 *
 * Safe to re-run: deterministic ids + merge, logins looked up by email first.
 * Re-running RESTARTS the clock — a fresh TRIAL_DAYS from the server's now.
 *
 * Usage:
 *   node scripts/seedTrial.js
 *   TRIAL_DAYS=7 TRIAL_RESTAURANT_ID=demo-acme node scripts/seedTrial.js
 */
const crypto = require("crypto");
const {
  admin,
  LIVE_RESTAURANT_ID,
  TRIAL_RESTAURANT_ID,
  TRIAL_DAYS,
  DEMO_PASSWORD,
  TRIAL_STAFF,
  assertTenantsDistinct,
  initAdmin,
  trialPath,
  livePath,
  serverNow,
  expiryFrom,
  commitInChunks,
  fail,
} = require("./trialConfig");

const { FieldValue } = admin.firestore;

/** Same unambiguous alphabet as the app (no 0/O, 1/I/L lookalikes). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomJoinCode() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** Copy every doc of a live collection into the trial tenant. READ-ONLY on
 *  live: we only ever .get() there. `transform` may reshape each doc. */
async function cloneCollection(db, name, transform = (d) => d) {
  const snap = await db.collection(livePath(name)).get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: transform(d.data(), d.id) }));
  await commitInChunks(db, docs, (batch, { id, data }) => {
    batch.set(db.doc(trialPath(`${name}/${id}`)), data, { merge: true });
  });
  console.log(`  ${name.padEnd(15)} ${docs.length} doc(s) cloned`);
  return docs.length;
}

async function cloneRootProfile(db, expiresAt) {
  const liveSnap = await db.doc(livePath()).get();
  if (!liveSnap.exists) {
    fail([
      `live tenant "${LIVE_RESTAURANT_ID}" has no root document — nothing to ` +
        "clone. Check LIVE_RESTAURANT_ID.",
    ]);
  }
  const live = liveSnap.data();

  // Keep an existing trial join code stable across re-seeds; mint a fresh one
  // on first run. NEVER reuse the live restaurant's code.
  const trialSnap = await db.doc(trialPath()).get();
  let joinCode = trialSnap.exists ? trialSnap.data().joinCode : null;
  if (!joinCode) {
    do {
      joinCode = randomJoinCode();
    } while ((await db.doc(`restaurantCodes/${joinCode}`).get()).exists);
  }

  await db.doc(trialPath()).set(
    {
      name: `${live.name || "Smart Serve"} (Demo)`,
      ...(live.addressLine ? { addressLine: live.addressLine } : {}),
      gstEnabled: live.gstEnabled ?? true,
      joinCode,
      // THE TENANT-LEVEL GATE. Absent on every real restaurant; present only
      // here. Blocks the whole workspace at the deadline, including any account
      // created inside it after seeding.
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.doc(`restaurantCodes/${joinCode}`).set({
    restaurantId: TRIAL_RESTAURANT_ID,
  });

  console.log(`  root profile    "${live.name} (Demo)", join code ${joinCode}`);
  return joinCode;
}

async function seedStaff(db, auth, expiresAt) {
  const created = [];
  for (const staff of TRIAL_STAFF) {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(staff.email);
      await auth.updateUser(userRecord.uid, { password: DEMO_PASSWORD });
      console.log(`  = ${staff.email} exists (uid ${userRecord.uid}) — refreshed`);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      userRecord = await auth.createUser({
        email: staff.email,
        password: DEMO_PASSWORD,
        displayName: staff.name,
      });
      console.log(`  + ${staff.email} created (uid ${userRecord.uid})`);
    }

    const userRef = db.doc(trialPath(`users/${userRecord.uid}`));
    const existing = await userRef.get();
    await userRef.set(
      {
        uid: userRecord.uid,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        // Pre-approved: the prospect skips the join-code + approval flow.
        status: "approved",
        active: true,
        // Per-account mirror of the workspace expiry. The client reads this to
        // flip to the "trial ended" screen; the rules enforce it independently.
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    // Tenant resolution: this is what lands the login in the sandbox.
    await db
      .doc(`userIndex/${userRecord.uid}`)
      .set({ restaurantId: TRIAL_RESTAURANT_ID });

    created.push({ ...staff, uid: userRecord.uid });
  }

  // A cashier is provisioned here, so the one-time owner seat must read as
  // taken — otherwise the signup screen would offer a second cashier.
  await db.doc(trialPath("meta/bootstrap")).set({ cashierClaimed: true });
  return created;
}

async function main() {
  assertTenantsDistinct();
  const { db, auth, projectId } = initAdmin();

  const now = await serverNow(db);
  const expiresAt = expiryFrom(now);

  console.log(
    `\nProject      ${projectId}\n` +
      `Clone FROM   ${LIVE_RESTAURANT_ID}  (read-only)\n` +
      `Seed INTO    ${TRIAL_RESTAURANT_ID}\n` +
      `Server now   ${now.toISOString()}\n` +
      `Trial ends   ${expiresAt.toISOString()}  (${TRIAL_DAYS} day(s))\n`,
  );

  console.log("--- Cloning reference data ---");
  const joinCode = await cloneRootProfile(db, expiresAt);
  await cloneCollection(db, "menuCategories");
  await cloneCollection(db, "menuItems");
  await cloneCollection(db, "tables", (t) => ({
    ...t,
    // A fresh floor: nothing occupied, nothing merged, no open orders.
    status: "available",
    currentOrderId: null,
    mergedInto: null,
    updatedAt: FieldValue.serverTimestamp(),
  }));

  console.log("\n--- Trial logins ---");
  const staff = await seedStaff(db, auth, expiresAt);

  console.log(`\n=== Sandbox ready ===\n`);
  console.log(`  Workspace   ${TRIAL_RESTAURANT_ID}`);
  console.log(`  Join code   ${joinCode}  (this sandbox only)`);
  console.log(`  Password    ${DEMO_PASSWORD}   (all three logins)`);
  console.log(`  Expires     ${expiresAt.toISOString()}\n`);
  for (const s of staff) {
    console.log(`  ${s.role.padEnd(8)} ${s.email.padEnd(26)} uid=${s.uid}`);
  }
  console.log(
    `\n  Verify with:  node scripts/auditTenants.js\n` +
      `  Hand to the next prospect with:  node scripts/resetTrial.js && node scripts/seedTrial.js\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
