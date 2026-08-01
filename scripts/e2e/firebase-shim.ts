/**
 * Node stand-in for src/lib/firebase.ts so the real app modules (orderApi,
 * kdsApi, cashierApi, paths, signupApi) can run in a plain Node E2E script.
 * Identical exports, but plain getAuth (no React Native AsyncStorage
 * persistence).
 *
 * Set E2E_EMULATOR=1 to run against the local Firebase emulators
 * (firebase emulators:start) instead of the live dev project — required for
 * the multi-tenant isolation suite, which registers throwaway restaurants.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const USE_EMULATOR = process.env.E2E_EMULATOR === "1";

// Must be run from the repo root (as the header's npx command does).
// Against the emulator no real credentials are needed.
const envPath = resolve(process.cwd(), ".env.local");
const env: Record<string, string> = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

export const app = initializeApp(
  USE_EMULATOR
    ? { apiKey: "fake-emulator-key", projectId: "demo-sada-isolation" }
    : {
        apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
        authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
      },
);

export const auth = getAuth(app);
export const db = getFirestore(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
// storage is not used by the billing flow; keep the export shape.
export const storage = null as unknown as never;

export const RESTAURANT_ID = env.EXPO_PUBLIC_RESTAURANT_ID ?? "sada-main";
