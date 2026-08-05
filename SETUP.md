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

## 5. Hand a prospect a 2-day sandbox trial

A trial runs in its **own tenant**, cloned from your live restaurant's menu and
tables. The prospect never touches live data — their orders, bills, bill numbers
and daily revenue all live under `restaurants/demo-trial/`.

Enforcement is **server-side**, in `firestore.rules`, against `request.time`
(Google's clock). Changing the device date or reinstalling does not extend it.

> **The safety property:** a trial carries an `expiresAt` field. **No field =
> never expires.** Every real customer has no such field and is completely
> unaffected. The check is never written as "expiresAt must be in the future" —
> that form would lock out every existing account on deploy.

### Before you deploy — prove it on the emulator

Requires a JDK (`java -version`); the Firebase emulators won't start without one.

```bash
firebase emulators:start --only auth,firestore --project demo-sada-isolation
# in a second terminal:
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/trialExpiry.e2e.ts
E2E_EMULATOR=1 npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/isolation.e2e.ts
```

The expiry suite's first and last checkpoints are the ones that matter: a
restaurant with no `expiresAt` works identically before and after.

### Deploy and seed

```bash
npm run trial:audit                      # BEFORE: live accounts show "no expiry"
firebase deploy --only firestore:rules   # shared with production — see below
npm run trial:audit                      # AFTER: identical. Nothing moved.
npm run trial:seed                       # clone menu + create the 3 logins
```

`trial:seed` prints the three logins (cashier / waiter / kitchen), a shared
password, the sandbox join code and the exact deadline. All three are
pre-approved, so the prospect skips the join-code and approval flow entirely.

| Variable | Default | |
|---|---|---|
| `TRIAL_DAYS` | `2` | trial length |
| `TRIAL_RESTAURANT_ID` | `demo-trial` | must start with `demo-` |
| `LIVE_RESTAURANT_ID` | `sada-main` | cloned **from**, never written to |
| `DEMO_PASSWORD` | `Demo@1234` | shared by all three logins |

### Between prospects

```bash
npm run trial:reset   # wipes orders/KOTs/bills/counters + the 3 logins
npm run trial:seed    # fresh logins, clock restarts
```

`trial:reset` **keeps** the cloned menu and tables, and targets accounts by
membership of the trial tenant — it never enumerates all users.

> `scripts/resetUsers.js` is the old single-tenant script and deletes **every
> login in the project**. It now refuses to run without an explicit opt-in. Use
> `trial:reset` for sandboxes.

### The demo APK

The tenant is resolved at runtime, so the prospect can use your normal build.
Build the `demo` profile only if you want self-signup hidden:

```bash
eas build --profile demo --platform android
```

That sets `EXPO_PUBLIC_DEMO_MODE=true`, which hides the "Create an account" link
and shows a **DEMO BUILD** chip on the login screen — that chip is how you
verify the flag actually reached the bundle, and how you'd spot it if it ever
shipped to production by mistake.

> Hiding signup is UX, not enforcement: signup is a legitimately open flow and
> the rules cannot tell a prospect from a real new customer. What stops a trial
> running long is `expiresAt` on the **workspace** — so even a fresh join-code
> signup inside the sandbox is expired too.

### What's shared with production

`firestore.rules` is a **single global ruleset** for the whole database — there
is no per-tenant ruleset, so deploying it applies to every customer at once.
Data stays isolated; the policy does not. Rollback:

```bash
# fastest: Firebase Console → Firestore → Rules → version history → rollback
git checkout HEAD~1 -- firestore.rules && firebase deploy --only firestore:rules
```

The app-side changes (`AuthContext`, `pending.tsx`, `login.tsx`, `models.ts`)
ship in your next build and are inert for any account without `expiresAt`.

---

## Troubleshooting

- **"Component auth has not been registered yet"** — Metro cache; run
  `npx expo start -c` once. (The `metro.config.js` fix is already in place.)
- **"Missing or insufficient permissions"** — rules not deployed (step 2) or the
  signed-in user has no `users/{uid}` profile doc (run the seed, step 3).
- **A query asks for an index** — deploy indexes (step 2) or click the console
  link in the error to create it.
