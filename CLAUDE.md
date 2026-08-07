# Smart Serve — notes for Claude

Engineering rules live in `CONVENTIONS.md` (read it before touching code).
Setup, deploys and the trial system are in `SETUP.md`. This file covers the
operational tasks the owner asks for by name.

## How the trial works (read this before changing anything expiry-related)

Every **new** restaurant is born a 2-day trial. There is no opt-in and no demo
build — one APK serves prospects and paying customers alike.

- `firestore.rules` requires `trialStartedAt == request.time` when the
  restaurant root doc is created. Only a `serverTimestamp()` sentinel can
  satisfy that, so the **server** decides when the clock starts. A client
  cannot backdate it, omit it, or supply a deadline of its own.
- The deadline is **computed** (`trialStartedAt + trialLength()`), never
  stored. Nothing exists for anyone to tamper with.
- `expiresAt` on the root doc **overrides** the computed deadline. Admin SDK
  only. That is how a paid-through date or a manual lockout is set.
- **No trial fields = never expires.** This is the whole safety property.
  Never replace it with an `isPaid` flag — absence cannot drift out of sync
  with reality, a boolean can.
- The clock is on the **restaurant**, not the person. Join-code staff carry no
  expiry of their own and lock out with their workspace.

Proven end to end by `scripts/e2e/trialExpiry.e2e.ts` (14 checkpoints). Run it
against the emulators after ANY change to the expiry rules:

```bash
firebase emulators:start --only auth,firestore --project demo-sada-isolation
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/isolation.e2e.ts
```

The emulators need a JDK. There is none on PATH; Android Studio's bundled one
works:
`$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`

## Activating a paying customer

When the owner says a customer has paid and gives you their email:

```bash
node scripts/activateTenant.js <email>             # read-only: shows the match
node scripts/activateTenant.js <email> --confirm   # actually activates
```

**Always run the read-only form first** and show the owner the resolved
restaurant name and owner email. Only run `--confirm` once they've eyeballed
it — the lookup is by email and activating the wrong tenant hands out free
access.

Ask the customer for the **email they signed up with** (the app has no
usernames) plus their restaurant name as a cross-check.

Subscription instead of permanent, and revocation:

```bash
node scripts/activateTenant.js <email> --until 2026-12-31 --confirm  # paid through
node scripts/activateTenant.js <email> --until 2000-01-01 --confirm  # lock now
```

## Other operational tools

```bash
node scripts/auditTenants.js               # every tenant, most urgent first
node scripts/auditTenants.js --expiring    # ends within 24h — the chase list
node scripts/auditTenants.js --tenant <id> # one tenant in full detail

# The wrong person registered and holds the cashier seat:
node scripts/reassignCashier.js --to <new@email> --from <old@email> --confirm
```

`reassignCashier` exists because nothing **inside** the app can move the owner
seat: `meta/bootstrap.cashierClaimed` blocks a re-claim, and a cashier's update
rule is hard-locked to `waiter`/`kitchen` on both sides. Admin SDK only.

All three scripts need `scripts/serviceAccount.json` (Admin SDK key,
gitignored, owner's machine only). The Admin SDK bypasses security rules —
that is the only way the trial fields can be written at all.

## Legacy: the shared demo sandbox

`npm run trial:seed` / `trial:reset` predate self-serve trials. They seed ONE
shared `demo-trial` tenant with three fixed logins, stamping `expiresAt`
directly. Still functional (the override path), but superseded — a prospect
should just register their own restaurant from the app.
