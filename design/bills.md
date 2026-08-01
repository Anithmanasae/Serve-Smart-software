# Screen: Bills (Cashier) — `features/cashier`

Route: `/bills` · Roles: admin, cashier · Tab: **Bills**

## List view

Cashier lands on a list of bills with `status: "requested"` (waiter asked for
the bill) plus in-progress `finalized` bills. Each row: table label, order
total, time requested. Tapping opens the bill detail below.

## Bill detail (from mockup)

Header shows cashier identity (name + role + avatar), e.g. "Alex Mercer /
Head Admin".

1. **Summary & Modifiers card:**
   - `Subtotal` … `formatMoney(subtotal)`
   - `Discount (X%)` … `−formatMoney(discountAmount)` in green. Tapping opens a
     discount input (percent). Discounts above a threshold require admin (rules
     allow only admin/cashier to update; enforce the admin-approval threshold
     in UI + keep rule guard).
   - `GST (5%)` … `formatMoney(gstTotal)`  (2.5% CGST + 2.5% SGST)
   - Divider, then **`Grand Total`** bold … `formatMoney(grandTotal)` in green.
   - All values from `computeBill` — never computed inline.
2. **Payment Method card:** three selectable tiles — **Cash** (💵), **UPI/QR**
   (QR icon), **Card** (💳). Selected tile has green border + tint. Maps to
   `Bill.paymentMode`.
3. **Send Receipt card:** tiles — **Thermal Printer** (🖨) and **WhatsApp** (💬).
   Thermal → print + increment `printedCount`. (Print integration is Phase 5;
   stub the click for now.)
4. **Settle button** (primary green): finalizes payment → sets
   `status: "paid"`, `paidAt`, `cashierId`, then closes the table
   (`status: "available"`, `currentOrderId: null`) and marks the order
   `closed`. Also updates today's `dailySummary`.

## Behavior & rules

- Waiter can only create a bill as `requested`; cashier/admin finalize + pay.
- A **paid** bill is immutable (enforced in `firestore.rules`).
- **Reprint** allowed after paid (only `printedCount` may change).
- On settle, increment `dailySummaries/{today}` revenue, order count,
  payment-mode + source breakdowns, and item sales.

## Data

- Reads: `paths.bills()` (requested/finalized), `paths.order(id)`.
- Writes: `paths.bill(id)`, `paths.table(id)`, `paths.order(id)`,
  `paths.dailySummary(today)`.
