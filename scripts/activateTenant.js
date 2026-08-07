/**
 * ACTIVATE A PAYING CUSTOMER — turn a trial restaurant permanent.
 *
 * Activation is the DELETION of two fields from the restaurant root doc:
 *
 *   trialStartedAt   the server-stamped start of the 2-day self-serve trial
 *   expiresAt        an explicit deadline that overrides the computed one
 *
 * firestore.rules treats "neither field present" as NEVER EXPIRES, so removing
 * them makes the tenant indistinguishable from one that was never on a trial.
 * There is deliberately no `isPaid` flag to set: absence cannot drift out of
 * sync with reality, a boolean can.
 *
 * Requires scripts/serviceAccount.json (Admin SDK key — gitignored, never
 * commit it). The Admin SDK BYPASSES security rules, which is the only way
 * these fields can be written at all.
 *
 * READ-ONLY BY DEFAULT. Without --confirm this prints what it found and
 * changes nothing — always run it that way first and check the restaurant name
 * matches the customer you were actually paid by. The lookup is by email, and
 * activating the wrong tenant hands out free access.
 *
 * Usage:
 *   node scripts/activateTenant.js owner@restaurant.com              # dry run
 *   node scripts/activateTenant.js owner@restaurant.com --confirm    # activate
 *   node scripts/activateTenant.js --restaurant grace-r72gnh --confirm
 *
 *   # Subscription instead of permanent: paid up to a date, then locks again.
 *   node scripts/activateTenant.js owner@restaurant.com --until 2026-12-31 --confirm
 *
 * To REVOKE (a payment fell through), set a past date — an explicit expiresAt
 * overrides everything and locks the workspace immediately:
 *   node scripts/activateTenant.js owner@restaurant.com --until 2000-01-01 --confirm
 */
const { admin, initAdmin } = require("./trialConfig");
const { trialStatus } = require("./trialStatus");

const { FieldValue } = admin.firestore;

// ── argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { email: null, restaurantId: null, confirm: false, until: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--restaurant") opts.restaurantId = argv[++i];
    else if (arg === "--until") opts.until = argv[++i];
    else if (arg.startsWith("--")) die(`Unknown option "${arg}".`);
    else if (!opts.email) opts.email = arg;
    else die(`Unexpected extra argument "${arg}".`);
  }
  if (!opts.email && !opts.restaurantId) {
    die("Give the customer's email (or --restaurant <id>).");
  }
  if (opts.email && opts.restaurantId) {
    die("Give an email OR --restaurant, not both.");
  }
  if (opts.until !== null) {
    const parsed = new Date(`${opts.until}T23:59:59Z`);
    if (Number.isNaN(parsed.getTime())) {
      die(`--until "${opts.until}" is not a date. Use YYYY-MM-DD.`);
    }
    opts.untilDate = parsed;
  }
  return opts;
}

function die(message) {
  console.error(`\n  ${message}\n`);
  console.error("  node scripts/activateTenant.js <email> [--confirm]");
  console.error("  node scripts/activateTenant.js --restaurant <id> [--confirm]");
  console.error("  node scripts/activateTenant.js <email> --until YYYY-MM-DD --confirm\n");
  process.exit(1);
}

// ── tenant resolution ────────────────────────────────────────────────────────

/** email → auth user → userIndex/{uid} → restaurantId. This is the chain the
 *  app itself uses to resolve a login's tenant, so it can't disagree. */
