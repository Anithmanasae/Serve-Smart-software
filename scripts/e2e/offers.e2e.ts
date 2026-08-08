/**
 * OFFERS SUITE — the proof that a configured discount reaches the bill with
 * the right number on it, that the reports can still tell revenue from
 * giveaway, and that nobody can use the new field to knock money off a total
 * by hand. Drives the REAL app modules (offersApi, orderApi, cashierApi,
 * lib/offers, lib/money) against the security rules.
 *
 * Run against the LOCAL EMULATORS (no live data touched):
 *   firebase emulators:start --only auth,firestore --project demo-sada-isolation
 *   E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/offers.e2e.ts
 *
 * The model under test:
 *   - An offer is a RULE the owner saves. The engine (src/lib/offers.ts) prices
 *     it onto each order line as a SNAPSHOT: name + paise, alongside a `price`
 *     that stays the full menu price.
 *   - `Bill.subtotal` is GROSS. `offerDiscount` is what came off it, and the
 *     tax is worked out on the difference.
 *   - MANUAL bill discounts remain banned outright. That distinction is the
 *     whole security story: the owner may discount in advance, the till may not
 *     discount on the spot.
 *
 * What it proves:
 *   1. A percent offer reaches the bill, and the GST is charged on the
 *      discounted amount, not the full one.
 *   2. BOGO counts units across the whole order and gives the CHEAPEST free.
 *   3. A combo price bills the set at the price the owner named.
 *   4. A scheduled offer that is not running today applies nothing.
 *   5. The line keeps its real price and quantity — the kitchen still gets the
 *      food that was given away.
 *   6. Deleting an offer leaves an already-billed order untouched.
 *   7. The daily summary separates revenue from what the offers cost.
 *   8. Cancelling a bill reverses the offer cost with the sale.
 *   9. The rules reject a manual discount, an offer discount larger than the
 *      subtotal, a negative one, and a waiter writing an offer.
 */
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth } from "./firebase-shim";
import {
  getActiveRestaurantIdOrNull,
  paths,
  setActiveRestaurantId,
} from "@/lib/firestore/paths";
import { joinRestaurant, registerRestaurant } from "@/features/auth/signupApi";
import { approveStaff } from "@/features/staff/staffApi";
import {
  createOrderLocal,
  mergeItemIntoLines,
  sendKot,
  writeOrderItems,
} from "@/features/order/orderApi";
import {
  generateBill,
  settleBill,
  voidBill,
} from "@/features/cashier/cashierApi";
import { createOffer, deleteOffer } from "@/features/offers/offersApi";
import { applyOffers, isOfferLive, type PricableLine } from "@/lib/offers";
import { istDayOfWeek, dayKey } from "@/lib/date";
import type { Bill, DailySummary, Offer, Order } from "@/types/models";

if (process.env.E2E_EMULATOR !== "1") {
  console.error(
    "Refusing to run: this suite registers a throwaway restaurant and must " +
      "run against the emulators. Set E2E_EMULATOR=1 (see file header).",
  );
  process.exit(1);
}

const PASSWORD = "Offers@1234";
const stamp = Date.now().toString(36);
const OWNER = `owner-offer-${stamp}@sada-pos.test`;
const WAITER = `waiter-offer-${stamp}@sada-pos.test`;

const COFFEE = { id: "coffee", name: "Cappuccino", price: 15000 }; // ₹150
const CHEAP = { id: "filter", name: "Filter Coffee", price: 6000 }; // ₹60
const CAT_DRINKS = "cat-drinks";

