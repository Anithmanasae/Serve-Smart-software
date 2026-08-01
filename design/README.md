# SADA POS — Design Specs

These specs are the source of truth for each screen's layout, derived from the
approved mockups. Subagents build to these (the original images are not in the
repo). All specs share the theme in `src/styles/theme.css`.

## Global shell

- **Header:** left = logo dot + "SADA POS" wordmark (green). Right = bell icon
  (notifications) or, on cashier screens, the signed-in user's name + role +
  avatar (e.g. "Alex Mercer / Head Admin").
- **Bottom tab bar:** fixed, white, top border. Icon + label per tab. Active
  tab: green icon/label on `--color-primary-soft` pill.
  - Staff variant: **Home · Menu · KDS · Insights**
  - Cashier variant: **Tables · Bills · Sales · Items · More**
- **Canvas:** `--color-bg`; content in white cards with `--shadow-card`.

## Screens

- `menu-order.md` — waiter New Order + current order / Send KOT
- `kitchen-display.md` — KDS live tickets
- `bills.md` — cashier bill summary, payment, receipt
- `insights.md` — reports / analytics dashboard
- `tables.md` — table floor view (no mockup; spec from scope)
