/**
 * Firebase app initialization for React Native / Expo — the ONLY place the SDK
 * is bootstrapped. Import `db`, `auth`, `storage` from here.
 *
 * Two RN-specific details vs. a web app:
 *  1. Auth uses `initializeAuth` + AsyncStorage persistence so a signed-in
 *     user survives app restarts (web used browser persistence automatically).
 *  2. Config comes from EXPO_PUBLIC_* env vars (Expo only exposes that prefix).
 *
 * We use the Firebase JS SDK (not @react-native-firebase) on purpose: the JS
 * SDK runs inside Expo Go, so the app can be previewed without a native build.
 */
import { initializeApp } from "firebase/app";
// @ts-expect-error — getReactNativePersistence is missing from firebase/auth
// type exports but exists at runtime in the RN build of the SDK.
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
export const storage = getStorage(app);

/**
 * DEV-ONLY fallback tenant. The real restaurant id is resolved at runtime
 * from userIndex/{uid} after sign-in (see paths.setActiveRestaurantId) — one
 * APK serves every restaurant. This env id is only used in __DEV__ builds for
 * pre-migration logins and local tooling.
 */
export const RESTAURANT_ID =
  process.env.EXPO_PUBLIC_RESTAURANT_ID ?? "sada-main";

/**
 * DEMO BUILD flag — set only in the `demo` EAS profile (see eas.json).
 *
 * Hides self-signup so a prospect on a trial device can't wander off and
 * register their own restaurant mid-demo. Your PRODUCTION build leaves this
 * false, so real customers keep self-onboarding exactly as before.
 *
 * This is UX, NOT enforcement — signup is a legitimately open flow and rules
 * cannot tell a prospect from a genuine new customer. What actually stops a
 * trial running long is the server-side `expiresAt` check in firestore.rules,
 * which is stamped on the trial WORKSPACE as well as each account: a fresh
 * join-code signup inside the demo tenant is expired too.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === "true";

/**
 * Which Firebase project this BUILD actually talks to.
 *
 * `.env.local` is gitignored, so it never reaches an EAS build — a build takes
 * its config from EAS's stored environment variables instead. The two can
 * silently disagree, and when they do the only symptom is "invalid email or
 * password" on a login that is perfectly valid in the project you were looking
 * at. Surfacing the id in the UI turns that into something you can see.
 *
 * "UNSET" means no Firebase config reached the bundle at all.
 */
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId ?? "UNSET";
