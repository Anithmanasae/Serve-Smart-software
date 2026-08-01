# Screen: Insights / Reports — `features/reports`

Route: `/insights` · Roles: admin, cashier · Tab: **Insights**

## Layout (from mockup)

1. **Title:** `Insights` + subtitle "Analyze your restaurant's performance."
2. **Segmented control:** `Analytics` | `Reports` (Analytics active/white).
3. **Date range dropdown:** "This Week" with calendar icon (options: Today,
   This Week, This Month, custom). Drives all data below.
4. **KPI cards (2×2 grid):**
   - **Total Revenue** — big `formatMoney`, green delta pill ("↗ 12.5%").
   - **Orders** — count, delta.
   - **Avg Order Value** — `formatMoney`, delta ("→ 0.0%").
   - **Voided Items** — count, red delta ("↘ −2.1%").
   Deltas compare to the previous equivalent period.
5. **Revenue Over Time card:** area/line chart, x-axis = days (Mon…Sun),
   "..." menu. Green line + soft green fill.
6. **Top Selling Items card:** header "Top Selling Items" + "View All" (green).
   Table: item icon + name (left), **QTY** (right). Ranked desc by qty.
7. **Revenue by Source card:** rows for Dine-In / Takeout / Delivery (3rd
   Party) with a leading icon and `formatMoney` revenue on the right.

## Data

- Read from `dailySummaries` across the selected range and aggregate client-side
  (totals, item sales, source split, payment summary). This keeps reports cheap
  regardless of order volume.
- **Reports** tab: Today's sales, Daily report, Monthly report, Item-wise
  sales, Best-selling items, Payment summary — all derived from the same
  `dailySummaries` aggregation.

## Notes

- A tiny dependency-free SVG line chart is fine for "Revenue Over Time"; avoid
  heavy chart libs unless justified.
- All money via `formatMoney`.
