/**
 * ONE description of a tenant's trial state, shared by activateTenant.js and
 * auditTenants.js.
 *
 * This mirrors `tenantNotExpired()` in firestore.rules. The precedence order —
 * explicit expiresAt beats the computed trial deadline beats permanent — must
 * not drift between the two scripts, or the audit will confidently report a
 * status the server disagrees with. Change the rules and change this together.
 *
 * Nothing here enforces anything. The server does that.
 */

/** Must match `trialLength()` in firestore.rules. */
const TRIAL_DAYS = 2;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

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
 * → { kind, permanent, expired, endsAt, label }
 *
 *   kind      "permanent" | "trial" | "override"
 *   endsAt    Date | null  (null only when permanent)
 */
function trialStatus(root, now = new Date()) {
  const expiresAt = toDate(root && root.expiresAt);
  const trialStartedAt = toDate(root && root.trialStartedAt);

  // An explicit deadline wins outright — that is how a paid-through date and a
  // manual revocation both work.
  if (expiresAt) {
    const remaining = expiresAt.getTime() - now.getTime();
    return {
      kind: "override",
      permanent: false,
      expired: remaining <= 0,
      endsAt: expiresAt,
      label: `PAID/OVERRIDE until ${expiresAt.toISOString()} (${describeRemaining(remaining)})`,
    };
  }

  if (trialStartedAt) {
    const endsAt = new Date(trialStartedAt.getTime() + TRIAL_MS);
    const remaining = endsAt.getTime() - now.getTime();
    return {
      kind: "trial",
      permanent: false,
      expired: remaining <= 0,
      endsAt,
      label: `TRIAL ends ${endsAt.toISOString()} (${describeRemaining(remaining)})`,
    };
  }

  return {
    kind: "permanent",
    permanent: true,
    expired: false,
    endsAt: null,
    label: "PERMANENT — no trial fields, never expires",
  };
}

module.exports = { TRIAL_DAYS, TRIAL_MS, toDate, describeRemaining, trialStatus };
