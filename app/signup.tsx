import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { friendlyAuthError } from "@/features/auth/authErrors";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { feel } from "@/lib/feedback";
// ONBOARDING_PREVIEW (temporary — see PreviewOnboardingButton for how to remove)
import { PreviewOnboardingButton } from "@/features/onboarding/PreviewOnboardingButton";
import { usePendingSetup } from "@/features/onboarding/pendingSetup";
import { colors, space, radius, shadow } from "@/theme/theme";

/**
 * The front door: a restaurant OWNER registering their own workspace.
 *
 * ONE PATH, deliberately. This screen used to carry a "Join a restaurant /
 * New restaurant" toggle, and the join half now lives at `/join`, reached from
 * a quiet link on the login screen. The split matters because the app is
 * advertised to owners: whoever arrives here came from an ad about running a
 * restaurant, and a 50/50 toggle offered them a way to get it wrong. An owner
 * who tapped "Join" created a pending account in nobody's restaurant, watched
 * a "waiting for approval" screen that no one would ever approve, and was a
 * lost signup. Staff have a manager telling them where to tap; ad traffic has
 * only this screen, so this screen does one thing.
 *
 * Registering IS the trial. The server stamps a 3-day clock on the new
 * workspace (`trialStartedAt == request.time`, enforced in firestore.rules),
 * so this is open in every build — a prospect and a real customer take the
 * exact same path, and the difference is whether you activate them afterwards.
 *
 * The owner becomes their restaurant's approved CASHIER in the same atomic
 * batch — the one-time owner seat, one per restaurant, enforced server-side.
 */
export default function Signup() {
  const { registerRestaurant, profile, config } = useAuth();
  // Answers stashed by the tour on `app/welcome.tsx`. Their presence is the
  // only thing that marks this arrival as "they have already seen the app" —
  // it survives the process being killed on the way here, which a route
  // param would not.
  const pendingSetup = usePendingSetup();
  const fromTour = !!pendingSetup;
  const [restaurantName, setRestaurantName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in with a usable account → nothing to sign up for.
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;

  async function onSubmit() {
    if (!restaurantName.trim()) {
      feel.error();
      setError("Enter your restaurant's name.");
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
      await registerRestaurant(
        restaurantName.trim(),
        name.trim(),
        email.trim(),
        password,
      );
      // The owner is a self-approved cashier → straight into the app.
      router.replace("/");
    } catch (e) {
      feel.error();
      setError(friendlyAuthError(e));
      setBusy(false);
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
          <Text style={styles.logo}>🍽️</Text>
          <Text style={styles.title}>
            {fromTour ? "One last step" : "Set Up Your Restaurant"}
          </Text>
          <Text style={styles.sub}>
            {fromTour
              ? "Create your account and your app is ready — set up exactly the way you chose."
              : "Create your restaurant and its owner (cashier) account"}
          </Text>
          <View style={styles.trialChip}>
            <Text style={styles.trialChipText}>
              FREE FOR 3 DAYS · NO CARD NEEDED
            </Text>
          </View>
        </View>

        {/* Proof the tour was not a demo that forgot them. Without this the
            answers vanish into device storage and the form looks like the
            app asking a stranger to start over. */}
        {fromTour && (
          <View style={styles.savedCard}>
            <MaterialCommunityIcons
              name="check-circle"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.savedText}>
              Your setup is saved. We'll apply it the moment you're in — no
              questions to answer twice.
            </Text>
          </View>
        )}

        <View style={styles.form}>
          <Text style={styles.label}>Restaurant name</Text>
          <TextInput
            style={styles.input}
            value={restaurantName}
            onChangeText={setRestaurantName}
            placeholder="e.g. Smart Serve Restaurant"
            placeholderTextColor={colors.textMuted}
            maxLength={60}
          />

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
          <TrialButton busy={busy} spotlight={fromTour} onPress={onSubmit} />

          <Pressable
            style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.6 }]}
            // Arriving from the tour is a `replace`, so there is no history
            // to pop and `back()` would do nothing at all — the one screen
            // where this link matters most is the one where it would silently
            // fail.
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/login")
            }
            onPressIn={feel.dismiss}
            disabled={busy}
          >
            <Text style={styles.backText}>
              Already have an account?{" "}
              <Text style={styles.backTextBold}>Sign in</Text>
            </Text>
          </Pressable>

          {/* ONBOARDING_PREVIEW (temporary) */}
          <PreviewOnboardingButton />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * The button that starts the trial.
 *
 * It says what it does. "Create Restaurant" was accurate and told a prospect
 * nothing about the thing they were promised on the way in — every route to
 * this screen (the ad, the login link, the tour's last card) says "3-day free
 * trial", and the button they finally reach should be recognisably the same
 * offer rather than a different-sounding administrative step.
 *
 * `spotlight` is for the arrival that comes straight off the tour. The ring
 * pulses three times and then STOPS: an attention cue is a sentence, not a
 * state, and a control that pulses forever stops reading as urgent and starts
 * reading as broken. It is drawn behind the button and takes no touches, so
 * the animation can never be the reason a tap misses.
 */
function TrialButton({
  busy,
  spotlight,
  onPress,
}: {
  busy: boolean;
  spotlight: boolean;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spotlight) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        // Snap back invisibly — the ring is already fully faded by here, so
        // there is nothing to see travelling in the other direction.
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
      { iterations: 3 }
    );
    anim.start();
    return () => anim.stop();
  }, [spotlight, pulse]);

  return (
    <View style={styles.buttonWrap}>
      {spotlight && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.6, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.06],
                  }),
                },
              ],
            },
          ]}
        />
      )}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          spotlight && styles.buttonSpotlit,
          busy && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onPress}
        onPressIn={feel.press}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>
          {busy ? "Creating your restaurant…" : "Start my 3-day free trial"}
        </Text>
      </Pressable>
    </View>
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

  savedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  savedText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },

  buttonWrap: { marginTop: space.s3 },
  // Inset by the width it will grow, so the ring starts flush with the
  // button's edge instead of hanging outside it before the pulse begins.
  pulseRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: space.s4,
    alignItems: "center",
  },
  buttonSpotlit: shadow.card,
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  buttonText: { color: colors.textInverse, fontSize: 16, fontWeight: "700" },
  backLink: { alignItems: "center", padding: space.s3 },
  backText: { color: colors.textMuted, fontSize: 14 },
  backTextBold: { color: colors.primary, fontWeight: "700" },
});
