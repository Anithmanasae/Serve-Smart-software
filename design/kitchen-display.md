# Screen: Kitchen Display (KDS) — `features/kitchen`

Route: `/kds` · Roles: admin, kitchen · Tab: **KDS**

Redesigned (Jul 2026): per-table cards with a red/orange/green status system.

## Layout

1. **Header:** "SADA POS" + "KITCHEN" tag.
2. **Status tabs** (three, equal width, live counts, color-coded):
   - **ORDERS (red)** — tables with an active ticket (`new`/`preparing`/`ready`).
   - **ADDITIONAL (orange)** — tables with a 2nd+ active ticket (a later
     "additional" round sent after an earlier one).
   - **COMPLETED (green)** — today's `completed` tickets, newest first (one
     card per ticket).
3. **Grid:** 3 columns × 3 rows sized to fill the screen exactly (9 cards
   visible); the list scrolls to reveal more tables. Cards are **one per
   table**, grouping all of that table's active tickets (`groupKots.ts`).
4. **Card:** colored left border + status dot (red = active, orange = has an
   additional round, green = completed), table label, time received (IST) +
   "Xm ago" elapsed, a **+N** badge counting additional-round items, up to 3
   item lines (`qty × name`, later rounds get an orange dot) with "+N more…",
   and three always-visible actions:
   - **Start** → `startKot` on the group's `new` tickets (highlighted amber
     when actionable).
   - **Ready** → `markReady` on `new`/`preparing` tickets (highlighted green).
   - **Completed** → `completeKot` on every active ticket; the card leaves
     Orders/Additional and appears under Completed via the live queries.

5. **Detail popup** (`TicketDetailSheet`): tapping a card opens a bottom sheet
   with the full picture — table + order type + total items, then one section
   per round (First round / Additional round N · `#ticketNumber` · status
   pill · fire time · elapsed · Reprint) with the complete item list including
   notes and voided lines, and the same Start / Ready / Completed actions.
   It resolves the group live, so completing from the sheet closes it as the
   card moves tabs.

## Behavior

- Fully real-time: active board subscribes to `kots` where
  `status in [new, preparing, ready]` ordered by `createdAt` asc; Completed
  subscribes to `status == completed && createdAt >= start of IST day`.
- Elapsed derived from the first round's `createdAt` via `useNow()`.
- Kitchen may ONLY change `status`/`printedCount` (enforced by rules).
- **Waiter notification:** waiter screens (order + tables) already hold live
  kot subscriptions; `features/order/kotAlerts.tsx` detects status
  transitions and flashes a banner ("T1 — Order READY"). TODO: push
  notifications for backgrounded phones (expo-notifications + tokens).

## Data

- Reads: `paths.kots()` (two live queries, above).
- Writes: `paths.kot(id)` — `status`, `printedCount` only (via `kdsApi`).
