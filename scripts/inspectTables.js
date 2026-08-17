/**
 * READ-ONLY: dump each table's status beside the open/billed orders that point
 * at it, so a table showing "Free" while an order is still on it is visible as
 * a mismatch rather than inferred from the UI.
 *
 * Throwaway diagnostic — no writes, no flags:
 *   node scripts/inspectTables.js <restaurantId>
 *   node scripts/inspectTables.js            # lists restaurant ids and exits
 */
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const rupees = (paise) => "₹" + ((paise ?? 0) / 100).toFixed(2);

async function main() {
  const rid = process.argv[2];

  if (!rid) {
    const snap = await db.collection("restaurants").get();
    console.log("Restaurants:");
    snap.forEach((d) =>
      console.log(`  ${d.id}  ${d.data().name ?? "(unnamed)"}`)
    );
    console.log("\nRe-run with:  node scripts/inspectTables.js <id>");
    return;
  }

  const base = db.collection("restaurants").doc(rid);
  const [tablesSnap, ordersSnap] = await Promise.all([
    base.collection("tables").get(),
    base.collection("orders").where("status", "in", ["open", "billed"]).get(),
  ]);

  // Orders grouped by the table they claim.
  const byTable = new Map();
  ordersSnap.forEach((d) => {
    const o = d.data();
    if (!o.tableId) return;
    if (!byTable.has(o.tableId)) byTable.set(o.tableId, []);
    byTable.get(o.tableId).push({ id: d.id, ...o });
  });

  console.log(`\nTables for ${rid}\n`);
  const rows = [];
  tablesSnap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  for (const t of rows) {
    const orders = byTable.get(t.id) ?? [];
    const live = orders.filter((o) => o.status === "open");
    const mismatch =
      (t.status === "available" && live.length > 0) ||
      (t.status !== "available" && orders.length === 0);

    console.log(
      `${(t.label ?? "T" + t.number).padEnd(6)} status=${String(t.status).padEnd(10)} ` +
        `currentOrderId=${t.currentOrderId ?? "null"}` +
        (mismatch ? "   <-- MISMATCH" : "")
    );
    for (const o of orders) {
      console.log(
        `        order ${o.id}  status=${String(o.status).padEnd(7)} ` +
          `total=${rupees(o.total)} billId=${o.billId ?? "null"} ` +
          `lines=${(o.items ?? []).length} ` +
          `created=${o.createdAt?.toDate?.()?.toISOString() ?? "?"}`
      );
    }
  }

  // Orders pointing at a table that no longer exists.
  const known = new Set(rows.map((t) => t.id));
  const orphans = [...byTable.keys()].filter((id) => !known.has(id));
  if (orphans.length) console.log("\nOrders on unknown tables:", orphans);
}

main().then(() => process.exit(0));
