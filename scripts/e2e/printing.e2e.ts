/**
 * E2E for the printing feature set, against the live dev project + deployed
 * rules, driving the REAL app modules:
 *
 *   - restaurant profile (root doc): cashier can save, waiter can read but
 *     NOT write, empty/oversized names are rejected by rules
 *   - sequential bill numbers: two takeaway orders billed back-to-back get
 *     consecutive counters/billNumber values (pay-first, so no kitchen wait)
 *   - the ESC/POS encoder renders that live bill correctly at both widths
 *
 * Run: npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/printing.e2e.ts
 */
import { signInWithEmailAndPassword } from "firebase/auth";
import { getDoc, setDoc } from "firebase/firestore";
import { auth, RESTAURANT_ID } from "./firebase-shim";
import { paths, setActiveRestaurantId } from "@/lib/firestore/paths";

// Node has no __DEV__ fallback — pin the tenant this suite runs against.
setActiveRestaurantId(RESTAURANT_ID);
import { saveRestaurantProfile } from "@/features/settings/useRestaurantProfile";
import { createOrderLocal, sendKot } from "@/features/order/orderApi";
import { generateBill, settleBill } from "@/features/cashier/cashierApi";
import { encodeReceipt, formatBillNumber } from "@/lib/printer/escpos";
import type { Bill, Order } from "@/types/models";

const PASSWORD = "Sada@1234";

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✔ [${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function signIn(role: "waiter" | "cashier"): Promise<string> {
  const cred = await signInWithEmailAndPassword(
    auth,
    `${role}@sada-pos.test`,
    PASSWORD
  );
  return cred.user.uid;
}

async function expectPermissionDenied(p: Promise<unknown>, what: string) {
  try {
    await p;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    assert(
      code === "permission-denied",
      `${what}: expected permission-denied, got ${code || e}`
    );
    return;
  }
  throw new Error(`${what}: unexpectedly SUCCEEDED`);
}

/** Takeaway order (pay-first): billable as soon as its KOT exists. */
async function takeawayBill(cashierUid: string): Promise<Bill> {
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: cashierUid,
    menuItemId: "masala-chai",
    name: "Masala Chai",
    price: 4000,
  });
  await created.commit;
  await sendKot(created.orderId, "Takeaway");

  const orderSnap = await getDoc(paths.order(created.orderId));
  assert(orderSnap.exists(), "takeaway order exists");
  const order = { ...orderSnap.data(), id: orderSnap.id } as Order;

  const billId = await generateBill(order, cashierUid, "Takeaway");
  const billSnap = await getDoc(paths.bill(billId));
  assert(billSnap.exists(), "bill doc created");
  const bill = { ...billSnap.data(), id: billSnap.id } as Bill;

  // Settle so no dangling open orders/bills are left behind.
  const billedOrder = {
    ...(await getDoc(paths.order(created.orderId))).data()!,
    id: created.orderId,
  } as Order;
  await settleBill(bill, billedOrder, "cash");
  return bill;
}

async function main() {
  // ── Restaurant profile: cashier writes, rules validate ───────────────────
  await signIn("cashier");
  await saveRestaurantProfile("Verify Cafe E2E", "42 Test Street, Bengaluru");
  let profileSnap = await getDoc(paths.restaurantProfile());
  assert(profileSnap.exists(), "root profile doc exists");
  assert(profileSnap.data()!.name === "Verify Cafe E2E", "name saved");
  ok("cashier saved the restaurant profile (root doc)");

  await expectPermissionDenied(
    setDoc(paths.restaurantProfile(), { name: "" }, { merge: true }),
    "empty name"
  );
  await expectPermissionDenied(
    setDoc(
      paths.restaurantProfile(),
      { name: "x".repeat(61) },
      { merge: true }
    ),
    "61-char name"
  );
  ok("rules rejected empty and oversized names");

  // ── Waiter: can read the header, cannot edit it ───────────────────────────
  await signIn("waiter");
  profileSnap = await getDoc(paths.restaurantProfile());
  assert(profileSnap.exists(), "waiter can read the profile");
  await expectPermissionDenied(
    setDoc(paths.restaurantProfile(), { name: "Hacked" }, { merge: true }),
    "waiter profile write"
  );
  ok("waiter can read but not write the profile");

  // ── Sequential bill numbers across two bills ─────────────────────────────
  const cashierUid = await signIn("cashier");
  const first = await takeawayBill(cashierUid);
  const second = await takeawayBill(cashierUid);
  assert(typeof first.billNumber === "number", "bill #1 carries billNumber");
  assert(
    second.billNumber === first.billNumber! + 1,
    `sequential: ${first.billNumber} then ${second.billNumber}`
  );
  const counterSnap = await getDoc(paths.counter("billNumber"));
  assert(
    counterSnap.data()!.value === second.billNumber,
    "counters/billNumber matches the last minted number"
  );
  ok(
    `bill numbers sequential: ${formatBillNumber(
      first.billNumber
    )} → ${formatBillNumber(second.billNumber)}`
  );

  // ── Encoder consumes the LIVE bill ───────────────────────────────────────
  const orderSnap = await getDoc(paths.order(second.orderId));
  const order = { ...orderSnap.data()!, id: second.orderId } as Order;
  for (const paperWidth of [58, 80] as const) {
    const { preview } = encodeReceipt({
      profile: profileSnap.data()!,
      bill: second,
      order,
      cashierName: "Priya Nair",
      paperWidth,
      paymentLabel: "Cash",
    });
    assert(
      preview.includes(`Bill No : ${formatBillNumber(second.billNumber)}`),
      `${paperWidth}mm receipt shows the bill number`
    );
    assert(preview.includes("Rs.40.00"), `${paperWidth}mm shows grand total`);
    const cols = paperWidth === 58 ? 32 : 48;
    for (const line of preview.split("\n")) {
      assert(line.length <= cols, `${paperWidth}mm line overflow: "${line}"`);
    }
  }
  ok("live bill encodes cleanly at 32 and 48 cols");

  // Restore the seeded header so the dev app keeps its normal name.
  await saveRestaurantProfile("SADA Restaurant", "Bengaluru, Karnataka");
  ok("restored seeded restaurant profile");

  console.log(`\nPRINTING E2E PASS — ${step} checkpoints.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nPRINTING E2E FAIL:", e);
    process.exit(1);
  });
