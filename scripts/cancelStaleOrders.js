/**
 * Clear ABANDONED orders — the ones nobody can act on from inside the app.
 *
 * An order the floor walked away from stays `open` forever. The cashier's
 * Bills screen files it under "Preparing…" (no ticket was ever fired, so it is
 * not kitchen-done) and that card is deliberately NOT tappable — food first,
 * pay after. So the order sits there, un-billable and un-clearable, and the
 * list only grows. This is the Admin-SDK way out.
 *
 * Orders are marked `cancelled`, never deleted. That is the app's own word for
 * an order that ended without money changing hands (`voidBill` uses it), every
 * screen already filters it out, and the record survives for the audit.
 *
 *   node scripts/cancelStaleOrders.js --tenant <rid>                  list candidates
 *   node scripts/cancelStaleOrders.js --tenant <rid> --order <id> ...  one or more, by id
 *   node scripts/cancelStaleOrders.js --tenant <rid> --empty           the 0-line husks
 *   node scripts/cancelStaleOrders.js --tenant <rid> --older-than 48   idle 48h+
 *
 * Add --confirm to actually write. WITHOUT IT NOTHING IS WRITTEN — run the
 * read-only form first and eyeball the list, exactly like activateTenant.js.
 *
 * REFUSES to touch an order that has a billId, or whose status is not `open`.
 * A billed order is the cashier's business (settle it, or void the bill, which
 * cancels the order through the transaction that also fixes the day's takings)
 * — cancelling it behind the bill's back would strand a finalized bill.
 */
const { initAdmin } = require("./trialConfig");

function parseArgs(argv) {
  const opts = {
    tenant: null,
    orders: [],
    empty: false,
    olderThanHours: null,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") opts.tenant = argv[++i];
    else if (arg === "--order") opts.orders.push(argv[++i]);
    else if (arg === "--empty") opts.empty = true;
    else if (arg === "--older-than") opts.olderThanHours = Number(argv[++i]);
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
  if (opts.olderThanHours !== null && !Number.isFinite(opts.olderThanHours)) {
    console.error("\n  --older-than takes a number of hours.\n");
    process.exit(1);
  }
  return opts;
}

const money = (paise) => `Rs ${((paise ?? 0) / 100).toFixed(2)}`;

function describe(order, nowMs) {
  const lines = (order.items || []).filter((i) => !i.voided);
  const ageH = order.createdAt
    ? (nowMs - order.createdAt.toMillis()) / 3_600_000
    : null;
  const items = lines.map((i) => `${i.qty}x ${i.name}`).join(", ") || "(no items)";
  return [
    `  ${order.id}`,
    `     ${order.orderType}  ${money(order.subtotal)}  ${lines.length} line(s)`,
    `     age ${ageH === null ? "?" : `${ageH.toFixed(1)}h`}   ${items}`,
  ].join("\n");
}

/** Only an order nothing else is holding onto may be cancelled here. */
function blockReason(order) {
  if (order.status !== "open") return `status is "${order.status}", not "open"`;
  if (order.billId) return `carries bill ${order.billId} — settle or void it instead`;
  return null;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const { db } = initAdmin();
  const nowMs = Date.now();
  const col = db.collection(`restaurants/${opts.tenant}/orders`);

  let candidates;
  if (opts.orders.length > 0) {
    const snaps = await Promise.all(opts.orders.map((id) => col.doc(id).get()));
    candidates = [];
    snaps.forEach((snap, i) => {
      if (!snap.exists) {
        console.error(`  NOT FOUND: ${opts.orders[i]}`);
        return;
      }
      candidates.push({ id: snap.id, ...snap.data() });
    });
  } else {
    const snap = await col.where("status", "==", "open").get();
    candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (opts.empty) {
      candidates = candidates.filter(
        (o) => (o.items || []).filter((i) => !i.voided).length === 0
      );
    }
    if (opts.olderThanHours !== null) {
      const cutoff = nowMs - opts.olderThanHours * 3_600_000;
      candidates = candidates.filter(
        (o) => o.createdAt && o.createdAt.toMillis() < cutoff
      );
    }
  }

  candidates.sort(
    (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)
  );

  const blocked = [];
  const clearable = [];
  for (const o of candidates) {
    const reason = blockReason(o);
    if (reason) blocked.push({ order: o, reason });
    else clearable.push(o);
  }

  console.log(`\n  tenant ${opts.tenant}`);
  if (blocked.length > 0) {
    console.log(`\n  SKIPPED (${blocked.length}):`);
    for (const b of blocked) {
      console.log(describe(b.order, nowMs));
      console.log(`     -> ${b.reason}`);
    }
  }

  if (clearable.length === 0) {
    console.log(`\n  Nothing to cancel.\n`);
    process.exit(0);
  }

  console.log(`\n  WILL CANCEL (${clearable.length}):`);
  for (const o of clearable) console.log(describe(o, nowMs));

  if (!opts.confirm) {
    console.log(`\n  Read-only. Re-run with --confirm to write.\n`);
    process.exit(0);
  }

  const { FieldValue } = require("firebase-admin/firestore");
  const batch = db.batch();
  for (const o of clearable) {
    batch.update(col.doc(o.id), {
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`\n  Cancelled ${clearable.length} order(s).\n`);
  process.exit(0);
})().catch((e) => {
  console.error(`\n  FAILED: ${e.message}\n`);
  process.exit(1);
});
