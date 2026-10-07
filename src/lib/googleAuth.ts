/**
 * "Continue with Google" — the NATIVE EDGE.
 *
 * This is the ONLY file in the app that touches
 * `@react-native-google-signin/google-signin`. Everything above it deals in a
 * plain `GoogleAccount` and never learns which library produced it, the same
 * way no screen knows whether `printerService` is talking over Bluetooth or
 * USB, and the same way `lib/billing/nativeIap.ts` fences off `expo-iap`.
 *
 * ## The load-bearing decisions
 *
 * - **It is a NATIVE module, so it only exists in an APK built after it
 *   landed.** Expo Go and every older install get `isGoogleAuthAvailable()
 *   === false` and simply do not draw the button — they keep the email and
 *   password form, which has always worked and still does. A login screen
 *   must never white-screen because a sign-in method is missing, and a button
 *   that is present but always fails is worse than one that is absent.
 * - **An unset `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` also means unavailable.**
 *   The id is a build-time constant that has to come out of the Firebase
 *   console; without it `signIn()` fails with Android's `DEVELOPER_ERROR`,
 *   which says nothing to anybody. Treating "not configured" exactly like
 *   "not installed" is what keeps a half-set-up build from showing a button
 *   that cannot work.
 * - **A lazy `require`, not a static import.** A static import is hoisted and
 *   evaluated the moment anything touches this module, which on a build
 *   without the native side throws during import — before any try/catch of
 *   ours can run. Same reason `kitchenChime` does it.
 * - **Cancelling is not an error.** Backing out of the account picker is the
 *   most common outcome after "signed in", and it returns `null` so the
 *   caller renders nothing at all. An owner who changed their mind must not
 *   be shown a red line telling them something went wrong.
 * - **We sign OUT of Google before every sign-in.** Google caches the last
 *   account and will otherwise re-use it silently. On a restaurant's shared
 *   tablet that hands the next person the previous person's Google account
 *   without ever showing a picker — so the picker is forced every time.
 *
 * What comes back is a Google **ID token**, which is all Firebase wants:
 * `GoogleAuthProvider.credential(idToken)`. The token is verified by Firebase
 * server-side, so nothing here is a security boundary.
 */
import { Platform } from "react-native";
import { AuthMessageError } from "@/features/auth/authErrors";

/**
 * The **web** client id from the Firebase console (Authentication → Sign-in
 * method → Google → Web SDK configuration), NOT the Android one. Google's
 * Android sign-in asks for the web client id on purpose: it is the audience
 * the returned ID token is minted for, and Firebase checks it against the
 * project. Passing the Android client id here is the classic cause of a
 * `DEVELOPER_ERROR` that looks like a signing problem.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

/** What the rest of the app gets back. No library types cross this line. */
export interface GoogleAccount {
  /** The Google ID token, for `GoogleAuthProvider.credential`. */
  idToken: string;
  email: string;
  /** Google's display name. May be empty — callers must cope. */
  name: string;
}

/** Thrown for a failure the user can act on. Extends `AuthMessageError`, so
 *  `friendlyAuthError` shows the message verbatim rather than replacing it
 *  with the catch-all — these sentences know things a code does not. */
export class GoogleAuthError extends AuthMessageError {}

type GoogleSigninModule =
  typeof import("@react-native-google-signin/google-signin");

let mod: GoogleSigninModule | null = null;
let initialised = false;

function init(): void {
  if (initialised) return;
  initialised = true;
  if (Platform.OS === "web") return;
  if (!GOOGLE_WEB_CLIENT_ID) {
    console.warn(
      "[googleAuth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset — the " +
        "Continue with Google button is hidden. See SETUP.md.",
    );
    return;
  }
  try {
    const m: GoogleSigninModule = require("@react-native-google-signin/google-signin");
    // Synchronous, and cheap — it only stores the options for later.
    m.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    mod = m;
  } catch {
    // Native side absent (Expo Go, or an APK built before this landed).
    mod = null;
  }
}

/**
 * Can this build actually sign in with Google?
 *
 * Both screens ask before drawing the button. False on web, in Expo Go, in an
 * older APK, and in any build whose client id was never set.
 */
export function isGoogleAuthAvailable(): boolean {
  init();
  return mod !== null;
}

/**
 * Show the Google account picker.
 *
 * Resolves to `null` if the user backed out — that is a decision, not a
 * failure. Throws `GoogleAuthError` with a sentence worth showing when the
 * flow genuinely could not run.
 */
export async function signInWithGoogle(): Promise<GoogleAccount | null> {
  init();
  const m = mod;
  if (!m) {
    throw new GoogleAuthError("Google sign-in isn't available on this device.");
  }

  if (Platform.OS === "android") {
    try {
      await m.GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    } catch {
      throw new GoogleAuthError(
        "This tablet needs Google Play Services to sign in with Google. " +
          "Use your email and password instead.",
      );
    }
  }

  // Force the picker — see the note about shared tablets above. A device with
  // nothing cached rejects here, which is the ordinary first run.
  await m.GoogleSignin.signOut().catch(() => {});

  let response: Awaited<ReturnType<typeof m.GoogleSignin.signIn>>;
  try {
    response = await m.GoogleSignin.signIn();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // v16 reports a cancel as `{ type: "cancelled" }` rather than by throwing,
    // but the older shape is still reachable through the play-services path.
    if (code === m.statusCodes.SIGN_IN_CANCELLED) return null;
    if (code === m.statusCodes.IN_PROGRESS) return null; // a picker is already up
    if (code === m.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new GoogleAuthError(
        "This tablet needs Google Play Services to sign in with Google. " +
          "Use your email and password instead.",
      );
    }
    if (code === "DEVELOPER_ERROR" || code === "10") {
      // Config, not the user: the app's signing certificate isn't registered
      // with this Firebase project, or the client id is the wrong one. Say
      // that plainly rather than blaming the account.
      console.warn(
        "[googleAuth] DEVELOPER_ERROR — check the SHA-1 fingerprint and " +
          "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID. See SETUP.md.",
      );
      throw new GoogleAuthError(
        "Google sign-in isn't set up for this build. Use your email and " +
          "password, or contact support.",
      );
    }
    throw new GoogleAuthError(
      "Couldn't sign in with Google. Check your connection and try again.",
    );
  }

  if (response.type !== "success") return null; // cancelled

  const { user } = response.data;
  // `idToken` is typed nullable; `getTokens()` is the documented way to get
  // one when the sign-in response didn't carry it.
  let idToken = response.data.idToken;
  if (!idToken) {
    try {
      idToken = (await m.GoogleSignin.getTokens()).idToken;
    } catch {
      idToken = null;
    }
  }
  if (!idToken) {
    throw new GoogleAuthError(
      "Google didn't return a sign-in token. Try again in a moment.",
    );
  }

  return { idToken, email: user.email, name: user.name ?? "" };
}

/**
 * Drop the cached Google account.
 *
 * Called on sign-out so the next person at this tablet is asked which account
 * to use instead of being logged straight back into the last one. Best
 * effort: never let this be the reason a sign-out fails.
 */
export async function forgetGoogleAccount(): Promise<void> {
  init();
  try {
    await mod?.GoogleSignin.signOut();
  } catch {
    /* nothing cached, or no native side — either way there is nothing to do */
  }
}
