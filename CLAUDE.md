# Smart Serve — notes for Claude

Engineering rules live in `CONVENTIONS.md` (read it before touching code).
Setup, deploys and the trial system are in `SETUP.md`. This file covers the
operational tasks the owner asks for by name.

## THERE IS NO FREE TRIAL OF OURS (read this before changing anything expiry-related)

The app runs **no trial clock of its own**. The free trial is Google's: a
3-day intro offer on the Play base plan, which Google starts, bills and mails
about. (3 days is Play's minimum; a 2-day trial cannot be configured.)

A new restaurant is born one of two ways, and `AuthContext` decides which when
it calls `registerRestaurant`:

| Born | `expiresAt` | When |
|---|---|---|
| **awaiting a subscription** | epoch 0 | the build can sell (`isBillingAvailable()`): the owner lands on the paywall straight after signup |
| **permanent** | absent | the build cannot sell — an older APK, no product id, Expo Go, every e2e suite |

It used to be a 3-day self-serve trial: the create rule demanded
`trialStartedAt == request.time` and the deadline was computed from it. That
was removed — it locked testers out on day 3 of a 14-day Play closed test.

- **Epoch 0 is a sentinel, not a deadline, and it is the ONLY value a client
  may write** into `expiresAt` — at registration, never after. It is the one
  date that grants nothing, so "a client cannot put itself on a clock" still
  holds: no client can hand itself a second of access. The billing function
  overwrites it with the real paid-through date.
- **It is a fixed value, not `request.time`, on purpose.** The app tells
  "never subscribed" from "lapsed" by it (`awaitingSubscription`) without a
  second field, a pending server timestamp never reads back as "no deadline",
  and a device clock running behind the server never believes the restaurant
  is open.
- **Only a build that can sell may lock.** The paywall is the one way out of
  the awaiting state; a restaurant put there by a build with no billing would
  be stranded. That is why the decision lives beside `isBillingAvailable()`
  and not in `signupApi`. It also means setting
  `EXPO_PUBLIC_PLAY_SUBSCRIPTION_ID` on a build is what turns the paywall ON
  for everyone who signs up with it — do not set it on a production build
  until a purchase has been proven end to end on the internal track.
- **The order is welcome tour → signup → paywall → setup → walkthrough.** The
  tour's answers wait on the device (`pendingSetup`, 24h) and are applied by
  `(app)/setup.tsx` once the restaurant opens. Nothing can be written to a
  locked restaurant, so setup cannot come before the paywall.
- **No `expiresAt` = never expires.** This is the whole safety property. Never
  replace it with an `isPaid` flag — absence cannot drift out of sync with
  reality, a boolean can.
- `trialStartedAt` is a **dead field**. Restaurants registered under the old
  build still carry it, and *nothing reads it* — that is precisely what makes
  the removal retroactive instead of a mass lockout. `scripts/stripLegacyTrials.js`
  clears it (optional, changes no behaviour). Never wire it back up to a
  deadline; a stale reader is how the whole customer base expires at once.
- The clock, when there is one, is on the **restaurant**, not the person.
  Join-code staff carry no expiry of their own and lock out with their
  workspace.
- **The permanent branch of the create rule is a known gap, kept on purpose.**
  While a build that predates the paywall is live on Play, it must still be
  able to register, so the rule accepts a registration with no `expiresAt`.
  Anyone on that old build gets a free permanent restaurant. Close it by
  dropping the first branch of `bornPermanentOrAwaitingSubscription()` once
  the old build is no longer in use — not before, or its signups are refused
  with nothing on screen to say why.
- **Google's reviewers hit the paywall too.** Give them a way past it in Play
  Console → App content → App access: a login for a restaurant made permanent
  with `activateTenant.js`.

Proven end to end by `scripts/e2e/trialExpiry.e2e.ts` (17 checkpoints).
Checkpoints 7–9 are the paywall (born locked, cannot be opened by hand, opens
on the billing function's date) and checkpoint 10 is the retroactive one: a
restaurant carrying a decade-old `trialStartedAt` must still work completely.
Run it against the emulators after ANY change to the expiry rules:

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
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/discardOrder.e2e.ts
```

`discardOrder.e2e.ts` is the odd one out: its guards live in `cashierApi`, not
in `firestore.rules` — the rules can't scan an array for "no line carries a
`kotId`", and `cancelled` is a write they already allow (it's what voiding a
bill does). That suite IS the enforcement, so run it after ANY change to
`discardOrder` or the order lifecycle.

The emulators need a JDK. There is none on PATH; Android Studio's bundled one
works:
`$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`

## Subscriptions / Google Play Billing (read before touching billing)

The paywall above is the on-ramp; this is what sits behind it. Google
Play sells a subscription, and a Cloud Function turns that into the SAME
`expiresAt` field `activateTenant.js` has always written. **The model did not
change — only who holds the pen.**

| Piece | File | Job |
|---|---|---|
| what we sell | `lib/billing/config.ts` | product id + region, from env |
| the native edge | `lib/billing/nativeIap.ts` | the ONLY file touching `expo-iap` |
| the app's API | `lib/billing/index.ts` | buy / restore; what screens import |
| the paywall | `features/billing/SubscribeScreen.tsx` | `/subscribe`, owner only |
| "I just paid" | `functions/src/verifyPurchase.ts` | callable — unlock now |
| everything after | `functions/src/onPlayNotification.ts` | RTDN — renewals, refunds |
| the privileged write | `functions/src/entitlement.ts` | the only writer of `expiresAt` |

The load-bearing decisions:

- **Entitlement lands on the RESTAURANT, never on the buyer.** Play ties a
  purchase to a Google account; a restaurant is three tablets signed into three
  different ones. Writing it per-account would unlock the owner's phone and
  leave the kitchen locked. This is also why the existing `expiresAt` field was
  already the right sink and needed no redesign.
- **Buying does not unlock anything.** The client obtains a purchase token and
  sends it to the server; the server asks Google, then writes the date.
  `AuthContext` is already watching the restaurant doc, so the unlock arrives
  through the ordinary listener on every device at once. A client that could
  unlock itself is a client that could lie.
- **The functions never DELETE the trial fields.** Absent-both means PERMANENT.
  That is a human decision about a customer and it stays in `activateTenant.js`
  behind a typed `--confirm`. A refund is written as an `expiresAt` in the
  past, never as a deletion — getting that backwards hands a refunded customer
  the app forever.
- **We ask Play what is true; we do not replay its state machine.** RTDN tells
  us *something changed*; the function then calls `subscriptionsv2.get` and
  writes whatever that says. Maintaining our own copy of
  RENEWED/RECOVERED/RESTARTED is how a working restaurant gets locked out.
- **A grace period stays OPEN; account hold does not.** `IN_GRACE_PERIOD` is a
  bank declining a card, not a decision to leave — Google is still retrying
  and extends `expiryTime` to cover it. `CANCELED` also stays open to the end
  of the period already paid for. `ON_HOLD` is what follows a grace period
  that ran out: Google's lifecycle table says revoke, reports an `expiryTime`
  already in the past, and can hold for two months. So how long a declined
  card gets is ONE setting — the grace period on the base plan in Play
  Console — and `ENTITLED_STATES` in `playApi.ts` follows Google's table
  rather than holding a second opinion.
- **An unpaid order changes nothing.** `PENDING` (cash at a shop, a slow
  transfer) and `PENDING_PURCHASE_CANCELED` are not a subscription ending.
  Neither the app nor the functions verify, acknowledge or write a date for
  one — a restaurant that was open before its owner tried to pay must be
  exactly as open when they abandon it. The later PURCHASED notification is
  what unlocks, and `onPlayNotification` acknowledges it itself, because no
  screen is open to do so.
- **News that ENDS access is believed only from the token that is paying.**
  A restaurant collects tokens (a resubscribe after a lapse issues a new
  one), and the old token still gets its own EXPIRED weeks later.
  `hasOtherLivePurchase` is what stops that stale notification locking out a
  paid-up restaurant. News that extends access needs no such check.
- **Reaching Google failing is never "not entitled".** `verifyPurchase` throws
  `unavailable` on a lookup failure so the app retries. Taking a paying
  restaurant offline because our function couldn't authenticate is the worst
  possible reading of an outage.
- **Acknowledge, or Google auto-refunds after 3 days.** Both the app and the
  server acknowledge, and only after the entitlement is written.
- **The Play base plan is where the free trial now LIVES.** It used to carry
  none, because the app ran its own `trialStartedAt` trial and the rules
  enforced it — two trial systems each believing they own the question is one
  too many. The app's trial is gone, so that objection is gone with it: put the
  3-day free trial on the base plan as an intro offer and let Google run it,
  bill it and mail about it. Do NOT also revive the in-app clock.
  A Play trial only starts when someone chooses to subscribe, so a new
  restaurant is born locked and sent to `/subscribe` straight after signup;
  see "THERE IS NO FREE TRIAL OF OURS".
- **`expo-iap` is a NATIVE module: billing only exists in an APK built after
  it landed.** It is installed (5.x, wrapping Play Billing Library 9 — Google
  rejects uploads on anything below v8, so keeping it current is what keeps
  the app uploadable) and `nativeIap.ts` is reconciled against its real
  types. On an older install, or with no product id, everything degrades to
  "billing unavailable" and the expiry screen keeps its "Contact us" button,
  the same way `kitchenChime` and `printerService` degrade. Nothing here is
  live until a product id is set and the functions are deployed.
- **Three expo-iap field names fail SILENTLY if wrong** — the request is keyed
  `google` (not `android`), the id is `obfuscatedAccountId` (no `Android`
  suffix), and offers are `subscriptionOffers[].offerTokenAndroid`. Get the
  second one wrong and purchases succeed with no restaurant stamped on them.
  Re-check all three in `nativeIap.ts` after any major version bump.

Turning it on (in order — the code side is done):

```bash
# 1. Play Console: upload a build containing expo-iap to internal testing
#    FIRST (Play will not let you create products until it has seen an APK
#    with the billing permission), then Monetise → Subscriptions → create the
#    subscription, a base plan, and the free-trial offer on it.
# 2. Set the build-time id (EAS env or .env) and rebuild:
#    EXPO_PUBLIC_PLAY_SUBSCRIPTION_ID=<product id>
# 3. The server (needs the Blaze plan):
firebase deploy --only functions
# 4. Wire Google to it — the steps are at the top of
#    functions/src/playApi.ts (service account in Play Console + the Android
#    Publisher API) and functions/src/onPlayNotification.ts (the Pub/Sub
#    topic + "Send test notification").
```

The Play identity is **`com.smartserve`** (`app.json` → `expo.android.package`),
and it is PERMANENT from the first upload — Play keys an app on its package
name forever. `PLAY_PACKAGE_NAME` in `functions/src/playApi.ts` defaults to the
same string and must be changed with it; if they drift, Play answers the
mismatch with a 404 and every purchase fails looking like "no such purchase"
rather than like a config error.

One package name serves every build profile, which is fine only while the other
white-label (Akila's, see `scripts/buildTargets.js`) stays internal-only —
sideloaded APKs sharing a name just overwrite each other. Publishing a second
white-label to Play needs a per-target package name set up BEFORE either app's
first upload. It cannot be fixed afterwards.

`FUNCTIONS_REGION` in `lib/billing/config.ts` MUST match `setGlobalOptions` in
`functions/src/index.ts`. Nothing checks them against each other, and a
mismatch fails as a "not found" that looks nothing like a region problem.

Billing cannot be tested in Expo Go or a debug build. It needs a signed AAB on
an internal testing track with licensed testers added in Play Console.

## Sign in with Google (read before touching auth)

"Continue with Google" on `/login` and `/signup`. Setup steps — provider,
client id, SHA-1, rebuild — are in `SETUP.md` §5b.

| Piece | File | Job |
|---|---|---|
| the native edge | `src/lib/googleAuth.ts` | the ONLY file touching `@react-native-google-signin/google-signin` |
| the button | `features/auth/GoogleButton.tsx` | the G mark + the "or" divider, shared by both screens |
| register | `features/auth/signupApi.ts` | `registerRestaurantWithGoogle` |
| sign back in | `features/auth/AuthContext.tsx` | `signInWithGoogle` |

The load-bearing decisions:

- **Nothing in `firestore.rules` changed, and nothing should.** Google is a
  different way to obtain a Firebase auth user; the registration batch after
  it is byte-identical, which is why `registerRestaurant` and
  `registerRestaurantWithGoogle` share `commitOwnerRegistration` rather than
  each holding a copy. `isOwnerRegistrationBatch()` is what that function is
  written against — a second copy is a second thing to keep in step with the
  rules.
- **Google and email are born the same way.** Both pass the same
  `awaitSubscription` option, so whichever door the owner used, they meet the
  same paywall. See "THERE IS NO FREE TRIAL OF OURS" above.
- **The restaurant name and phone are collected BEFORE the picker opens.**
  Google gives us a person; the app needs a business and a number to ring. So
  the signup form puts those two fields above the fork and the email-only
  fields (name, address, password) below it. A button that authenticates
  someone and then complains about an empty text box is the failure this
  layout exists to prevent.
- **`signupInProgress` goes up BEFORE `signInWithCredential`, not after.**
  `onAuthStateChanged` fires the moment the credential lands and a new Google
  account has no `userIndex` yet — without the flag AuthContext concludes "not
  linked" and signs the owner out mid-registration.
- **Google on `/signup` with an account that already has a restaurant signs
  them IN.** A Google account is one wrong tap away, unlike typing an email;
  opening a duplicate workspace would strand their menu and join code in it.
  `userIndex/{uid}` is the check.
- **Google on `/login` creates nothing.** No restaurant, no profile — an
  unknown account is bounced with the ordinary "not linked" notice.
- **Rollback deletes only an account THIS call created** (`isNewUser`). A
  pre-existing Google login is signed out, never deleted, because our batch
  failing is not a reason to remove somebody's account.
- **Sign-out calls `forgetGoogleAccount()` first.** Google caches the last
  account; on a shared restaurant tablet, not clearing it signs the next
  person straight back in as the person who just left.
- **It is a NATIVE module and degrades like every other one.** No client id or
  an older APK ⇒ `isGoogleAuthAvailable()` is false, no button is drawn, and
  the email form is untouched — the same way `kitchenChime` and
  `printerService` degrade. A hidden button beats one that always fails.
- **It is the WEB client id, on Android.** The Android one fails as
  `DEVELOPER_ERROR`, which reads like a keystore problem and isn't.
- **The package is NOT listed in `app.json` → plugins, on purpose.**
  `npx expo install` adds it; it was removed. With no options the library's
  config plugin applies Google's Gradle plugin and requires a
  `google-services.json` this project has never had — Android's build.gradle
  needs only `play-services-auth`, the module autolinks, and the client id
  arrives in JS. Do not "fix" the missing entry; prebuild fails with it.

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
node scripts/auditTenants.js --legacy      # still carry the dead trial stamp
node scripts/auditTenants.js --tenant <id> # one tenant in full detail

# Housekeeping after the trial removal. Deletes ONLY the dead trialStartedAt
# stamp, never expiresAt. Changes no behaviour — nothing reads it either way.
node scripts/stripLegacyTrials.js            # candidates
node scripts/stripLegacyTrials.js --confirm  # clear them

# The wrong person registered and holds the cashier seat:
node scripts/reassignCashier.js --to <new@email> --from <old@email> --confirm

# Abandoned orders (read-only without --confirm, like activateTenant):
node scripts/cancelStaleOrders.js --tenant <rid>                    # candidates
node scripts/cancelStaleOrders.js --tenant <rid> --empty --confirm  # 0-line husks

# KOT numbering left over from the old 4000 seed:
node scripts/resetKotCounter.js --tenant <rid>                       # show state
node scripts/resetKotCounter.js --tenant <rid> --renumber --confirm  # 1..N
```

`resetKotCounter` exists because `counters/kotTicket` used to seed at 4000
(first ticket #4001) and a seed only applies to a counter that doesn't exist
yet — tenants created before the seed became 0 keep their old run of numbers.
It refuses to reset past a ticket that already exists; `--renumber` rewrites
the existing tickets in fire order first. Only ever point `--renumber` at a
test tenant: a KOT number the kitchen or a printed ticket has already seen
should not change under them.

`cancelStaleOrders` marks orders `cancelled` — never deletes — and refuses any
order that has a `billId` or that isn't `open`. The in-app **Discard** button
on the Bills screen ("Never sent to kitchen") covers the same ground for the
cashier; the script is for the 0-line husks, which are invisible in the app
because every order list skips orders with no items.

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

## Variants / options (read before touching anything price-related)

A dish can carry priced **options** — "Burger: Chicken ₹220 / Veg ₹180 /
Crunchy ₹250". The owner adds them in Menu Management; the waiter picks one in
the Customize sheet. Helpers live in `src/features/menu/variants.ts`.

The load-bearing decisions:

- **A variant is a PRICE, not a product.** It shares the parent's category,
  photo and offer scope, which is why the offers engine needed no change at
  all — it scopes by `menuItemId`/`categoryId`, and a variant changes neither.
- **`MenuItem.price` is kept equal to the CHEAPEST variant.** That is what
  every reader written before variants existed still finds: "from ₹180", the
  reports, the offer scoping. Never let it drift to zero or to a stale value.
- **Two or more, or it isn't a choice.** `hasVariants()` is `>= 2`. A single
  option would open a sheet to ask a question with one answer; such an item
  prices and adds exactly like a plain one.
- **The line's `name` is COMPOSED at add time** — `Burger (Chicken)` — beside
  a structured `variantId`/`variantName`. That composition is why the KOT, the
  ESC/POS encoder, the KDS card and the bill all print the right thing with no
  variant code in any of them. `variantId` is what the order screen matches on
  so two variants of one dish stay two lines at two prices.
- **The variant is snapshotted, like an offer name.** Renaming or repricing it
  tomorrow cannot rewrite an order placed today.
- **`variants` is written as `[]`, never `undefined`.** `stripUndefined` in
  `menuApi` would drop the key and leave the old list on the document.

`firestore.rules` can't iterate a list, so per-entry variant prices are NOT
range-checked the way `price` is — only `is list` and a size cap. That is
contained: only admin/cashier can write a menu item, an order line snapshots
the price rather than reading it back, and the bill re-derives from the line
snapshots. A malformed variant misprices the next order, exactly as a mistyped
`price` already would; it cannot reach a bill that is already open.

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

The two **unsolicited** haptics live in the order alerts — `kotAlerts.tsx`
(waiter: your food is READY) and `newKotAlerts.tsx` (kitchen: an order landed).
Both mean "walk somewhere now", which is the bar. Keep it there — pulses the
user did not ask for are a budget, and it is spent.

## Order alerts (read before adding another)

Two mirrored, purely client-side alerts. Both work by diffing consecutive
snapshots of a kot subscription the screen already holds — no server, no push:

| File | Watches for | Tells |
|---|---|---|
| `features/order/kotAlerts.tsx` | a status TRANSITION (→ preparing/ready) | the waiter |
| `features/kitchen/newKotAlerts.tsx` | an ARRIVAL (an id not in the last snapshot) | the kitchen |

The load-bearing decisions:

- **The first snapshot only seeds the baseline** — and the baseline must wait
  for `loading` to clear. `useCollectionData` reports an EMPTY array before its
  first snapshot, so seeding from that makes the entire first snapshot look
  like it just arrived and the board announces itself on every launch. That is
  what `useNewKotAlerts`' `ready` argument is for; an alert that cries wolf on
  launch is one the staff learn to ignore within a week.
- **The kitchen alert diffs KOTs, not the table cards.** The board folds a
  table's rounds into one card (`groupKots`), so a second round to a table that
  already has a card changes no card at all — and that is exactly the order a
  busy kitchen misses. Feed the hook the flat list.
- **Sound is the kitchen's primary channel; the banner and haptic are backup.**
  A cook is at the pass with their hands full, not watching a tablet. That
  inverts the usual priority and is why this is the one sound in the app.
- **The chime repeats while the ticket is `new`, and `new` IS the acknowledge.**
  Pressing START silences it, so the ack is something the kitchen was going to
  do anyway rather than a dismiss button bolted on to shut the app up. It gives
  up after `MAX_REPEATS` (~2 min): a kitchen that has ignored six chimes will
  not be moved by a seventh, and past that it is just noise — noise being what
  gets the volume turned down for the whole service.
- **The nag timer is keyed on the ARRIVAL, never on `kots` or the pending
  count.** Those change on every write during service, and re-keying would
  restart the interval each time — so on the busiest board the nag would never
  fire at all. See the comment in the hook before changing that dependency.
- **`expo-audio` is a NATIVE module: sound only exists in an APK built after it
  landed.** `lib/kitchenChime.ts` wraps every entry point and degrades to
  banner + haptic on an older install, the same way a pre-USB build reports
  Bluetooth-only. A kitchen screen must never break because it couldn't beep.
  It uses a lazy `require`, not a static import — a static one is hoisted and
  throws at import time, before any try/catch can run.
- **The chime asset is GENERATED, not downloaded**, by
  `node scripts/generateChime.js` → `assets/sounds/new-order.wav`. Tune it
  there; that file explains why it is three ascending notes in the 1–2kHz band
  (a kitchen is loud and reverberant, and the ear finds a melody in noise far
  better than a beep).

Neither alert reaches a **backgrounded** app. Real push needs
expo-notifications plus per-device tokens; both files carry the TODO.

## Activation / the walkthrough (read before touching first-run anything)

Everything between "the setup wizard finished" and "this owner can work the
app" lives in `src/features/onboarding/`. It exists because the app cannot be
sold by a person: the Play listing installs it, Google runs the free trial,
and from there the product has to teach a restaurant owner its whole job on
its own.

**It used to be a checklist and a floating hint card. Both are gone.** A list
of chores ("connect your printer") is an admin to-do list, not a lesson — it
never answered the only question a new owner has, which is *what is this and
can I work it?* The answer is a guided run through one whole order, and that
is now the first thing they see.

| Piece | File | Job |
|---|---|---|
| the world | `practice/practiceState.ts` | one restaurant, in memory, for 90 seconds |
| what it teaches | `practice/practiceScript.ts` | the steps, resolved from the setup answers |
| the run | `practice/PracticeRun.tsx` | the screen, `/practice` |
| the instruction | `practice/PracticeCoach.tsx` | one card, one sentence, one thing to do |
| the payoff | `practice/PracticeReceipt.tsx` | their bill, with their name on it |
| has it happened? | `practice/practiceFlag.ts` | device-local, per restaurant |
| the nudge ladder | `activation.ts` + `nudges.ts` | what we say to someone who has left |

The load-bearing decisions:

- **It is a SIMULATION, and it writes nothing.** No Firestore read beyond the
  menu, no write, no rules involvement, no cleanup to get wrong — closing the
  screen is what deletes it. The competing design (write a real order, ticket
  and bill, then undo all three) is one dropped connection away from a phantom
  ₹180 in a restaurant's opening figures, on the very day the owner is
  deciding whether to trust the figures at all.
- **But the screens are the REAL screens.** `TableCard`, `OrderMenuCard`,
  `OrderLineRow`, `OrderCartPanel` and `TableTicketCard` are prop-driven and
  hook-free, so the run mounts the same components the live app draws, fed
  from a reducer instead of a subscription. `computeBill` and `applyOffers`
  are pure, so the practice bill is arithmetically identical to a real one. A
  bespoke mock would teach a screen that does not exist and would rot the
  moment somebody restyled the real one.
- **`TableTicketCard` takes an `onCompleteOverride`** — the one seam this
  needed, because that card calls `completeGroup` (a Firestore write) itself.
  Absent on every real board; the practice run passes it so COMPLETE cannot
  write. If another card ever grows its own write, it needs the same seam.
- **The script is filtered by the setup answers, not just reworded by them.**
  Quick billing has no Send-KOT button and no kitchen tab AT ALL
  (`OrderCartPanel` renders neither, `canSeeTab` drops the KDS); a counter
  business has no floor. A step that pointed at a control this restaurant does
  not have would have the owner conclude the app is broken rather than the
  tutorial. Steps declare `requires: (c) => ...` — deliberately the same shape
  as `canSeeTab`, because it is the same question about a different thing.
  Four loops fall out: table→KOT→kitchen→Bills, table→Charge,
  dish→KOT→kitchen→bill, dish→Charge.
- **Where the money is taken MOVES, and that is not cosmetic.** `canBillHere`
  is `(!isDineIn || !config.kotEnabled)`, so a dine-in table with a kitchen
  ticket is paid for from the Bills tab and everything else is charged from
  the cart already on screen. Telling a food-truck owner about a Bills tab
  they never open teaches the app's shape instead of their job.
- **It advances on the ACTION, never a Next button.** Every step asks the
  reducer whether the thing is done, so the run cannot be walked through
  without doing it and the caption cannot claim something that did not happen.
  A step that completes ITSELF is the bug to watch for — there was a "go to
  Bills" step whose arrival satisfied it, so it appeared and vanished in the
  same frame having taught nothing.
- **Everything but the target is dimmed; nothing is disabled.** The dimming
  says where to look, it does not take the controls away. Skip is visible on
  every step: an owner who has understood it by step two must be able to leave
  at step two.
- **The payoff is a RECEIPT, not a number.** The old celebration put "YOUR
  FIRST BILL ₹120" on screen and asked the owner to be impressed by an order
  they had invented thirty seconds earlier. A receipt carries their name,
  their address, their tax treatment and their prices — it is the first moment
  the software looks like it belongs to them. It also says plainly that
  nothing was saved, because leaving someone to wonder whether ₹180 is now in
  their figures is a small betrayal at the exact moment trust is being built.
- **The run is offered ONCE, however it ends.** Somebody who skipped out has
  said they do not want it; re-offering next launch is how a helpful screen
  becomes a nuisance. It lives for ever in Account → How to use Smart Serve,
  which is also where a second person picking up the tablet in week three
  finds it. The flag is device-local *because a walkthrough is about the
  human*, unlike `activationDoneAt` which is about the restaurant.
- **`activation.ts` is now only the nudge ladder's data source.** It still
  retires itself onto `activationDoneAt` at three settled bills or two trading
  days, and still refuses to report anything until its probes answer — an
  established restaurant carries no marker and no local flag, so for the beat
  before `bills` resolves it looks exactly like a brand-new one, and acting in
  that beat is how a year-old restaurant gets sent "take your first order".
- **GST is a wizard question.** It defaulted ON and was reachable only by
  scrolling Account, so an unregistered place charged 5% it cannot remit until
  an accountant noticed. `gstDecidedAt` is separate from `gstEnabled` because
  the latter is written `true` at registration and so cannot distinguish "they
  chose this" from "nobody ever asked"; a restaurant predating the question
  gets a one-tap confirm in Account rather than being made to flip the switch.
  A device with no local answer adopts the restaurant's, so two tablets stop
  billing the same table differently.
- **Notifications are LOCAL, not push**, and permission is asked ONCE from the
  end of the wizard. Android 13+ shows the dialog once and a denial is
  permanent. Nothing depends on the answer.
- **Nothing here mentions the trial or payment.** Google Play runs the free
  trial and sends its own billing mail; a second voice dunning a customer we
  have not convinced yet is worse than no voice at all.

`components/EmptyState.tsx` is the other half of this: every list that used to
answer emptiness with one grey line now says what the screen will hold and,
where there is something to do, offers the one button that does it.
`tone="calm"` is for a list that is empty because the shift is going well.

STILL TO BUILD (agreed, not done): the orientation pass over the real tab bar,
and the on-demand lessons for Menu, Bills & history, Team and Setup.

## Legacy: the shared demo sandbox

`npm run trial:seed` / `trial:reset` predate self-serve trials. They seed ONE
shared `demo-trial` tenant with three fixed logins, stamping `expiresAt`
directly. Still functional (the override path), but superseded — a prospect
should just register their own restaurant from the app.
