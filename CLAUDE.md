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

Anything touching the **money path** (bills, totals, the daily summary) should
also run the three suites that cover it:

```bash
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/nonChargeable.e2e.ts
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/voidBill.e2e.ts
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/offers.e2e.ts
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

## Offers / discounts (read before touching anything price-related)

The owner configures promotions in Account → Offers; the app applies them by
itself. Four kinds cover everything asked for so far, because a promo is a
**discount plus a schedule**, not a new type each time:

| Kind | Example | Fields |
|---|---|---|
| `percent` | 20% off desserts | `percentOff` |
| `flat` | ₹30 off biryani | `amountOff` (paise/unit) |
| `bogo` | Buy One Get One | `buyQty`, `freeQty` |
| `bundle` | Couple Coffee, 2 for ₹199 | `bundleQty`, `bundlePrice` |

"Monday Madness" is a `percent` with `days: [1]`. Happy hour is the same with
`startMinutes`/`endMinutes`. If you are about to add a fifth kind, check first
whether it is really a schedule or a scope on one of these.

The load-bearing decisions:

- **The discount lives on the order LINE, next to an untouched `price` and
  `qty`.** A BOGO line is 2 units at full price with one unit's worth in
  `offerDiscount`. That is why the kitchen needs no knowledge of offers (it
  reads `qty` and cooks two), and why the reports can still tell "we sold ₹300
  of coffee" from "₹150 of it was given away".
- **`Bill.subtotal` stays GROSS**, `offerDiscount` is what came off, and GST is
  charged on the difference. Netting them would leave nothing to show the
  customer and nothing for the owner to measure the promo by.
- **Manual bill discounts are still banned.** `discountPercent` /
  `discountAmount` remain pinned to 0 by the rules and have no UI. An ad-hoc
  percentage at the till is indistinguishable from theft; an offer the owner
  set up in advance is not. Do not merge the two fields.
- **The offer name and amount are SNAPSHOTTED onto the line.** That is what
  makes "delete an offer at any stage" safe — removing the rule never rewrites
  a bill that already used it.
- **Pricing is frozen at the order's `createdAt`**, not the wall clock, so a
  table keeps the deal it sat down under when happy hour ends mid-meal or a
  long dinner crosses midnight.

The engine (`src/lib/offers.ts`) is pure and deterministic — same lines, same
offers, same timestamp, same result — which is how the waiter's screen and the
bill agree without talking to each other. Proven by
`scripts/e2e/offers.e2e.ts` (13 checkpoints); run it after ANY change to
pricing, `computeBill`, or the bill rules.

## Printing (read before touching anything printer-related)

Two transports, both Android-only, both absent in Expo Go. Screens import
**only** `src/lib/printer/printerService.ts` — it picks the transport off the
saved device, so no screen knows which cable is in use:

- `bluetoothTransport.ts` — Bluetooth Classic / SPP, printer paired in Android
  settings. Detected via `NativeModules.RNBluetoothClassic`.
- `usbTransport.ts` — a USB-C (OTG) cable, backed by the local native module
  `modules/usb-printer` (Android USB Host API, Kotlin). Autolinked at prebuild,
  so **it only exists in an APK built after it landed** — older installs report
  Bluetooth-only and keep working.

Two invariants worth keeping:

- **A saved printer with no `transport` is Bluetooth.** That's the migration
  for everyone who set up a printer before USB existed; don't drop it.
- **USB devices are addressed by vendor+product id, not Android's `deviceId`.**
  `deviceId` is reassigned on every re-plug, so persisting it would silently
  lose the printer overnight.

ESC/POS encoding stays in `escpos.ts` for both — encode once, and the bytes are
identical whichever way they leave the tablet.

## Haptics (read before adding one)

Everything goes through `src/lib/feedback.ts`. Screens import `feel` and pick by
**meaning**, never by strength — if two things feel the same, the app is telling
the user they are the same thing.

| Feel | For |
|---|---|
| `feel.select()` | moving through choices — tabs, chips, filters, pickers |
| `feel.tick()` | the same but repeatable — a stepper held down |
| `feel.tap()` | an ordinary button |
| `feel.press()` | something opens — a sheet, a modal, another screen |
| `feel.dismiss()` | that same something closes |
| `feelToggle(next)` | a switch, and you feel *which way* it went |
| `feel.success()` | a write committed — KOT fired, bill settled |
| `feel.warn()` | caution — a destructive confirm is on screen |
| `feel.heavy()` | the destructive thing actually happened |
| `feel.error()` | it failed, or the app refused |

The load-bearing decisions:

- **Android goes through `performAndroidHapticsAsync`, not `impactAsync`.**
  `impactAsync` drives the raw `Vibrator` — a fixed-duration blast of the whole
  motor, which is the cheap buzz, and picking `Light` vs `Medium` only changes
  its length. `performAndroidHapticsAsync` hands a `HapticFeedbackConstants`
  value to the OS, which renders it on the tuned composition primitives. This
  single swap is most of what "premium" means here. Never reintroduce
  `impactAsync` on the Android path.
- **Each feel is a *chain* of Android constants ending on one of the five that
  exist at every API level.** The good constants are API 30/34+ and expo throws
  without them; the chain degrades an old tablet to a coarser native effect
  instead of back to the buzzer. Rejections are cached per launch.
- **The feel fires on touch-DOWN**, from `PressableScale`'s `haptic` prop or
  `onPressIn`. Firing from the handler puts the pulse behind a re-render and
  sometimes behind a network write, which is what makes haptics feel bolted on.
- **Success is played when the write RESOLVES, never when the button is
  pressed.** Several screens used to celebrate up front and buzz identically
  whether or not the write landed. Errors are the other half of that: every
  `catch` and every refusal gets `feel.error()`.
- **Duplicates are absorbed, outcomes are not.** `feedback.ts` drops the same
  feel twice inside 120ms (a button and its handler both reporting), and each
  feel waits out its own `minGap`; outcomes set that to 0 so they always
  survive the press that caused them. So an extra call is harmless — but don't
  rely on it, put the feel in one place.
- **No in-app mute switch.** `performHapticFeedback` already honours the
  system-wide touch-feedback setting, so the OS owns that choice.

`kotAlerts.tsx` holds the only haptic the user did not ask for (the kitchen's
READY toast). Keep it that way — unsolicited pulses are a budget the app should
spend approximately once.

## Legacy: the shared demo sandbox

`npm run trial:seed` / `trial:reset` predate self-serve trials. They seed ONE
shared `demo-trial` tenant with three fixed logins, stamping `expiresAt`
directly. Still functional (the override path), but superseded — a prospect
should just register their own restaurant from the app.
