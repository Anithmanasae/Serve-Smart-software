import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { friendlyAuthError } from "@/features/auth/authErrors";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { BrandLogo } from "@/components/BrandLogo";
import { DEMO_MODE, FIREBASE_PROJECT_ID } from "@/lib/firebase";
import { AuthDivider, GoogleButton } from "@/features/auth/GoogleButton";
import { isGoogleAuthAvailable } from "@/lib/googleAuth";
import { feel } from "@/lib/feedback";
import { colors, space, radius } from "@/theme/theme";

/**
 * Sign in.
 *
 * "Continue with Google" is here for the same reason it is on `/signup`, and
 * it is NOT optional: an owner who registered with Google has no password at
 * all, so a login screen offering only email and password is a door they hold
 * no key to. It signs people in and creates nothing — a Google account with no
 * restaurant behind it is bounced with the same "not linked" notice an email
 * login gets, rather than quietly being handed a new workspace.
 */
export default function Login() {
  const { signIn, signInWithGoogle, profile, gate, notice, config } = useAuth();
  const googleAvailable = isGoogleAuthAvailable();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which sign-in is running — see the same note on the signup screen. Both
  // buttons go quiet while either works; only the pressed one changes label.
  const [pending, setPending] = useState<null | "email" | "google">(null);
  const busy = pending !== null;

  // Already signed in → go to role home.
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;
  // Signed in but pending/denied/restricted → status screen.
  if (gate) return <Redirect href="/pending" />;

  async function onSubmit() {
    if (!email.trim() || !password) {
      feel.error();
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setPending("email");
    try {
      await signIn(email.trim(), password);
      feel.success(); // the redirect is instant — this is the only "you're in"
    } catch (e) {
      // A wrong password is the most common failure in the app, and the one
      // users are least likely to be watching the screen for.
      feel.error();
      setError(friendlyAuthError(e));
    } finally {
      setPending(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setPending("google");
    try {
      const signedIn = await signInWithGoogle();
      // Backed out of the account picker — a decision, not a failure.
      if (signedIn) feel.success();
    } catch (e) {
      feel.error();
      setError(friendlyAuthError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <BrandLogo size={112} />
          <Text style={styles.sub}>Sign in to continue</Text>
          {/* Build verification you can see without a debugger: WHICH Firebase
              backend this APK talks to. A build can silently pick up EAS's
              stored env vars instead of .env.local, and the only other symptom
              is a valid login being rejected. DEMO_MODE no longer changes any
              behaviour — trials are enforced server-side for every build — so
              this is purely a diagnostic marker for non-production APKs. */}
          {DEMO_MODE && (
            <View style={styles.demoChip}>
              <Text style={styles.demoChipText}>TEST BUILD</Text>
              <Text style={styles.demoChipProject}>{FIREBASE_PROJECT_ID}</Text>
            </View>
          )}
        </View>

        <View style={styles.form}>
          {/* Above the fields, not below the Sign In button: an owner who
              registered with Google has nothing to type here, and making them
              scan past two text boxes to find that out is asking them to
              consider a form that isn't theirs. Absent on a build without the
              native module or a client id — then this is the plain email
              screen it has always been. */}
          {googleAvailable && (
            <>
              <GoogleButton
                busy={pending === "google"}
                disabled={busy}
                onPress={onGoogle}
              />
              <AuthDivider />
            </>
          )}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@restaurant.com"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />
          {/* e.g. bounced because the account isn't linked to a restaurant */}
          {!error && notice && <Text style={styles.error}>{notice}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              busy && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={onSubmit}
            onPressIn={feel.press}
            disabled={busy}
          >
            <Text style={styles.buttonText}>
              {pending === "email" ? "Signing in…" : "Sign In"}
            </Text>
          </Pressable>

          {/* Open in EVERY build. Registering creates a private workspace, so
              one APK can be handed to any number of prospects. It no longer
              starts a clock — there is no free trial, and the copy must not
              promise one (see "THERE IS NO FREE TRIAL" in CLAUDE.md). Hiding
              this used to be the demo build's whole job. */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.signupButton,
              busy && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/signup")}
            onPressIn={feel.press}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Create your restaurant</Text>
          </Pressable>

          {/* The staff door, deliberately quieter than the one above it.
              `/signup` registers a whole restaurant and is what the ads point
              at; this is for someone whose manager has already handed them a
              join code. Both used to be tabs on one screen, which let an
              owner pick the wrong one and strand themselves in a pending
              account belonging to no restaurant. */}
          <Pressable
            style={({ pressed }) => [styles.joinLink, pressed && { opacity: 0.6 }]}
            onPress={() => router.push("/join")}
            onPressIn={feel.press}
            disabled={busy}
          >
            <Text style={styles.joinText}>
              Joining a team?{" "}
              <Text style={styles.joinTextBold}>Enter your join code</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: space.s6,
    gap: space.s6,
  },
  brand: { alignItems: "center", gap: space.s3 },
  sub: { color: colors.textMuted, fontSize: 15 },
  form: { gap: space.s3 },
  label: { fontSize: 13, color: colors.textMuted, marginTop: space.s2 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.s4,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: space.s2 },
  button: {
    marginTop: space.s3,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: space.s4,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  buttonText: { color: colors.textInverse, fontSize: 16, fontWeight: "700" },
  demoChip: {
    marginTop: space.s2,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  demoChipText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  demoChipProject: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
  // Same blue as Sign In: registering a restaurant is the other thing this
  // screen is for, not a footnote under it.
  signupButton: { marginTop: space.s2 },
  // A step down from the signup link in both size and weight — the two doors
  // are not equal, and the screen should say so before either is tapped.
  joinLink: { alignItems: "center", paddingHorizontal: space.s3 },
  joinText: { color: colors.textMuted, fontSize: 13 },
  joinTextBold: { color: colors.textMuted, fontWeight: "700" },
});
