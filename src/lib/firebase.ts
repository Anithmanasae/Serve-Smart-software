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
