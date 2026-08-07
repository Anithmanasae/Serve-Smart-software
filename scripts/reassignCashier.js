/**
 * REASSIGN THE CASHIER (OWNER) SEAT.
 *
 * THE PROBLEM THIS SOLVES: whoever taps "New restaurant" becomes that
 * restaurant's cashier, permanently. A manager runs the demo, the actual owner
 * pays — and now the wrong person holds the seat. Nothing inside the app can
 * fix it:
 *
 *   - meta/bootstrap.cashierClaimed is true, and the rules require it to be
 *     false/absent for a self-claim, so the seat can never be re-claimed.
 *   - a cashier's update rule is hard-locked to role in ['waiter','kitchen']
 *     on BOTH sides, so a cashier cannot promote anyone to cashier either.
 *
 * That leaves the Admin SDK, which bypasses rules entirely. Hence this script.
 *
 * It is also how you give a restaurant a SECOND cashier (two managers sharing
 * the till) — the one-per-restaurant limit applies only to the self-claim at
 * signup, not to how many cashier profiles may exist.
 *
 * The target must ALREADY be a member: have them sign up with the restaurant's
 * join code (as waiter or kitchen) first. That keeps their Firebase Auth login,
 * their userIndex entry and their profile doc consistent — this script only
 * changes the role on a profile that already exists.
 *
 * READ-ONLY BY DEFAULT. Without --confirm it prints the plan and writes nothing.
 *
 * Usage:
 *   node scripts/reassignCashier.js --to owner@restaurant.com
 *   node scripts/reassignCashier.js --to owner@restaurant.com --confirm
 *
 *   # ...and demote the person who currently holds it:
 *   node scripts/reassignCashier.js --to owner@x.com --from manager@x.com --confirm
 *
 *   # demote to kitchen instead of waiter:
 *   node scripts/reassignCashier.js --to owner@x.com --from manager@x.com \
 *     --demote-to kitchen --confirm
 */
const { admin, initAdmin } = require("./trialConfig");
const { trialStatus } = require("./trialStatus");

const { FieldValue } = admin.firestore;

const DEMOTABLE = ["waiter", "kitchen"];

function die(message) {
  console.error(`\n  ${message}\n`);
  console.error("  node scripts/reassignCashier.js --to <email> [--from <email>] [--confirm]\n");
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { to: null, from: null, demoteTo: "waiter", confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--to") opts.to = argv[++i];
    else if (arg === "--from") opts.from = argv[++i];
    else if (arg === "--demote-to") opts.demoteTo = argv[++i];
    else if (arg === "--confirm") opts.confirm = true;
    else die(`Unknown argument "${arg}".`);
  }
  if (!opts.to) die("Give the new owner's email with --to.");
  if (!DEMOTABLE.includes(opts.demoteTo)) {
    die(`--demote-to must be one of: ${DEMOTABLE.join(", ")}.`);
  }
  return opts;
}

/** email → auth user → userIndex/{uid} → { uid, restaurantId } */
async function resolveMember(db, auth, email, label) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      die(
        `No login exists for ${label} "${email}".\n` +
          "  They must sign up with the restaurant's join code first.",
      );
    }
    throw err;
  }
  const idx = await db.doc(`userIndex/${user.uid}`).get();
  if (!idx.exists) {
    die(
      `${label} "${email}" exists as a login but belongs to no restaurant.\n` +
        "  Have them sign up with the restaurant's join code first.",
    );
  }
  return { uid: user.uid, restaurantId: idx.data().restaurantId, email };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { db, auth, projectId } = initAdmin();

  const target = await resolveMember(db, auth, opts.to, "the new owner");
  const rid = target.restaurantId;

  const rootSnap = await db.doc(`restaurants/${rid}`).get();
  if (!rootSnap.exists) die(`restaurants/${rid} does not exist.`);
  const root = rootSnap.data();

  const targetSnap = await db.doc(`restaurants/${rid}/users/${target.uid}`).get();
  if (!targetSnap.exists) {
    die(
      `"${opts.to}" has a userIndex pointing at ${rid} but no profile there.\n` +
        "  Their signup failed halfway — have them sign up again.",
    );
  }
  const targetProfile = targetSnap.data();

  let current = null;
  if (opts.from) {
    current = await resolveMember(db, auth, opts.from, "the current owner");
    if (current.restaurantId !== rid) {
      die(
        `"${opts.from}" belongs to ${current.restaurantId}, not ${rid}.\n` +
          "  Both accounts must be in the SAME restaurant.",
      );
    }
    const currentSnap = await db.doc(`restaurants/${rid}/users/${current.uid}`).get();
    if (!currentSnap.exists) die(`"${opts.from}" has no profile in ${rid}.`);
    if (currentSnap.data().role !== "cashier") {
      die(
        `"${opts.from}" is a ${currentSnap.data().role}, not the cashier.\n` +
          "  Nothing to demote — drop --from to simply add a second cashier.",
      );
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const cashiers = await db
    .collection(`restaurants/${rid}/users`)
    .where("role", "==", "cashier")
    .get();

  console.log(`\n  Project      ${projectId}`);
  console.log(`  Restaurant   ${root.name ?? "—"}  (${rid})`);
  console.log(`  Status       ${trialStatus(root).label}`);
  console.log(`\n  Cashier seat(s) today (${cashiers.size}):`);
  for (const doc of cashiers.docs) {
    console.log(`    ${doc.data().email ?? doc.id}  (${doc.data().name ?? "—"})`);
  }
  console.log(`\n  PROMOTE      ${opts.to}`);
  console.log(
    `               ${targetProfile.name ?? "—"} — currently ` +
      `${targetProfile.role}/${targetProfile.status}` +
      `${targetProfile.active ? "/active" : "/inactive"}`,
  );
  if (current) {
    console.log(`  DEMOTE       ${opts.from}  →  ${opts.demoteTo}`);
  } else {
    console.log(
      `  DEMOTE       (nobody — the existing cashier keeps their seat, so this\n` +
        `               restaurant will have ${cashiers.size + 1} cashiers)`,
    );
  }

  if (!opts.confirm) {
    console.log(`\n  DRY RUN — nothing was written. Re-run with --confirm.\n`);
    process.exit(0);
  }

  // ── write ─────────────────────────────────────────────────────────────────
  const batch = db.batch();
  batch.set(
    db.doc(`restaurants/${rid}/users/${target.uid}`),
    {
      role: "cashier",
      // A promoted staff member may still be pending or restricted; the owner
      // seat is useless in that state, so approve and activate in the same
      // write rather than leaving a half-usable account.
      status: "approved",
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (current) {
    batch.set(
      db.doc(`restaurants/${rid}/users/${current.uid}`),
      { role: opts.demoteTo, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  // Belt and braces: the seat is claimed either way, but if this doc were ever
  // missing a fresh self-claim could still slip through.
  batch.set(db.doc(`restaurants/${rid}/meta/bootstrap`), { cashierClaimed: true });
  await batch.commit();

  console.log(`\n  ✔ ${opts.to} is now the cashier of ${rid}`);
  if (current) console.log(`  ✔ ${opts.from} demoted to ${opts.demoteTo}`);
  console.log(
    `\n  Both devices update live — the profile doc is watched with onSnapshot,\n` +
      `  so roles switch without signing out.\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nReassign failed:", err);
  process.exit(1);
});
