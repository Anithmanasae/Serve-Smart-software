# Smart Serve — Setup & Preview Guide

Get the app connected to your Firebase project, seeded with sample data, and
running on your phone via **Expo Go**.

---

## 1. Connect Firebase (`.env.local`)

Firebase Console → ⚙️ **Project settings** → **General** → **Your apps** →
Web app (`</>`) → copy the `firebaseConfig` values into a new file
`.env.local` in the project root:

```
EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
EXPO_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
EXPO_PUBLIC_RESTAURANT_ID=sada-main
```

> The app is **multi-tenant**: one build serves every restaurant, and each
> login's restaurant is resolved at runtime from `userIndex/{uid}`.
> `EXPO_PUBLIC_RESTAURANT_ID` is only a **dev-build fallback** for logins that
> predate the migration (see `npm run migrate`).

Make sure these are enabled in the console: **Firestore Database** and
**Authentication → Email/Password**. Firebase **Storage is not required** —
menu photos are downscaled and stored as base64 JPEG data URIs inside the menu
item document (see `setMenuItemImage`), which keeps the project on the free
Spark plan.

> These are public client identifiers — safe to keep in the repo's `.env.local`
> (which is gitignored). Real security is the Firestore Rules + Auth.

---

## 2. Deploy the security rules & indexes

The rules are the app's server-side security boundary — deploy them before real use:

