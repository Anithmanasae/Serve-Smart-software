/**
 * ONE description of a tenant's expiry state, shared by activateTenant.js and
 * auditTenants.js.
 *
 * This mirrors `tenantNotExpired()` in firestore.rules. That function now reads
 * exactly ONE field, so this does too:
 *
 *     expiresAt present  → that is the deadline
 *     expiresAt absent   → PERMANENT, never expires
 *
 * THERE IS NO TRIAL. This file used to compute a second, implicit deadline as
 * `trialStartedAt + TRIAL_DAYS`, mirroring a `trialLength()` the rules have
 * since dropped. Keeping that here would be worse than useless: the audit would
 * report a restaurant as "TRIAL — EXPIRED 6d ago" that the server is happily
 * serving, and the natural response to that line is to go and "fix" a customer
 * who was never broken. The drift is the bug, so the fallback is gone.
 *
 * `trialStartedAt` is still REPORTED (as `legacyTrialStartedAt`) because old
 * documents still carry it and it is useful to see which ones — but it never
 * produces a deadline. `scripts/stripLegacyTrials.js` clears it for good.
 *
 * Nothing here enforces anything. The server does that.
 */

/** Firestore Timestamp | Date | undefined → Date | null */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "1d 4h left" | "EXPIRED 3h ago" */
function describeRemaining(ms) {
  if (ms <= 0) {
    const hours = Math.floor(-ms / 3600000);
    return hours >= 24
      ? `EXPIRED ${Math.floor(hours / 24)}d ${hours % 24}h ago`
      : `EXPIRED ${hours}h ago`;
  }
  const hours = Math.floor(ms / 3600000);
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}

/**
 * → { kind, permanent, expired, endsAt, legacyTrialStartedAt, label }
 *
 *   kind      "permanent" | "override"
 *   endsAt    Date | null  (null only when permanent)
 */
function trialStatus(root, now = new Date()) {
  const expiresAt = toDate(root && root.expiresAt);
  const legacyTrialStartedAt = toDate(root && root.trialStartedAt);

  // The only deadline there is: a paid-through date, or a manual lockout.
  if (expiresAt) {
    const remaining = expiresAt.getTime() - now.getTime();
    return {
      kind: "override",
      permanent: false,
      expired: remaining <= 0,
      endsAt: expiresAt,
      legacyTrialStartedAt,
      label: `PAID/OVERRIDE until ${expiresAt.toISOString()} (${describeRemaining(remaining)})`,
    };
  }

  return {
    kind: "permanent",
    permanent: true,
    expired: false,
    endsAt: null,
    legacyTrialStartedAt,
    // Flagged, not warned about: the stamp is inert, but seeing it explains why
    // a doc has a field nothing reads.
    label: legacyTrialStartedAt
      ? "PERMANENT — never expires (carries a dead trialStartedAt stamp)"
      : "PERMANENT — no expiresAt, never expires",
  };
}

module.exports = { toDate, describeRemaining, trialStatus };
