/**
 * An error whose `message` is ALREADY written for the person reading it.
 *
 * The default arm below is a catch-all — "Something went wrong" — and it has
 * to be, because a raw Firebase or JS error is not something to show a
 * restaurant owner. But several failures in this app are diagnosed at a point
 * that knows far more than a code does: "no restaurant found for that join
 * code", "this account isn't linked to any restaurant", "Google sign-in isn't
 * set up for this build". Those sentences were being written and then thrown
 * away by the catch-all, because a hand-made `Error` carries no `code`.
 *
 * Throwing this instead marks a message as intended for the screen. It is a
 * class rather than a flag on the message so that nothing has to guess from
 * the text whether it is safe to show.
 *
 * This module deliberately imports NOTHING: `signupApi` throws these, and
 * `signupApi` has to keep running under plain Node for the e2e suites.
 */
export class AuthMessageError extends Error {}

/** Map Firebase auth/Firestore error codes to messages a restaurant staffer
 *  can act on. Shared by the sign-in and sign-up screens. */
export function friendlyAuthError(e: unknown): string {
  // Already a sentence for this exact failure, written where the context was.
  if (e instanceof AuthMessageError) return e.message;

  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    // The email behind this Google account already has a password login here.
    // Firebase will link them the moment the password is used once, so the
    // instruction is "sign in the old way", not "pick another account".
    case "auth/account-exists-with-different-credential":
      return (
        "This email already has a Smart Serve account with a password. " +
        "Sign in with your email and password instead."
      );
    // The Google credential was rejected — nearly always a clock skew or a
    // token that sat too long between the picker and Firebase.
    case "auth/invalid-credential-or-provider-id":
    case "auth/invalid-verification-code":
      return "Google sign-in expired. Tap Continue with Google again.";
    case "auth/operation-not-allowed":
      // Google is not switched on in the Firebase console for this project.
      return (
        "Google sign-in isn't enabled for this app yet. Use your email and " +
        "password, or contact support."
      );
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in.";
    case "auth/weak-password":
      return "Password is too weak — use at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a minute and try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your admin.";
    // Firestore rules rejected the profile write (e.g. the cashier seat was
    // claimed by someone else a moment ago).
    case "permission-denied":
      return "Sign-up was not allowed. The cashier seat may already be taken.";
    default:
      return "Something went wrong. Please try again.";
  }
}
