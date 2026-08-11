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

type Mode = "create" | "join";

/**
 * Self-service onboarding, two paths:
 *
 *  - "New restaurant": the owner names their restaurant and becomes its
 *    approved cashier in one atomic registration (their own one-time owner
 *    seat — every restaurant gets exactly one, enforced server-side). This is
 *    also the TRIAL entry point: the server stamps a 2-day clock on the new
 *    workspace, and it stays a trial until the owner is activated by hand.
 *  - "Join a restaurant": staff enter the join code their manager shares
 *    (shown on the cashier's Account screen) and land in the existing
 *    waiting-for-approval flow. They get NO clock of their own — they live or
 *    die with the restaurant they joined.
 *
 * This screen is open in every build. The trial is enforced server-side, so
 * there is nothing to hide: a prospect and a real new customer take the exact
 * same path, and the difference is whether you activate them afterwards.
 */
export default function Signup() {
  const { registerRestaurant, joinRestaurant, profile } = useAuth();
  const [mode, setMode] = useState<Mode>("join");
  const [restaurantName, setRestaurantName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<SignupRole>("waiter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in with a usable account → nothing to sign up for.
  if (profile) return <Redirect href={homePathForRole(profile.role)} />;

  async function onSubmit() {
    if (mode === "create" && !restaurantName.trim()) {
      feel.error();
      setError("Enter your restaurant's name.");
      return;
    }
    if (mode === "join" && !joinCode.trim()) {
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
      if (mode === "create") {
        await registerRestaurant(
          restaurantName.trim(),
          name.trim(),
          email.trim(),
          password,
        );
        // The owner is a self-approved cashier → straight into the app.
        router.replace("/");
      } else {
        await joinRestaurant(joinCode, name.trim(), email.trim(), password, role);
        // Staff wait on the live "waiting for approval" screen.
        router.replace("/pending");
      }
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
          <Text style={styles.title}>
            {mode === "create" ? "Set Up Your Restaurant" : "Join Your Team"}
          </Text>
          <Text style={styles.sub}>
            {mode === "create"
              ? "Create your restaurant and its owner (cashier) account"
              : "Your account needs the cashier's approval before you can sign in"}
          </Text>
          {mode === "create" && (
            <View style={styles.trialChip}>
              <Text style={styles.trialChipText}>
                FREE FOR 2 DAYS · NO CARD NEEDED
              </Text>
            </View>
          )}
        </View>

        <View style={styles.form}>
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeTab, mode === "join" && styles.modeTabOn]}
              onPress={() => {
                if (mode !== "join") feel.select();
                setMode("join");
              }}
              disabled={busy}
            >
              <Text
                style={[styles.modeText, mode === "join" && styles.modeTextOn]}
              >
                Join a restaurant
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeTab, mode === "create" && styles.modeTabOn]}
              onPress={() => {
                if (mode !== "create") feel.select();
                setMode("create");
              }}
              disabled={busy}
            >
              <Text
                style={[styles.modeText, mode === "create" && styles.modeTextOn]}
              >
                New restaurant
              </Text>
            </Pressable>
          </View>

          {mode === "create" ? (
            <>
              <Text style={styles.label}>Restaurant name</Text>
              <TextInput
                style={styles.input}
                value={restaurantName}
                onChangeText={setRestaurantName}
                placeholder="e.g. Brew Brothers Cafe"
                placeholderTextColor={colors.textMuted}
                maxLength={60}
              />
            </>
          ) : (
            <>
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
            </>
          )}

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
              {busy
                ? mode === "create"
                  ? "Creating restaurant…"
                  : "Creating account…"
                : mode === "create"
                  ? "Create Restaurant"
                  : "Create Account"}
            </Text>
          </Pressable>

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
  trialChip: {
    marginTop: space.s1,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  trialChipText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  form: { gap: space.s3 },
  modeRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    alignItems: "center",
  },
  modeTabOn: { backgroundColor: colors.primary },
  modeText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  modeTextOn: { color: colors.textInverse },
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