```bash
npm i -g firebase-tools        # once
firebase login
firebase use your-project-id   # or: firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

---

## 3. Seed sample data + logins

Restaurants are normally created in-app: an owner picks **"New restaurant"**
on the signup screen (becoming its approved cashier and getting a staff
**join code**, shown on their Account screen), and waiters/kitchen staff pick
**"Join a restaurant"** with that code, then wait for the cashier's approval
(Account → Staff Management). The seed script is an optional dev shortcut that
pre-provisions one login per role in `EXPO_PUBLIC_RESTAURANT_ID` (and marks
that restaurant's cashier seat claimed). `node scripts/resetUsers.js` wipes
all accounts and reopens that restaurant's cashier claim.

If your project has data from before the multi-tenant change, run
`npm run migrate` once — it gives the existing restaurant a join code and
writes the `userIndex` entry for every existing login.

Creates one user per role, sample menu categories/items, and 8 tables.

```bash
# a) Firebase Console → Project settings → Service accounts →
#    "Generate new private key" → save as scripts/serviceAccount.json
#    (gitignored — never commit it)
npm i -D firebase-admin        # already in devDependencies; runs on npm install
npm run seed
```

Seeded logins (password `Sada@1234` — change these afterwards):

| Role    | Email                 | Lands on   |
|---------|-----------------------|------------|
| admin   | admin@sada-pos.test   | Insights   |
| waiter  | waiter@sada-pos.test  | Tables     |
| cashier | cashier@sada-pos.test | Bills      |
| kitchen | kitchen@sada-pos.test | KDS        |

---

## 4. Preview on your phone (Expo Go)

Install **Expo Go** from the App Store / Play Store, then:

**Option A — run on your computer (most reliable):**
```bash
npm install
npx expo start
```
Scan the QR from the terminal with Expo Go (Android) or the Camera app (iOS).
Your phone must be on the **same Wi-Fi** as the computer.

**Option B — different network / no local Wi-Fi:**
```bash
npx expo start --tunnel
```
Routes through Expo's tunnel so any network works; scan the QR the same way.

> `.env.local` is read at bundle time, so restart `expo start` after editing it.

---

## 5. Free trials: one APK, everyone gets their own 2 days

Send the same APK to as many people as you like. Each person taps **Start a
free 2-day trial**, registers their own restaurant, and gets a private
workspace with a starter menu and eight tables. Two days later it locks and
shows them a **Contact us** screen. You do nothing per prospect.

### How the clock is set

`firestore.rules` requires the restaurant root doc to be created with
`trialStartedAt == request.time`. Only a `serverTimestamp()` sentinel can
satisfy that, so **the server picks the value** — a client cannot backdate it,
cannot omit it, and cannot supply a deadline of its own. The deadline is then
*computed* (`trialStartedAt + 2 days`), never stored, so there is nothing to
tamper with. Changing the device date or reinstalling does nothing.

> **The safety property:** **no trial fields = never expires.** A paying
> customer's restaurant carries neither `trialStartedAt` nor `expiresAt` and is
> completely unaffected by the expiry rules. Activation is the *deletion* of
> those fields. Never add an `isPaid` flag — absence cannot drift out of sync
> with reality, a boolean can.

The clock is on the **restaurant**, not the person. Staff who join with the
join code carry no expiry of their own — they lock and unlock with their
workspace, and you never activate anyone individually.

### Before you deploy — prove it on the emulator

Requires a JDK (`java -version`); the Firebase emulators won't start without
one. Android Studio ships a usable one if you have no other:
`JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`

```bash
firebase emulators:start --only auth,firestore --project demo-sada-isolation
# in a second terminal:
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/isolation.e2e.ts
```

The expiry suite's last checkpoints are the ones that matter: an **activated**
restaurant works identically to one that was never on a trial.

### Deploy

```bash
npm run trial:audit                      # BEFORE: existing tenants, status each
firebase deploy --only firestore:rules   # shared with production — see below
npm run trial:audit                      # AFTER: identical. Nothing moved.
```

Existing restaurants have no `trialStartedAt`, so they read as PERMANENT before
and after. Only restaurants registered *after* this deploy start a clock.

### Build the APK

```bash
eas build --profile demo --platform android
```

Set `EXPO_PUBLIC_CONTACT_PHONE` (digits only, country code, no `+`) and
`EXPO_PUBLIC_CONTACT_NAME` first, or the expiry screen will have no Contact
button. The `demo` profile also sets `EXPO_PUBLIC_DEMO_MODE=true`, which now
only shows a **TEST BUILD** chip with the Firebase project id on the login
screen — a diagnostic so you can see which backend an APK talks to. It changes
no behaviour; trials are enforced server-side for every build.

### Day to day

```bash
npm run trial:audit                # every tenant, most urgent first
npm run trial:audit -- --expiring  # ends within 24h — your chase list
```

When someone pays, ask for **the email they signed up with**, then:

```bash
node scripts/activateTenant.js owner@theirplace.com            # check the match
node scripts/activateTenant.js owner@theirplace.com --confirm  # activate
```

Their app unblocks on the next snapshot — no reinstall, and every staff device
in that restaurant unblocks at the same time. If someone was sitting *inside*
the app when it locked, have them close and reopen it (Firestore drops a
listener permanently when it hits permission-denied).

Selling a subscription rather than a one-off? Set a paid-through date instead,
and push it out on each renewal:

```bash
node scripts/activateTenant.js owner@theirplace.com --until 2026-12-31 --confirm
```

### When the wrong person registered

Whoever taps "New restaurant" becomes its cashier, permanently — the seat can
never be re-claimed, and a cashier cannot promote anyone to cashier. Have the
right person join with the join code first, then:

```bash
node scripts/reassignCashier.js --to owner@theirplace.com --from manager@theirplace.com --confirm
```

> Tell prospects up front: *register with the account that should own this.*
> One sentence in your demo message avoids most of these.

### Legacy: the shared demo sandbox

`npm run trial:seed` / `trial:reset` predate self-serve trials. They seed ONE
shared `demo-trial` tenant with three fixed logins and stamp `expiresAt`
directly. Still functional (it rides the override path) but superseded — a
prospect should just register their own restaurant from the app.

> `scripts/resetUsers.js` is the old single-tenant script and deletes **every
> login in the project**. It refuses to run without an explicit opt-in.

### What's shared with production

`firestore.rules` is a **single global ruleset** for the whole database — there
is no per-tenant ruleset, so deploying it applies to every customer at once.
Data stays isolated; the policy does not. Rollback:

```bash
# fastest: Firebase Console → Firestore → Rules → version history → rollback
git checkout HEAD~1 -- firestore.rules && firebase deploy --only firestore:rules
```

The app-side changes (`AuthContext`, `pending.tsx`, `login.tsx`, `signup.tsx`,
`models.ts`, `starterData.ts`, `TrialStatusCard`) ship in your next build and
are inert for any restaurant with no trial fields.

> **Deploy the rules and distribute the new APK together.** They are a matched
> pair, and each half alone misbehaves in a different direction:
>
> - **Old APK + new rules** → new-restaurant signup is **denied**. The old
>   build sends no `trialStartedAt`, and the new create rule requires it.
>   (Proven — see the "NO trialStartedAt at all" checkpoint in
>   `trialExpiry.e2e.ts`.) Anyone already signed in is unaffected; only new
>   registrations break. If you have already handed out an older APK, expect
>   those copies to stop being able to register once you deploy.
> - **New APK + old rules** → signup *succeeds*, silently, with **no trial**.
>   The old ruleset has no `hasOnly` on that create, so the extra field is
>   accepted and then ignored, and every restaurant registered in that window
>   is permanent and free forever.

---

## 6. Connecting the thermal printer

A restaurant can connect its printer two ways, set in **Account → Printer
Settings**. Both are Android-only and neither works in Expo Go — the native
code exists only in an installed build.

| | Bluetooth | USB-C cable |
|---|---|---|
| Set up first | Pair in Android Bluetooth settings | Plug in an OTG-capable USB-C cable |
| Permission | "Nearby devices", once | A system dialog per device, re-asked after unplugging |
| Good for | Printer away from the till, or a phone with a busy port | A fixed till, no pairing, no battery to run flat |

The picker shows a **Connection** toggle only when the device supports both;
a tablet without USB host (OTG) never sees the USB option. One printer is saved
at a time and the transport is saved with it, so switching is a single tap and
`Test print` always exercises the connection that receipts will use.

Both transports send byte-identical ESC/POS from `src/lib/printer/escpos.ts` —
paper width and layout do not change with the cable.

> **USB needs a fresh APK.** It ships as a local native module
> (`modules/usb-printer`, autolinked at prebuild), so an existing install shows
> Bluetooth only until you rebuild and redistribute:
>
> ```bash
> eas build --profile smartserve --platform android
> ```
>
> Nothing else regresses: an APK without the module falls back to Bluetooth,
> and a printer saved before this change keeps working — a saved printer with
> no transport recorded is read as Bluetooth.

---

## Troubleshooting

- **USB printer doesn't appear in the list** — the cable must be OTG-capable
  (many charge-only USB-C cables are not), and some printers only enumerate
  once they're powered on. If the list stays empty on a phone, check that it
  supports USB host at all — the toggle is hidden when it doesn't.
- **"The printer is busy — another app may be using it"** — another app holds
  the USB interface. Close it, or unplug and replug the cable.
- **"Component auth has not been registered yet"** — Metro cache; run
  `npx expo start -c` once. (The `metro.config.js` fix is already in place.)
- **"Missing or insufficient permissions"** — rules not deployed (step 2) or the
  signed-in user has no `users/{uid}` profile doc (run the seed, step 3).
- **A query asks for an index** — deploy indexes (step 2) or click the console
  link in the error to create it.
