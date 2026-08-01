# SADA POS

Restaurant billing software — **React Native (Expo)** + Firebase (Firestore
real-time). Runs in **Expo Go** for instant on-device preview. Built for a
standalone restaurant in Karnataka, India (GST 5% = 2.5% CGST + 2.5% SGST).

## Modules

Authentication · Table management · Waiter order + KOT · Kitchen display (KDS) ·
Cashier billing (GST, discount, payment) · Menu management · Reports ·
Real-time updates everywhere.

## Architecture

- **No backend server.** Firebase client SDK + **Firestore Security Rules** are
  the server-side security boundary (see `firestore.rules`).
- **Real-time by default** via Firestore `onSnapshot` — no websockets.
- **Money as integer paise**; all bill math in `src/lib/money.ts`.
- Canonical data model in `src/types/models.ts`; theme in `src/theme/theme.ts`.
- Firebase **JS SDK** (not @react-native-firebase) so it runs in Expo Go.

See `CONVENTIONS.md` (engineering rules) and `design/` (per-screen specs).

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in Firebase web config (EXPO_PUBLIC_*)
npx expo start                  # scan the QR with Expo Go on your phone
```

- **Preview on your phone:** install **Expo Go** (App Store / Play Store), run
  `npx expo start`, and scan the QR. Use `npx expo start --tunnel` if your phone
  isn't on the same network as the dev machine.

## Deploy the backend (rules/indexes)

```bash
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## Status

- **Foundation (Expo E0): done** — Expo + expo-router scaffold, Firebase (RN
  auth persistence), ported logic layer (types, money, GST, data APIs, realtime
  hooks), theme, auth + login, security rules. Metro bundles clean.
- **E1 (screens):** the six screens rebuilt in React Native from `design/`.
