/**
 * Date helpers. `dayKey` is the id used for `dailySummaries/{yyyy-mm-dd}`,
 * computed for the restaurant's local business day (IST, UTC+5:30).
 *
 * We compute the IST offset manually rather than via Intl/toLocaleString so it
 * works reliably under Hermes (React Native), which has limited timezone data.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function dayKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Start of the current IST business day, as a real Date (for range queries). */
export function startOfDayIST(d: Date = new Date()): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** Milliseconds elapsed since a Firestore-style Timestamp, given "now". */
export function elapsedMs(
  createdAt: { toDate(): Date } | null | undefined,
  now: number
): number {
  if (!createdAt) return 0;
  return Math.max(0, now - createdAt.toDate().getTime());
}

/** Coarse "time since" label: "just now" / "28m ago" / "1h 5m ago". */
export function agoLabel(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

/** Compact duration label: "just now" / "5m" / "1h 20m". */
export function shortElapsedLabel(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Live ticket timer: "45s" / "12m 30s" / "1h 20m". Ticks every second. */
export function timerLabel(ms: number): string {
  const totalS = Math.floor(ms / 1000);
  if (totalS < 60) return `${totalS}s`;
  const mins = Math.floor(totalS / 60);
  if (mins < 60) return `${mins}m ${totalS % 60}s`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Calendar date like "02-07-2026" (dd-mm-yyyy) in IST — receipt format. */
export function formatDateIST(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${m}-${ist.getUTCFullYear()}`;
}

/** Clock time like "10:04 AM" in IST (manual offset — see note above). */
export function formatTimeIST(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h24 = ist.getUTCHours();
  const m = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m} ${ampm}`;
}
