/** Map Firebase auth/Firestore error codes to messages a restaurant staffer
 *  can act on. Shared by the sign-in and sign-up screens. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
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
