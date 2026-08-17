/**
 * READ-ONLY: stream every change to a tenant's tables (and open orders) as it
 * lands, so "the table went back to green" can be caught in the act with a
 * timestamp instead of reconstructed afterwards.
 *
 *   node scripts/watchTables.js <restaurantId>
 *
 * Throwaway diagnostic. Ctrl-C to stop.
 */
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const rid = process.argv[2];
if (!rid) {
  console.error("usage: node scripts/watchTables.js <restaurantId>");
  process.exit(1);
}

const now = () => new Date().toISOString().slice(11, 23);
const base = db.collection("restaurants").doc(rid);

console.log(`watching ${rid} — tables and open orders. Ctrl-C to stop.\n`);

let firstTables = true;
base.collection("tables").onSnapshot((snap) => {
  if (firstTables) {
    firstTables = false;
    console.log(`${now()}  baseline:`);
    snap.forEach((d) => {
      const t = d.data();
      console.log(
        `           ${t.label ?? d.id}  ${t.status}  order=${t.currentOrderId ?? "null"}`
      );
    });
    console.log("");
    return;
  }
  snap.docChanges().forEach((c) => {
    const t = c.doc.data();
    console.log(
      `${now()}  TABLE ${c.type.padEnd(8)} ${t.label ?? c.doc.id}  ` +
        `status=${t.status}  currentOrderId=${t.currentOrderId ?? "null"}`
    );
  });
});

let firstOrders = true;
base
  .collection("orders")
  .where("status", "in", ["open", "billed"])
  .onSnapshot((snap) => {
    if (firstOrders) {
      firstOrders = false;
      return;
    }
    snap.docChanges().forEach((c) => {
      const o = c.doc.data();
      console.log(
        `${now()}  ORDER ${c.type.padEnd(8)} ${c.doc.id}  ` +
          `status=${o.status}  tableId=${o.tableId ?? "null"}  ` +
          `lines=${(o.items ?? []).length}`
      );
    });
  });
