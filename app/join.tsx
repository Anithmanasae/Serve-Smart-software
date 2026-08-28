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
import { useAuth, type SignupRole } from "@/features/auth/AuthContext";
import { friendlyAuthError } from "@/features/auth/authErrors";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { feel } from "@/lib/feedback";
import { colors, space, radius } from "@/theme/theme";

/**
 * Staff joining an existing restaurant with the code their manager gave them.
 *
 * This used to be one half of a two-tab signup screen. It moved out to its own
 * route when the app's front door became a **single** owner-facing signup: the
 * app is advertised to restaurant OWNERS, so the screen an ad lands on must
 * have exactly one obvious action. A toggle offering "join" as an equal choice
 * cost real signups — an owner who picked it created a pending account in
 * nobody's restaurant, saw "waiting for approval" forever, and was gone.
 *
 * So the two doors are deliberately unequal. `/signup` is the loud one; this
 * one is reached from a quiet link on the login screen, which is exactly the
 * audience that needs it: someone whose manager has already handed them a
 * code and told them to get the app.
 *
 * The FLOW ITSELF IS UNCHANGED — same `joinRestaurant()`, same server-side
 * rule verifying the submitted code against the restaurant's real one, same
 * pending → cashier-approves gate. Only the address changed.
 */
export default function Join() {
  const { joinRestaurant, profile, config } = useAuth();
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<SignupRole>("waiter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in with a usable account → nothing to join.
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;

  async function onSubmit() {
    if (!joinCode.trim()) {
      feel.error();
      setError("Enter the restaurant's join code.");
      return;
    }
    if (!name.trim()) {
      feel.error();
      setError("Enter your name.");
      return;
    }
    if (!email.trim() || !password) {
      feel.error();
      setError("Enter your email and a password.");
      return;
    }
    if (password !== confirm) {
      feel.error();
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await joinRestaurant(joinCode, name.trim(), email.trim(), password, role);
      // Staff wait on the live "waiting for approval" screen.
      router.replace("/pending");
    } catch (e) {
      feel.error();
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  }

  const roles: { value: SignupRole; label: string; hint: string }[] = [
    { value: "waiter", label: "Waiter", hint: "Takes orders at tables" },
    { value: "kitchen", label: "Kitchen", hint: "Works the kitchen display" },
  ];

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
          <Text style={styles.logo}>🍽️</Text>
          <Text style={styles.title}>Join Your Team</Text>
          <Text style={styles.sub}>
            Your account needs the cashier's approval before you can sign in
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Join code</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="6-character code from your manager"
            placeholderTextColor={colors.textMuted}
            maxLength={8}
          />

          <Text style={styles.label}>I work as</Text>
          <View style={styles.roleRow}>
            {roles.map((r) => (
              <Pressable
                key={r.value}
                style={[styles.roleChip, role === r.value && styles.roleChipOn]}
                onPress={() => {
                  if (role !== r.value) feel.select();
                  setRole(r.value);
                }}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.roleChipText,
                    role === r.value && styles.roleChipTextOn,
                  ]}
                >
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.roleHint}>
            {roles.find((r) => r.value === role)?.hint}
          </Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
          />
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
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />
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
              {busy ? "Creating account…" : "Create Account"}
            </Text>
          </Pressable>

          {/* A pushed screen draws its own way back — there is no header. */}
          <Pressable
            style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
            onPressIn={feel.dismiss}
            disabled={busy}
          >
            <Text style={styles.backText}>
              Already have an account?{" "}
              <Text style={styles.backTextBold}>Sign in</Text>
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
  brand: { alignItems: "center", gap: space.s2 },
  logo: { fontSize: 44 },
  title: { fontSize: 26, fontWeight: "800", color: colors.primary },
  sub: { color: colors.textMuted, textAlign: "center" },
  form: { gap: space.s3 },
  label: { fontSize: 13, color: colors.textMuted, marginTop: space.s2 },
  roleRow: { flexDirection: "row", gap: space.s2, flexWrap: "wrap" },
  roleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  roleChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  roleChipTextOn: { color: colors.textInverse },
  roleHint: { fontSize: 12, color: colors.textMuted },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.s4,
    fontSize: 16,
    color: colors.text,
  },
  codeInput: { letterSpacing: 4, fontWeight: "700" },
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
  backLink: { alignItems: "center", padding: space.s3 },
  backText: { color: colors.textMuted, fontSize: 14 },
  backTextBold: { color: colors.primary, fontWeight: "700" },
});
