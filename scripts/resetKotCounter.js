/**
 * Restart a tenant's KOT numbering at 1.
 *
 * `counters/kotTicket` used to be seeded at 4000, so the first ticket a
 * restaurant ever fired was KOT 4001. It now seeds at 0 (KOT 1) — but a seed
 * only applies to a counter that does not exist yet, so any tenant created
 * before that change keeps counting from where it got to. This is the Admin
 * SDK way to bring one back to 1.
 *
 *   node scripts/resetKotCounter.js --tenant <rid>              show the state
 *   node scripts/resetKotCounter.js --tenant <rid> --confirm    counter -> 0
 *   node scripts/resetKotCounter.js --tenant <rid> --renumber --confirm
 *
 * Add --confirm to actually write. WITHOUT IT NOTHING IS WRITTEN — run the
 * read-only form first, exactly like activateTenant.js.
 *
 * REFUSES to reset the counter past a ticket that already exists: two KOTs
 * with the same number on one board is worse than a large number, and the
 * kitchen talks in those numbers. When old tickets are in the way, --renumber
 * rewrites them 1..N in fire order first, so the sequence is dense and the
 * counter lands on N. That rewrite is for a TEST tenant — a KOT number a
 * customer or a printed ticket has already seen should not change under them.
 */
const { initAdmin } = require("./trialConfig");

function parseArgs(argv) {
  const opts = { tenant: null, renumber: false, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") opts.tenant = argv[++i];
    else if (arg === "--renumber") opts.renumber = true;
    else if (arg === "--confirm") opts.confirm = true;
    else {
      console.error(`\n  Unknown argument "${arg}".\n`);
      process.exit(1);
    }
  }
  if (!opts.tenant) {
    console.error("\n  --tenant <restaurantId> is required.\n");
    process.exit(1);
  }
  return opts;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const { db } = initAdmin();
  const counterRef = db.doc(`restaurants/${opts.tenant}/counters/kotTicket`);
  const kotsCol = db.collection(`restaurants/${opts.tenant}/kots`);

  const [counterSnap, kotsSnap] = await Promise.all([
    counterRef.get(),
    kotsCol.orderBy("createdAt", "asc").get(),
  ]);

  const counter = counterSnap.exists ? counterSnap.data().value : null;
  const kots = kotsSnap.docs.map((d) => ({
    id: d.id,
    ticketNumber: d.data().ticketNumber,
    tableLabel: d.data().tableLabel,
    status: d.data().status,
  }));
  const highest = kots.reduce((n, k) => Math.max(n, k.ticketNumber ?? 0), 0);

  console.log(`\n  tenant ${opts.tenant}`);
  console.log(`  counters/kotTicket : ${counter === null ? "(absent)" : counter}`);
  console.log(`  kots on record     : ${kots.length}  (highest #${highest})`);

  if (opts.renumber) {
    console.log(`\n  WILL RENUMBER ${kots.length} ticket(s) 1..${kots.length}:`);
    for (const [i, k] of kots.entries()) {
      console.log(
        `    #${k.ticketNumber} -> #${i + 1}   ${k.tableLabel} (${k.status})`
      );
    }
    console.log(`  WILL SET counters/kotTicket = ${kots.length}`);
  } else {
    if (highest > 0) {
      console.error(
        `\n  REFUSED: ticket #${highest} already exists, so the next ticket` +
          `\n  would collide with it. Re-run with --renumber to rewrite the` +
          `\n  existing tickets 1..${kots.length} first.\n`
      );
      process.exit(1);
    }
    console.log(`\n  WILL SET counters/kotTicket = 0  (next ticket is KOT 1)`);
  }

  if (!opts.confirm) {
    console.log(`\n  Read-only. Re-run with --confirm to write.\n`);
    process.exit(0);
  }

  // Chunked well under Firestore's 500-writes-per-batch ceiling.
  if (opts.renumber) {
    for (let i = 0; i < kots.length; i += 400) {
      const batch = db.batch();
      for (const [j, k] of kots.slice(i, i + 400).entries()) {
        batch.update(kotsCol.doc(k.id), { ticketNumber: i + j + 1 });
      }
      await batch.commit();
    }
  }
  // Last, so a failed renumber never leaves the counter below live tickets.
  await counterRef.set({ value: opts.renumber ? kots.length : 0 });

  console.log(
    `\n  Done. Next ticket is KOT ${(opts.renumber ? kots.length : 0) + 1}.\n`
  );
  process.exit(0);
})().catch((e) => {
  console.error(`\n  FAILED: ${e.message}\n`);
  process.exit(1);
});
