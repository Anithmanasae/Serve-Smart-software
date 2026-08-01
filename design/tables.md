# Screen: Tables (Floor View) — `features/tables`

Route: `/tables` · Roles: admin, waiter, cashier · Tab: **Tables**

_No mockup provided; spec derived from the scope. Match SADA styling._

## Layout

1. **Header** + **Title** `Tables` / "Manage your floor".
2. **Status legend / filter:** All · Available · Occupied · Billed.
3. **Table grid** (2–3 cols) of **table cards**:
   - Table label/number, capacity (seats icon).
   - Color-coded by status:
     - **Available** → green tint (`--color-primary-soft`, green text).
     - **Occupied** → white/neutral with amber accent; show running total +
       elapsed time.
     - **Billed** → gray/blue accent ("bill requested").
   - Merged secondary tables show a link badge to their primary.

## Actions (from scope)

- **Open table** → creates an open order and navigates to `/order/:tableId`.
- **Merge tables** → pick 2+ tables; secondaries get `mergedInto = primaryId`,
  their orders roll into the primary.
- **Split table** → move selected order lines to a new order/table.
- **Shift table** → reassign an order's `tableId` to another free table.

## Behavior

- Fully real-time: subscribe to `tables` (and their current orders) so status
  colors update instantly when a KOT is sent, a bill is requested, or a table
  is closed after payment.

## Data

- Reads: `paths.tables()`, `paths.orders()` (open).
- Writes: `paths.table(id)`, `paths.order(id)`.
