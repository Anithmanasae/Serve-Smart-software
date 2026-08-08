/**
 * The offer pricing engine — the single implementation of "what discount does
 * this order get?".
 *
 * PURE AND DETERMINISTIC. It takes order lines, the restaurant's offers and a
 * moment in time, and returns the same lines with a discount stamped on each.
 * No Firestore, no clock of its own, no randomness — given the same three
 * inputs it always produces the same output, which is what lets the waiter's
 * screen and the bill agree without talking to each other.
 *
 * Two invariants everything else depends on:
 *
 *   1. A line's `price` and `qty` are NEVER touched. A BOGO line stays 2 units
 *      at full price with one unit's worth in `offerDiscount`. The kitchen
 *      reads `qty` and sends two coffees; the reports read `price * qty` and
 *      see the real menu value; only the money owed changes.
 *   2. `offerName` is COPIED onto the line, not referenced. Deleting an offer
 *      tomorrow cannot rewrite a bill printed today.
 *
 * All money is integer paise. Nothing here produces a fraction.
 */
import { dayKey, istDayOfWeek, istMinutesOfDay } from "@/lib/date";
import type { Offer } from "@/types/models";

/** The minimum a line must expose to be priced. The three offer fields are
 *  outputs, but they are read back too — a re-run has to be able to clear a
 *  stamp left by an offer that has since stopped applying. */
export interface PricableLine {
  lineId: string;
  menuItemId: string;
  categoryId?: string;
  price: number;
  qty: number;
  voided?: boolean;
  offerId?: string;
  offerName?: string;
  offerDiscount?: number;
}

