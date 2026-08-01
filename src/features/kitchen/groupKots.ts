/**
 * KDS grouping: each "Send KOT" mints a separate `kots` doc, so one table can
 * have several active tickets at once. The board shows ONE card per table —
 * these helpers fold a flat (createdAt-ascending) kot list into per-table
 * groups where `tickets[0]` is the first round and the rest are additional
 * rounds fired later.
 */
import type { Kot } from "@/types/models";

export type LiveKot = Kot & { id: string };

export interface TableGroup {
  /** tableId for dine-in; falls back to the order id for takeaway/delivery. */
  key: string;
  tableLabel: string;
  /** createdAt ascending — `tickets[0]` is the table's first active round. */
  tickets: LiveKot[];
  completed: boolean;
}

/** Fold active kots (already createdAt asc) into one group per table, FIFO. */
export function groupActiveKots(kots: LiveKot[]): TableGroup[] {
  const map = new Map<string, TableGroup>();
  for (const k of kots) {
    const key = k.tableId ?? `order:${k.orderId}`;
    const existing = map.get(key);
    if (existing) {
      existing.tickets.push(k);
    } else {
      map.set(key, {
        key,
        tableLabel: k.tableLabel,
        tickets: [k],
        completed: false,
      });
    }
  }
  // Map preserves insertion order = oldest first ticket first (FIFO).
  return [...map.values()];
}

/**
 * Completed tab: one card per completed ticket, newest first. Tickets are NOT
 * merged per table here — two seatings at the same table stay separate.
 */
export function completedGroups(kots: LiveKot[]): TableGroup[] {
  const out: TableGroup[] = [];
  for (let i = kots.length - 1; i >= 0; i--) {
    const k = kots[i];
    out.push({ key: k.id, tableLabel: k.tableLabel, tickets: [k], completed: true });
  }
  return out;
}

/** A table with 2+ active tickets has an "additional" round in play. */
export function hasAdditionalRound(group: TableGroup): boolean {
  return !group.completed && group.tickets.length > 1;
}

/** Item count (qty, non-voided) across every additional round — the "+N". */
export function additionalItemCount(group: TableGroup): number {
  let n = 0;
  for (let i = 1; i < group.tickets.length; i++) {
    for (const item of group.tickets[i].items) {
      if (!item.voided) n += item.qty;
    }
  }
  return n;
}
