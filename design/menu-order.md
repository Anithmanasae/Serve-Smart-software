# Screen: New Order (Waiter) — `features/order`

Route: `/order/:tableId?`  · Roles: admin, waiter · Tab: **Menu**

## Layout (top → bottom)

1. **Header:** "SADA POS" + bell.
2. **Title block:** `New Order` (large bold) + subtitle "Manage and organize
   your offerings."
3. **Search bar:** rounded, full-width, magnifier icon, placeholder
   "Search menu items, SKUs, or ingredients…". Filters the item grid live.
4. **Category chips:** horizontal scroll. First chip "All Items" (active =
   black/dark pill), then category names ("Main Course", "Appetizers", …)
   as outlined pills. Sourced from `menuCategories` (enabled, by sortOrder).
5. **Item grid:** 2 columns. Each **item card**:
   - Square image top (rounded). If no image, gray placeholder with image icon.
   - Name (truncate 1 line), price in green via `formatMoney`.
   - Bottom-right circular **`+`** button to add.
   - When an item is in the order, the card is **highlighted with a green
     border** and shows an inline **stepper** (`−  qty  +`) instead of `+`.
6. **Current Order sheet** (bottom, appears once items added):
   - Header row: cart icon + "Current Order" (left), "＋ Add Items" (right,
     green) which collapses the sheet back to the grid to add more.
   - Line items: name (bold), unit price + `×qty`, an "✎ Edit Item" link, and a
     **Special instructions** text field per line (placeholder "Special
     instructions (e.g., extra ice, no garnish…)"). Maps to `OrderItem.notes`.
   - Footer: full-width green **"➤ Send KOT"** button + a boxed running total
     on the right (`formatMoney(subtotal)`).
7. **Collapsed cart bar** (when sheet minimized): green full-width bar
   "🛍 View Order · N Item · ₹total".

## Behavior

- Adding an item creates/updates the open `Order` for this table (or a new
  takeaway order when no tableId). New lines start `kotStatus: "pending"`.
- Stepper changes `qty`; qty 0 removes the line.
- **Send KOT** batches all `pending` lines into a new `Kot` (status `new`),
  flips those lines to `kotStatus: "sent"`, and assigns their `kotId`.
- "Add Items" later appends new `pending` lines to the same order; a second
  Send KOT creates a second ticket with only the new items.
- Subtotal recomputed on every change via `computeBill`.
- On order create, set the table `status: "occupied"` and `currentOrderId`.

## Data

- Reads: `paths.menuItems()`, `paths.menuCategories()`, current `paths.order(id)`.
- Writes: `paths.order(id)` (items/subtotal), `paths.kot(id)` (new ticket),
  `paths.table(id)` (occupancy).