/** What one offer awards one line. */
interface Award {
  offerId: string;
  offerName: string;
  discount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule & scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this offer running at `at`? Every schedule field is optional and ABSENT
 * MEANS UNRESTRICTED — a promo the owner never limited runs always, rather
 * than silently never running.
 */
export function isOfferLive(offer: Offer, at: Date): boolean {
  if (!offer.enabled) return false;

  // Campaign window. dayKey() is yyyy-mm-dd, so string comparison IS date
  // comparison — and it stays in IST business days like the rest of the app.
  const today = dayKey(at);
  if (offer.startsOn && today < offer.startsOn) return false;
  if (offer.endsOn && today > offer.endsOn) return false;

  // "Monday Madness" lives here: a day list, not an offer kind.
  if (offer.days && offer.days.length > 0) {
    if (!offer.days.includes(istDayOfWeek(at))) return false;
  }

  // Happy-hour window. Needs both bounds to mean anything.
  const { startMinutes: from, endMinutes: to } = offer;
  if (from !== undefined && to !== undefined && from !== to) {
    const now = istMinutesOfDay(at);
    const inWindow =
      from < to
        ? now >= from && now < to
        : // Wraps midnight (22:00–02:00): inside if past the start OR before
          // the end, which is the union of the two halves rather than the
          // intersection an unwrapped comparison would give.
          now >= from || now < to;
    if (!inWindow) return false;
  }

  return true;
}

/**
 * Does this offer cover this line's product?
 *
 * No items AND no categories = the whole menu. Listing categories is the
 * durable choice: a dessert added next month joins "20% off Desserts" on its
 * own, where an item list would silently leave it out.
 */
export function offerCoversLine(offer: Offer, line: PricableLine): boolean {
  const byItem = offer.itemIds ?? [];
  const byCategory = offer.categoryIds ?? [];
  if (byItem.length === 0 && byCategory.length === 0) return true;
  if (byItem.includes(line.menuItemId)) return true;
  if (line.categoryId && byCategory.includes(line.categoryId)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split an integer `total` across `weights` so the parts sum EXACTLY to it.
 *
 * Needed because a discount is decided for a group of lines (three coffees
 * across two lines earn one free) but has to be stored per line. Proportional
 * shares are floored, then the leftover paise are handed out one at a time —
 * without that pass the parts would sum to less than the total and the bill's
 * own arithmetic would stop adding up.
 */
function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);

  const out = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % out.length) {
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/** One purchasable unit, tagged with the line it came from. Offers that count
 *  ("buy 2 get 1") reason in units, not lines — three coffees earn a free one
 *  whether they were added as one line of 3 or three lines of 1. */
interface Unit {
  lineId: string;
  price: number;
}

function unitsOf(lines: PricableLine[]): Unit[] {
  const units: Unit[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.qty; i++) units.push({ lineId: l.lineId, price: l.price });
  }
  return units;
}

/** Fold a per-unit discount list back into a per-line map. */
function foldUnits(units: Unit[], amounts: number[]): Map<string, number> {
  const map = new Map<string, number>();
  units.forEach((u, i) => {
    const add = amounts[i] ?? 0;
    if (add > 0) map.set(u.lineId, (map.get(u.lineId) ?? 0) + add);
  });
  return map;
}

/** How many times an offer may fire on one order. */
function capSets(sets: number, offer: Offer): number {
  const cap = offer.maxPerOrder;
  if (cap === undefined || cap <= 0) return sets;
  return Math.min(sets, cap);
}

// ─────────────────────────────────────────────────────────────────────────────
// The four discount kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What one offer would award each of the lines it covers, as
 * lineId -> paise. The pool is every covered line at once, so quantity-based
 * offers count across the whole order rather than line by line.
 */
function awardsFor(offer: Offer, pool: PricableLine[]): Map<string, number> {
  switch (offer.kind) {
    case "percent": {
      const pct = Math.min(Math.max(offer.percentOff ?? 0, 0), 100);
      if (pct === 0) return new Map();
      // Rounded per LINE, not per unit: rounding each unit then summing drifts
      // away from the figure the customer would get by taking the percentage
      // off the line total they can see.
      const map = new Map<string, number>();
      for (const l of pool) {
        const d = Math.round((l.price * l.qty * pct) / 100);
        if (d > 0) map.set(l.lineId, d);
      }
      return map;
    }

    case "flat": {
      const off = Math.max(offer.amountOff ?? 0, 0);
      if (off === 0) return new Map();
      const map = new Map<string, number>();
      for (const l of pool) {
        // Capped at the unit price — ₹50 off a ₹30 item is free, not -₹20.
        const d = Math.min(off, l.price) * l.qty;
        if (d > 0) map.set(l.lineId, d);
      }
      return map;
    }

    case "bogo": {
      const buy = Math.max(offer.buyQty ?? 1, 1);
      const free = Math.max(offer.freeQty ?? 1, 1);
      const units = unitsOf(pool);
      const sets = capSets(Math.floor(units.length / (buy + free)), offer);
      const freeUnits = sets * free;
      if (freeUnits <= 0) return new Map();

      // CHEAPEST units go free — the industry-standard reading of "buy one get
      // one free", and the one a customer mixing a ₹400 and a ₹100 dessert
      // expects. Sorting a copy keeps `units` aligned with nothing else.
      const order = units
        .map((u, i) => i)
        .sort((a, b) => units[a].price - units[b].price);

      const amounts = new Array<number>(units.length).fill(0);
      for (let i = 0; i < freeUnits && i < order.length; i++) {
        amounts[order[i]] = units[order[i]].price;
      }
      return foldUnits(units, amounts);
    }

    case "bundle": {
      const n = Math.max(offer.bundleQty ?? 1, 1);
      const comboPrice = Math.max(offer.bundlePrice ?? 0, 0);
      const units = unitsOf(pool);
      const sets = capSets(Math.floor(units.length / n), offer);
      if (sets <= 0) return new Map();

      // Most EXPENSIVE units fill the combo first, which maximises what the
      // customer saves. The opposite of BOGO's rule on purpose: there the
      // giveaway is a free unit and convention is to give the cheapest; here
      // the owner has named a price for a set and the guest should get the
      // best set they paid for.
      const order = units
        .map((_, i) => i)
        .sort((a, b) => units[b].price - units[a].price);

      const amounts = new Array<number>(units.length).fill(0);
      for (let s = 0; s < sets; s++) {
        const chunk = order.slice(s * n, s * n + n);
        if (chunk.length < n) break;
        const full = chunk.reduce((sum, i) => sum + units[i].price, 0);
        // Never negative: a combo priced above the à la carte total is a bad
        // deal, not a surcharge — it simply awards nothing.
        const saving = Math.max(0, full - comboPrice);
        if (saving === 0) continue;
        const parts = allocate(
          saving,
          chunk.map((i) => units[i].price)
        );
        chunk.forEach((i, k) => {
          amounts[i] += parts[k];
        });
      }
      return foldUnits(units, amounts);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Price a set of order lines against the restaurant's offers.
 *
 * Returns the SAME lines with `offerId` / `offerName` / `offerDiscount` set,
 * or cleared where no offer applies — so re-running it after an offer is
 * switched off correctly removes the discount rather than leaving it stuck.
 *
 * WHEN SEVERAL OFFERS COVER ONE LINE the line takes the single best one:
 * largest discount, tie-broken by `priority` then id so the result never
 * depends on document order. Offers do not stack — two promos silently
 * compounding on one dish is how a restaurant sells at a loss without
 * noticing.
 *
 * Each offer is costed against every line it covers, INDEPENDENTLY of what
 * other offers might claim. Perfect assignment (which offer should take which
 * unit to maximise the customer's total saving) is a knapsack problem, and not
 * worth solving for a menu where two offers rarely overlap; the approximation
 * always awards a real, explainable discount, never an inflated one.
 */
export function applyOffers<T extends PricableLine>(
  lines: T[],
  offers: Offer[],
  at: Date = new Date()
): T[] {
  const live = offers.filter((o) => isOfferLive(o, at));

  // Best award per line, so far.
  const best = new Map<string, Award & { priority: number }>();

  if (live.length > 0) {
    for (const offer of live) {
      const pool = lines.filter(
        (l) => !l.voided && l.qty > 0 && offerCoversLine(offer, l)
      );
      if (pool.length === 0) continue;

      for (const [lineId, raw] of awardsFor(offer, pool)) {
        const line = pool.find((l) => l.lineId === lineId);
        if (!line) continue;
        // An offer can make a line free, never worth less than nothing.
        const discount = Math.min(Math.max(raw, 0), line.price * line.qty);
        if (discount <= 0) continue;

        const current = best.get(lineId);
        const wins =
          !current ||
          discount > current.discount ||
          (discount === current.discount &&
            (offer.priority > current.priority ||
              (offer.priority === current.priority &&
                offer.id < current.offerId)));
        if (wins) {
          best.set(lineId, {
            offerId: offer.id,
            offerName: offer.name,
            discount,
            priority: offer.priority,
          });
        }
      }
    }
  }

  return lines.map((line) => {
    const award = best.get(line.lineId);
    if (!award) {
      // Nothing applies. Strip any stale stamp rather than leaving a discount
      // from an offer that has since been switched off or has expired.
      if (
        line.offerId === undefined &&
        line.offerName === undefined &&
        line.offerDiscount === undefined
      ) {
        return line;
      }
      // Firestore rejects `undefined`, so the keys are removed outright rather
      // than blanked — an order line simply carries no offer fields.
      const stripped = { ...line };
      delete stripped.offerId;
      delete stripped.offerName;
      delete stripped.offerDiscount;
      return stripped;
    }
    return {
      ...line,
      offerId: award.offerId,
      offerName: award.offerName,
      offerDiscount: award.discount,
    };
  });
}

/** Σ of the offer discounts on a line-set (paise) — the order/bill field. */
export function totalOfferDiscount(lines: PricableLine[]): number {
  return lines
    .filter((l) => !l.voided)
    .reduce((sum, l) => sum + Math.max(0, l.offerDiscount ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────────────

/** "Buy 1 Get 1 Free" / "30% off" — the offer's terms in one short phrase. */
export function describeOffer(offer: Offer, formatMoney: (p: number) => string): string {
  switch (offer.kind) {
    case "percent":
      return `${offer.percentOff ?? 0}% off`;
    case "flat":
      return `${formatMoney(offer.amountOff ?? 0)} off each`;
    case "bogo": {
      const buy = Math.max(offer.buyQty ?? 1, 1);
      const free = Math.max(offer.freeQty ?? 1, 1);
      return `Buy ${buy} Get ${free} Free`;
    }
    case "bundle":
      return `${Math.max(offer.bundleQty ?? 1, 1)} for ${formatMoney(
        offer.bundlePrice ?? 0
      )}`;
  }
}