let step = 0;
function ok(msg: string) {
  step += 1;
  console.log(`  ✔ [${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function eq(actual: number, expected: number, what: string) {
  assert(actual === expected, `${what}: expected ${expected}, got ${actual}`);
}

/** Run an op the rules must REJECT with permission-denied. */
async function expectDenied(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    assert(
      code === "permission-denied",
      `${what}: expected permission-denied, got "${code}": ${e}`,
    );
    return;
  }
  throw new Error(`${what}: unexpectedly SUCCEEDED`);
}

/** Build an order of the given units, priced against `offers`, then bill it. */
async function billOrder(
  uid: string,
  units: Array<{ id: string; name: string; price: number; qty: number }>,
  offers: Offer[],
): Promise<{ bill: Bill; order: Order }> {
  const first = units[0];
  const created = createOrderLocal({
    tableId: null,
    orderType: "takeaway",
    waiterId: uid,
    menuItemId: first.id,
    name: first.name,
    price: first.price,
    categoryId: CAT_DRINKS,
    offers,
  });
  await created.commit;

  // Add the remaining units one tap at a time, exactly as the waiter would —
  // so the quantity-based offers are exercised through the real merge path.
  let items = created.items;
  const ctx = { offers, at: new Date() };
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const start = i === 0 ? 1 : 0;
    for (let n = start; n < u.qty; n++) {
      items = mergeItemIntoLines(items, u.id, u.name, u.price, ctx, CAT_DRINKS);
    }
  }
  await writeOrderItems(created.orderId, items);
  await sendKot(created.orderId, "Takeaway");

  const openSnap = await getDoc(paths.order(created.orderId));
  const billId = await generateBill(
    { ...openSnap.data(), id: openSnap.id } as Order,
    uid,
    "Takeaway",
  );
  const [billSnap, orderSnap] = await Promise.all([
    getDoc(paths.bill(billId)),
    getDoc(paths.order(created.orderId)),
  ]);
  return {
    bill: { ...billSnap.data(), id: billSnap.id } as Bill,
    order: { ...orderSnap.data(), id: orderSnap.id } as Order,
  };
}

async function fetchOffer(id: string): Promise<Offer> {
  const snap = await getDoc(paths.offer(id));
  assert(snap.exists(), `offer ${id} exists`);
  return { ...snap.data(), id: snap.id } as Offer;
}

async function todaySummary(): Promise<DailySummary> {
  const snap = await getDoc(paths.dailySummary(dayKey()));
  assert(snap.exists(), "today's summary exists");
  return { ...snap.data(), id: snap.id } as DailySummary;
}

/** 5% GST on the taxable base, matching computeBill/TAX_CONFIG. */
const withGst = (taxable: number) =>
  taxable + Math.round(taxable * 0.025) * 2;

async function main() {
  await signOut(auth).catch(() => {});
  await registerRestaurant("Offer Cafe", "Owner Offer", OWNER, PASSWORD);
  const ownerUid = auth.currentUser!.uid;
  const rid = getActiveRestaurantIdOrNull()!;
  ok(`restaurant registered (${rid})`);

  // ── 1. PERCENT: tax is charged on the discounted amount ──────────────────
  const pctId = await createOffer({
    name: "Monday Madness",
    kind: "percent",
    enabled: true,
    itemIds: [COFFEE.id],
    categoryIds: [],
    percentOff: 20,
    priority: 0,
  });
  const pctOffer = await fetchOffer(pctId);

  {
    const { bill, order } = await billOrder(
      ownerUid,
      [{ ...COFFEE, qty: 1 }],
      [pctOffer],
    );
    eq(bill.subtotal, 15000, "percent: subtotal stays gross");
    eq(bill.offerDiscount ?? 0, 3000, "percent: 20% of ₹150");
    eq(bill.grandTotal, withGst(12000), "percent: GST charged on ₹120, not ₹150");
    eq(bill.discountPercent, 0, "percent: the manual discount stays zero");
    eq(bill.discountAmount, 0, "percent: the manual discount stays zero");

    const line = order.items[0];
    eq(line.price, 15000, "percent: line keeps the full menu price");
    eq(line.qty, 1, "percent: line keeps its real quantity");
    assert(line.offerName === "Monday Madness", "percent: offer name snapshotted");
    ok("percent offer reaches the bill; GST charged on the discounted amount");
  }

  // ── 2. BOGO: counts across the order, gives the CHEAPEST free ────────────
  const bogoId = await createOffer({
    name: "Coffee BOGO",
    kind: "bogo",
    enabled: true,
    itemIds: [],
    categoryIds: [CAT_DRINKS],
    buyQty: 1,
    freeQty: 1,
    priority: 0,
  });
  const bogoOffer = await fetchOffer(bogoId);

  {
    // One ₹150 and one ₹60, both in the covered category: 2 units = 1 set,
    // and the FREE one must be the ₹60.
    const { bill } = await billOrder(
      ownerUid,
      [
        { ...COFFEE, qty: 1 },
        { ...CHEAP, qty: 1 },
      ],
      [bogoOffer],
    );
    eq(bill.subtotal, 21000, "bogo: subtotal is both coffees at full price");
    eq(bill.offerDiscount ?? 0, 6000, "bogo: the CHEAPEST unit is the free one");
    eq(bill.grandTotal, withGst(15000), "bogo: pays for the ₹150 only");
    ok("BOGO counts units across the order and gives the cheapest free");
  }

  {
    // Three units, buy-1-get-1: floor(3/2) = 1 set, so exactly ONE free — a
    // spare unit must not round up into a second giveaway.
    const { bill, order } = await billOrder(
      ownerUid,
      [{ ...COFFEE, qty: 3 }],
      [bogoOffer],
    );
    eq(bill.subtotal, 45000, "bogo: three coffees gross");
    eq(bill.offerDiscount ?? 0, 15000, "bogo: exactly one free, not one and a half");
    const totalQty = order.items.reduce((n, l) => n + l.qty, 0);
    eq(totalQty, 3, "bogo: the kitchen still gets all three coffees");
    ok("an odd unit does not round up into a second free item");
  }

  // ── 3. BUNDLE: the set bills at the price the owner named ────────────────
  const comboId = await createOffer({
    name: "Couple Coffee",
    kind: "bundle",
    enabled: true,
    itemIds: [COFFEE.id],
    categoryIds: [],
    bundleQty: 2,
    bundlePrice: 19900,
    priority: 0,
  });
  const comboOffer = await fetchOffer(comboId);

  {
    const { bill } = await billOrder(
      ownerUid,
      [{ ...COFFEE, qty: 2 }],
      [comboOffer],
    );
    eq(bill.subtotal, 30000, "combo: two coffees gross");
    eq(bill.offerDiscount ?? 0, 10100, "combo: ₹300 down to the ₹199 set price");
    eq(bill.grandTotal, withGst(19900), "combo: bills the named price + GST");
    ok("a combo price bills the set at exactly the price the owner named");
  }

  // ── 4. SCHEDULE: an offer that is not running today applies nothing ──────
  {
    // Pin the day list to the two days that are NOT today, so the offer is
    // configured, enabled, and still correctly dormant.
    const today = istDayOfWeek(new Date());
    const otherDays = [(today + 2) % 7, (today + 3) % 7];
    const schedId = await createOffer({
      name: "Not Today",
      kind: "percent",
      enabled: true,
      itemIds: [COFFEE.id],
      categoryIds: [],
      percentOff: 50,
      days: otherDays,
      priority: 0,
    });
    const schedOffer = await fetchOffer(schedId);
    assert(
      !isOfferLive(schedOffer, new Date()),
      "a day-scoped offer is dormant outside its days",
    );

    const { bill } = await billOrder(
      ownerUid,
      [{ ...COFFEE, qty: 1 }],
      [schedOffer],
    );
    eq(bill.offerDiscount ?? 0, 0, "scheduled: nothing comes off on the wrong day");
    eq(bill.grandTotal, withGst(15000), "scheduled: full price charged");
    ok("an enabled offer outside its schedule discounts nothing");
  }

  // ── 5. DELETION does not reach back into a billed order ─────────────────
  const settledForDelete = await billOrder(
    ownerUid,
    [{ ...COFFEE, qty: 1 }],
    [pctOffer],
  );
  await settleBill(settledForDelete.bill, settledForDelete.order, {
    kind: "paid",
    mode: "cash",
  });
  await deleteOffer(pctId);
  {
    const snap = await getDoc(paths.bill(settledForDelete.bill.id));
    const after = snap.data() as Bill;
    eq(after.offerDiscount ?? 0, 3000, "deleted offer: the bill keeps its discount");
    const orderSnap = await getDoc(paths.order(settledForDelete.order.id));
    const line = (orderSnap.data() as Order).items[0];
    assert(
      line.offerName === "Monday Madness",
      "deleted offer: the line keeps the snapshotted name",
    );
    ok("deleting an offer leaves an already-billed order untouched");
  }

  // ── 6. The day's report separates revenue from what the offers cost ─────
  {
    const summary = await todaySummary();
    eq(
      summary.offerDiscount ?? 0,
      3000,
      "summary: the settled sale's offer cost is tallied",
    );
    const byOffer = summary.byOffer ?? {};
    assert(byOffer[pctId], "summary: the offer has its own line in byOffer");
    eq(byOffer[pctId].amount, 3000, "summary: byOffer amount");
    eq(byOffer[pctId].count, 1, "summary: byOffer count");
    eq(
      summary.totalRevenue,
      withGst(12000),
      "summary: revenue is what was actually taken, already net of the offer",
    );
    // itemSales stays GROSS — it is the menu value of what went out of the
    // kitchen, which is why the offer cost has to be its own figure.
    eq(
      summary.itemSales[COFFEE.id].revenue,
      15000,
      "summary: item sales keep the full menu value",
    );
    ok("the day's report separates revenue from what the offers cost");
  }

  // ── 7. Cancelling reverses the offer cost with the sale ─────────────────
  {
    const before = await todaySummary();
    await voidBill(settledForDelete.bill, ownerUid, "bad-food");
    const after = await todaySummary();
    eq(
      after.offerDiscount ?? 0,
      (before.offerDiscount ?? 0) - 3000,
      "cancel: the offer cost comes back out",
    );
    assert(
      !(after.byOffer ?? {})[pctId],
      "cancel: the offer's only contribution is removed from byOffer",
    );
    ok("cancelling a bill reverses the offer cost along with the sale");
  }

  // ── 8. The rules reject every way of abusing the new field ──────────────
  const probe = await billOrder(ownerUid, [{ ...COFFEE, qty: 1 }], []);

  await expectDenied("a manual bill discount", () =>
    updateDoc(paths.bill(probe.bill.id), {
      discountPercent: 10,
      discountAmount: 1500,
    }),
  );
  await expectDenied("an offer discount larger than the subtotal", () =>
    updateDoc(paths.bill(probe.bill.id), { offerDiscount: 99999 }),
  );
  await expectDenied("a negative offer discount", () =>
    updateDoc(paths.bill(probe.bill.id), { offerDiscount: -500 }),
  );
  ok("rules reject a manual discount, an oversized one and a negative one");

  await expectDenied("an offer with a percentage over 100", () =>
    setDoc(paths.offer("bad-percent"), {
      name: "Free money",
      kind: "percent",
      enabled: true,
      itemIds: [],
      categoryIds: [],
      percentOff: 500,
      priority: 0,
    } as unknown as Offer),
  );
  await expectDenied("an offer with an unknown kind", () =>
    setDoc(paths.offer("bad-kind"), {
      name: "Mystery",
      kind: "freebie",
      enabled: true,
      itemIds: [],
      categoryIds: [],
      priority: 0,
    } as unknown as Offer),
  );
  ok("rules reject a malformed offer (bad percentage, unknown kind)");

  // ── 9. A waiter may read offers but never write one ─────────────────────
  const rootSnap = await getDoc(paths.restaurantProfile());
  const joinCode = (rootSnap.data() as { joinCode: string }).joinCode;

  await joinRestaurant(joinCode, "Waiter Offer", WAITER, PASSWORD, "waiter");
  const waiterUid = auth.currentUser!.uid;
  await signInWithEmailAndPassword(auth, OWNER, PASSWORD);
  setActiveRestaurantId(rid);
  await approveStaff(waiterUid);

  await signInWithEmailAndPassword(auth, WAITER, PASSWORD);
  setActiveRestaurantId(rid);
  {
    // Reading is required — the waiter's order screen prices the cart itself.
    const snap = await getDoc(paths.offer(bogoId));
    assert(snap.exists(), "a waiter can READ offers (needed to price an order)");
    await expectDenied("a waiter creating an offer", () =>
      setDoc(paths.offer("waiter-made"), {
        name: "Free for me",
        kind: "percent",
        enabled: true,
        itemIds: [],
        categoryIds: [],
        percentOff: 100,
        priority: 0,
      } as unknown as Offer),
    );
    await expectDenied("a waiter deleting an offer", () =>
      deleteOffer(bogoId),
    );
    ok("a waiter reads offers to price orders but cannot write or delete one");
  }

  // ── 10. The engine is pure: same inputs, same output ────────────────────
  {
    const lines: PricableLine[] = [
      {
        lineId: "a",
        menuItemId: COFFEE.id,
        categoryId: CAT_DRINKS,
        price: COFFEE.price,
        qty: 2,
      },
    ];
    const at = new Date();
    const once = applyOffers(lines, [comboOffer], at);
    const twice = applyOffers(lines, [comboOffer], at);
    assert(
      JSON.stringify(once) === JSON.stringify(twice),
      "the engine is deterministic for identical inputs",
    );
    // Re-pricing an already-stamped set must not compound the discount.
    const again = applyOffers(once, [comboOffer], at);
    eq(
      again[0].offerDiscount ?? 0,
      once[0].offerDiscount ?? 0,
      "re-pricing a stamped line does not stack a second discount",
    );
    ok("the pricing engine is deterministic and safe to re-run");
  }

  console.log(
    `\nOFFERS E2E PASS — ${step} checkpoints, discounts priced and contained.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nOFFERS E2E FAIL:", e);
    process.exit(1);
  });