async function resolveByEmail(db, auth, email) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      die(
        `No login exists for "${email}".\n` +
          "  Check the spelling, and confirm it's the address they SIGNED UP with.",
      );
    }
    throw err;
  }
  const idx = await db.doc(`userIndex/${user.uid}`).get();
  if (!idx.exists) {
    die(
      `"${email}" exists as a login (uid ${user.uid}) but belongs to no ` +
        "restaurant.\n  Their signup probably failed halfway. They should register again.",
    );
  }
  return { restaurantId: idx.data().restaurantId, uid: user.uid };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { db, auth, projectId } = initAdmin();
  const now = new Date();

  const resolved = opts.email
    ? await resolveByEmail(db, auth, opts.email)
    : { restaurantId: opts.restaurantId, uid: null };
  const rid = resolved.restaurantId;

  const rootSnap = await db.doc(`restaurants/${rid}`).get();
  if (!rootSnap.exists) {
    die(`restaurants/${rid} does not exist. Check --restaurant.`);
  }
  const root = rootSnap.data();
  const status = trialStatus(root, now);

  // ── report ────────────────────────────────────────────────────────────────
  const usersSnap = await db.collection(`restaurants/${rid}/users`).get();
  const owner = usersSnap.docs
    .map((d) => d.data())
    .find((u) => u.role === "cashier");
  const withExpiry = usersSnap.docs.filter(
    (d) => d.data().expiresAt !== undefined,
  );

  console.log(`\n  Project      ${projectId}`);
  console.log(`  Restaurant   ${root.name ?? "—"}`);
  console.log(`  Tenant id    ${rid}`);
  console.log(`  Owner        ${owner ? `${owner.email} (${owner.name ?? "—"})` : "— none found —"}`);
  console.log(`  Staff        ${usersSnap.size} account(s)`);
  console.log(`  Status       ${status.label}`);
  if (withExpiry.length) {
    console.log(`  Per-account  ${withExpiry.length} account(s) carry their own expiresAt`);
  }
  console.log(
    `\n  (local clock — enforcement uses the server's, treat countdowns as approximate)`,
  );

  // ── decide ────────────────────────────────────────────────────────────────
  const goingPermanent = opts.untilDate === undefined;

  if (goingPermanent && status.permanent && !withExpiry.length) {
    console.log(
      `\n  Already permanent. Nothing to do — this restaurant never expires.\n`,
    );
    process.exit(0);
  }

  if (!opts.confirm) {
    const action = goingPermanent
      ? "clear the trial fields and make this restaurant PERMANENT"
      : `set expiresAt to ${opts.untilDate.toISOString()}`;
    console.log(`\n  DRY RUN — nothing was written.`);
    console.log(`  Re-run with --confirm to ${action}:\n`);
    console.log(
      `    node scripts/activateTenant.js ${opts.email ?? `--restaurant ${rid}`}` +
        `${opts.until ? ` --until ${opts.until}` : ""} --confirm\n`,
    );
    process.exit(0);
  }

  // ── write ─────────────────────────────────────────────────────────────────
  if (goingPermanent) {
    await db.doc(`restaurants/${rid}`).set(
      {
        trialStartedAt: FieldValue.delete(),
        expiresAt: FieldValue.delete(),
      },
      { merge: true },
    );
    console.log(`\n  ✔ cleared trialStartedAt + expiresAt on restaurants/${rid}`);
  } else {
    await db.doc(`restaurants/${rid}`).set(
      {
        trialStartedAt: FieldValue.delete(),
        expiresAt: admin.firestore.Timestamp.fromDate(opts.untilDate),
      },
      { merge: true },
    );
    console.log(
      `\n  ✔ set expiresAt = ${opts.untilDate.toISOString()} on restaurants/${rid}`,
    );
  }

  // Per-account expiries are a legacy of the Admin-seeded sandbox (seedTrial.js
  // mirrors the deadline onto each login). The tenant field gates everyone, so
  // these are redundant — but one left behind would keep that ONE person locked
  // out of a restaurant that is otherwise paid up.
  for (const doc of withExpiry) {
    await doc.ref.set({ expiresAt: FieldValue.delete() }, { merge: true });
    console.log(`  ✔ cleared expiresAt on users/${doc.id} (${doc.data().email ?? "—"})`);
  }

  const after = trialStatus((await db.doc(`restaurants/${rid}`).get()).data(), new Date());
  console.log(`\n  Status now   ${after.label}`);
  console.log(
    `\n  Their app unblocks on the next snapshot — no reinstall. If they were\n` +
      `  sitting inside the app when it locked, tell them to close and reopen it\n` +
      `  (Firestore drops a listener permanently when it hits permission-denied).\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nActivation failed:", err);
  process.exit(1);
});
