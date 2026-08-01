# SADA POS — Setup & Preview Guide

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

Make sure these are enabled in the console: **Firestore Database**,
**Authentication → Email/Password**, **Storage**.

> These are public client identifiers — safe to keep in the repo's `.env.local`
> (which is gitignored). Real security is the Firestore Rules + Auth.

---

## 2. Deploy the security rules & indexes

The rules are the app's server-side security boundary — deploy them before real use:

```bash
npm i -g firebase-tools        # once
firebase login
firebase use your-project-id   # or: firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,storage
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

Seeded logins (password `sadapos123` — change these afterwards):

| Role    | Email             | Lands on   |
|---------|-------------------|------------|
| admin   | admin@sada.test   | Insights   |
| waiter  | waiter@sada.test  | Tables     |
| cashier | cashier@sada.test | Bills      |
| kitchen | kitchen@sada.test | KDS        |

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

## Troubleshooting

- **"Component auth has not been registered yet"** — Metro cache; run
  `npx expo start -c` once. (The `metro.config.js` fix is already in place.)
- **"Missing or insufficient permissions"** — rules not deployed (step 2) or the
  signed-in user has no `users/{uid}` profile doc (run the seed, step 3).
- **A query asks for an index** — deploy indexes (step 2) or click the console
  link in the error to create it.
