/**
 * READ-ONLY AUDIT — who is on trial, who is expiring, who has paid.
 *
 * Performs ZERO writes. This is the tool you'll actually live in: with
 * self-serve trials, every prospect registers their own tenant, so "how many
 * restaurants exist and what state are they in" stops being something you can
 * hold in your head.
 *
 * Two modes:
 *
 *   node scripts/auditTenants.js                 every tenant, one line each
 *   node scripts/auditTenants.js --tenant <rid>  one tenant, in full detail
 *
 * Flags:
 *   --expiring   only tenants that end within 24h (your chase list)
 *   --trials     only tenants still on a trial
 *   --paid       only permanent / paid-through tenants
 *
 * Status precedence comes from scripts/trialStatus.js, which mirrors
 * firestore.rules. Countdowns use THIS machine's clock; enforcement uses
 * Google's, so treat them as approximate.
 */
const {
  REFERENCE_COLLECTIONS,
  TRANSACTIONAL_COLLECTIONS,
  initAdmin,
} = require("./trialConfig");
const { trialStatus, describeRemaining } = require("./trialStatus");

const COLLECTIONS = [
  "users",
  ...REFERENCE_COLLECTIONS,
  ...TRANSACTIONAL_COLLECTIONS,
];

function parseArgs(argv) {
  const opts = { tenant: null, filter: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") opts.tenant = argv[++i];
    else if (arg === "--expiring") opts.filter = "expiring";
    else if (arg === "--trials") opts.filter = "trials";
    else if (arg === "--paid") opts.filter = "paid";
    else {
      console.error(`\n  Unknown argument "${arg}".\n`);
      process.exit(1);
    }
  }
  return opts;
}

/** "no expiry — permanent" for an individual account. */
function describeAccountExpiry(value, now) {
  if (value === undefined || value === null) return "no expiry — permanent";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return `INVALID (${JSON.stringify(value)})`;
  return `${date.toISOString()}  (${describeRemaining(date.getTime() - now.getTime())})`;
}

// ── detail mode ──────────────────────────────────────────────────────────────

async function auditOne(db, restaurantId, now) {
  const rule = "═".repeat(72);
  console.log(`\n${rule}\n  restaurants/${restaurantId}\n${rule}`);

  const rootSnap = await db.doc(`restaurants/${restaurantId}`).get();
  if (!rootSnap.exists) {
    console.log("  (no root document — this tenant does not exist)\n");
    return;
  }
  const root = rootSnap.data();
  const status = trialStatus(root, now);
  console.log(`  name           ${root.name ?? "—"}`);
  console.log(`  joinCode       ${root.joinCode ?? "—"}`);
  console.log(`  gstEnabled     ${root.gstEnabled ?? "—"}`);
  console.log(`  WORKSPACE      ${status.label}`);

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
        `${flags.padEnd(18)} ${describeAccountExpiry(u.expiresAt, now)}`,
    );
  }
  console.log();
}

// ── list mode ────────────────────────────────────────────────────────────────

function matchesFilter(status, filter) {
  if (!filter) return true;
  if (filter === "paid") return status.permanent || status.kind === "override";
  if (filter === "trials") return status.kind === "trial";
  if (filter === "expiring") {
    if (status.endsAt === null) return false;
    const ms = status.endsAt.getTime() - Date.now();
    return ms > 0 && ms <= 24 * 60 * 60 * 1000;
  }
  return true;
}

async function auditAll(db, now, filter) {
  const snap = await db.collection("restaurants").get();
  if (snap.empty) {
    console.log("\n  No restaurants exist in this project.\n");
    return;
  }

  const rows = [];
  for (const doc of snap.docs) {
    const root = doc.data();
    const status = trialStatus(root, now);
    if (!matchesFilter(status, filter)) continue;

    const usersSnap = await db.collection(`restaurants/${doc.id}/users`).count().get();
    const ownerSnap = await db
      .collection(`restaurants/${doc.id}/users`)
      .where("role", "==", "cashier")
      .limit(1)
      .get();
    rows.push({
      id: doc.id,
      name: root.name ?? "—",
      owner: ownerSnap.empty ? "—" : (ownerSnap.docs[0].data().email ?? "—"),
      staff: usersSnap.data().count,
      status,
    });
  }

  if (!rows.length) {
    console.log(`\n  No tenants match --${filter}.\n`);
    return;
  }

  // Sorted by what needs YOUR attention, not by date:
  //   0 expired      — waiting on you to activate them
  //   1 live trial   — soonest deadline first, your chase list
  //   2 paid-through — fine for now, renews later
  //   3 permanent    — nothing to do, ever
  const rank = (r) => {
    if (r.status.expired) return 0;
    if (r.status.kind === "trial") return 1;
    if (r.status.kind === "override") return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    if (a.status.endsAt && b.status.endsAt) {
      return a.status.endsAt.getTime() - b.status.endsAt.getTime();
    }
    return a.name.localeCompare(b.name);
  });

  const nameW = Math.min(28, Math.max(12, ...rows.map((r) => r.name.length)));
  const idW = Math.min(26, Math.max(9, ...rows.map((r) => r.id.length)));
  const ownerW = Math.min(30, Math.max(12, ...rows.map((r) => r.owner.length)));

  console.log(
    `\n  ${"RESTAURANT".padEnd(nameW)}  ${"TENANT ID".padEnd(idW)}  ` +
      `${"OWNER".padEnd(ownerW)}  STAFF  STATUS`,
  );
  console.log(`  ${"─".repeat(nameW + idW + ownerW + 24)}`);
  for (const r of rows) {
    console.log(
      `  ${r.name.slice(0, nameW).padEnd(nameW)}  ${r.id.slice(0, idW).padEnd(idW)}  ` +
        `${r.owner.slice(0, ownerW).padEnd(ownerW)}  ${String(r.staff).padStart(5)}  ${r.status.label}`,
    );
  }

  const trials = rows.filter((r) => r.status.kind === "trial" && !r.status.expired);
  const expired = rows.filter((r) => r.status.expired);
  const paid = rows.filter((r) => r.status.permanent || r.status.kind === "override");
  console.log(
    `\n  ${rows.length} tenant(s): ` +
      `${trials.length} on trial, ${expired.length} expired, ${paid.length} paid/permanent\n`,
  );
  if (expired.length) {
    console.log(`  Activate one with:`);
    console.log(
      `    node scripts/activateTenant.js ${expired[0].owner} --confirm\n`,
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { db, projectId } = initAdmin();
  const now = new Date();

  console.log(`\nREAD-ONLY AUDIT — project ${projectId}`);
  console.log(`Local time ${now.toISOString()} (expiry is enforced against the`);
  console.log(`server clock; treat the countdowns below as approximate)`);

  if (opts.tenant) await auditOne(db, opts.tenant, now);
  else await auditAll(db, now, opts.filter);

  console.log("No writes were performed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nAudit failed:", err);
  process.exit(1);
});
