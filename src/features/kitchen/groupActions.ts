/**
 * Group-level KDS actions, shared by the board card and the detail sheet.
 *
 * Each action targets only the tickets it can sensibly move: Start → `new`
 * tickets, Ready → `new`/`preparing`, Completed → everything still active.
 * On an already-completed group, Start/Ready re-open the ticket back onto the
 * live board. All writes go through the ported `kdsApi` helpers.
 */
import { completeKot, markReady, startKot } from "./kdsApi";
import type { TableGroup } from "./groupKots";

export function startGroup(group: TableGroup): Promise<unknown> {
  const targets = group.completed
    ? group.tickets
    : group.tickets.filter((t) => t.status === "new");
  return Promise.all(targets.map((t) => startKot(t.id)));
}

export function readyGroup(group: TableGroup): Promise<unknown> {
  const targets = group.completed
    ? group.tickets
    : group.tickets.filter(
        (t) => t.status === "new" || t.status === "preparing"
      );
  return Promise.all(targets.map((t) => markReady(t.id)));
}

export function completeGroup(group: TableGroup): Promise<unknown> {
  const targets = group.tickets.filter((t) => t.status !== "completed");
  return Promise.all(targets.map((t) => completeKot(t.id)));
}
