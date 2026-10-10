import { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { friendlyAuthError } from "@/features/auth/authErrors";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { feel } from "@/lib/feedback";
import { isValidPhone, localDigits, PHONE_CC, toE164 } from "@/features/auth/phone";
import { GoogleButton } from "@/features/auth/GoogleButton";
import { isGoogleAuthAvailable } from "@/lib/googleAuth";
import { isBillingAvailable } from "@/lib/billing";
import { usePendingSetup } from "@/features/onboarding/pendingSetup";
import { colors, fonts, space, radius, shadow } from "@/theme/theme";

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
 * Registering creates a PERMANENT restaurant. It used to stamp a 3-day clock
 * on the new workspace (`trialStartedAt == request.time`, enforced in
 * firestore.rules); there is no trial any more, and the rules now reject that
 * field outright. This screen is open in every build — a prospect and a real
 * customer take the exact same path, and nothing distinguishes them until you
 * set a deadline on one of them from the Admin SDK.
 *
 * The owner becomes their restaurant's approved CASHIER in the same atomic
 * batch — the one-time owner seat, one per restaurant, enforced server-side.
 *
 * TWO WAYS IN, and the screen is ordered around the difference. First come
 * the two things Google cannot tell us — what the restaurant is called, and a
 * number to ring — so they are asked of everybody. Only then the fork, and
 * after it the email route, which exists to supply the name, address and
 * password that a Google account already carries. Asking before the fork is
 * what stops "Continue with Google" from being a button that opens an account
 * picker and then complains about an empty text box.
 *
 * ONE QUESTION PER STEP, on one route. It used to be a single page: the
 * Google button sat halfway down six text boxes and read as an interruption
 * in one long form, and nothing said the four boxes under it were the
 * alternative rather than more to fill in. Numbering the halves and folding
 * the email fields away did not fix it — the page was still doing two jobs.
 * So each step now holds one question and one way forward. The steps are
 * state, not routes, so everything typed survives a step back and the route
 * guards see a single `/signup`.
 *
 * The Google half is absent, not broken, on a build without the native module
 * or without a client id (`isGoogleAuthAvailable`). Every such build keeps the
 * email form, which is the one that has always worked.
 */
/** `choose` is skipped on a build that cannot do Google — there is no fork. */
type Step = "restaurant" | "choose" | "email";

export default function Signup() {
  const { registerRestaurant, registerRestaurantWithGoogle, profile, config } =
    useAuth();
  // Asked once, at module scope in the wrapper — it cannot change while this
  // screen is mounted (it is a property of the build and the env).
  const googleAvailable = isGoogleAuthAvailable();
  // Answers stashed by the tour on `app/welcome.tsx`. Their presence is the
  // only thing that marks this arrival as "they have already seen the app" —
  // it survives the process being killed on the way here, which a route
  // param would not.
  const pendingSetup = usePendingSetup();
  const fromTour = !!pendingSetup;
  const [restaurantName, setRestaurantName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // The ten NATIONAL digits, never the "+91" — the country code is fixed
  // furniture beside the box (India only, see features/auth/phone.ts) and is
  // added back at submit. Keeping it out of state is what makes the length
  // cap and the validity test straightforward.
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which question is on screen. Every step holds only its own boxes, so an
  // error can only ever be about something the owner is looking at — it used
  // to sit above the submit button whatever it was about, a screen below the
  // Google button that had just been tapped, and the button simply looked dead.
  const [step, setStep] = useState<Step>("restaurant");
  // WHICH signup is in flight, not merely whether one is. Both buttons have to
  // go quiet while either runs — two registrations racing would create two
  // restaurants — but only the one that was pressed should change its own
  // label, and a Google button reading "Creating your restaurant…" while the
  // email button is working describes the wrong thing entirely.
  const [pending, setPending] = useState<null | "email" | "google">(null);
  const busy = pending !== null;

  // The keyboard's own Next key walks the fields, so nobody has to reach for
  // the next box — the split into screens must not cost more than one tap.
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // A build that cannot do Google has no choice to offer, so its second step
  // is the email form and "back" from there is the restaurant.
  const previousStep: Step | null =
    step === "restaurant"
      ? null
      : step === "email" && googleAvailable
        ? "choose"
        : "restaurant";

  // Android's back button is a step back, not a way out of signup: the owner
  // who presses it on "How do you want to sign in?" wants to fix the name
  // they just typed, and leaving the screen would throw that name away.
  useEffect(() => {
    if (!previousStep) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Swallowed, not acted on, while a registration is in flight.
      if (!busy) {
        setError(null);
        setStep(previousStep);
      }
      return true;
    });
    return () => sub.remove();
  }, [previousStep, busy]);

  // Already signed in with a usable account → nothing to sign up for.
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;

  /**
   * The two answers Google cannot give us. Checked before the owner leaves
   * the first step, and again before either registration — authenticating
   * someone and THEN telling them a text box is empty is the worst order to
   * do these two things in.
   */
  function missingRestaurantDetails(): string | null {
    if (!restaurantName.trim()) return "Enter your restaurant's name.";
    // Checked here rather than only on the server: a number nobody can ring
    // is worse than no number, because it looks like a way to reach this
    // customer right up until you try it.
    if (!isValidPhone(phone)) {
      return phone.length === 0
        ? "Enter your mobile number."
        : "Enter a 10-digit Indian mobile number.";
    }
    return null;
  }

  function fail(message: string) {
    feel.error();
    setError(message);
  }

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function onNext() {
    const missing = missingRestaurantDetails();
    if (missing) {
      fail(missing);
      return;
    }
    goTo(googleAvailable ? "choose" : "email");
  }

  async function onGoogle() {
    // Cannot happen through the UI — `onNext` is the only way here — but the
    // registration must never run without them, so send the owner back to
    // the box rather than trust that.
    const missing = missingRestaurantDetails();
    if (missing) {
      setStep("restaurant");
      fail(missing);
      return;
    }
    setError(null);
    setPending("google");
    try {
      const registered = await registerRestaurantWithGoogle(
        restaurantName.trim(),
        toE164(phone),
      );
      // Backed out of Google's picker. Nothing happened, so nothing is said —
      // just give the screen back.
      if (!registered) {
        setPending(null);
        return;
      }
      router.replace("/");
    } catch (e) {
      fail(friendlyAuthError(e));
      setPending(null);
    }
  }

  async function onSubmit() {
    const missing = missingRestaurantDetails();
    if (missing) {
      setStep("restaurant");
      fail(missing);
      return;
    }
    if (!name.trim()) {
      fail("Enter your name.");
      return;
    }
    if (!email.trim() || !password) {
      fail("Enter your email and a password.");
      return;
    }
    if (password !== confirm) {
      fail("Passwords don't match.");
      return;
    }
    setError(null);
    setPending("email");
    try {
      await registerRestaurant(
        restaurantName.trim(),
        name.trim(),
        email.trim(),
        password,
        toE164(phone),
      );
      // The owner is a self-approved cashier → straight into the app.
      router.replace("/");
    } catch (e) {
      fail(friendlyAuthError(e));
      setPending(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Two segments, because that is what the owner is asked: the
              restaurant, then the login. The email form is the second half of
              the second question, not a third — counting it would tell a
              Google signup it had skipped something. */}
          <View style={styles.topRow}>
            {previousStep && (
              <Pressable
                hitSlop={12}
                onPress={() => goTo(previousStep)}
                onPressIn={feel.dismiss}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={24}
                  color={colors.text}
                />
              </Pressable>
            )}
            <View style={styles.progress}>
              <View style={[styles.progressSeg, styles.progressOn]} />
              <View
                style={[
                  styles.progressSeg,
                  step !== "restaurant" && styles.progressOn,
                ]}
              />
            </View>
            <Text style={styles.progressCount}>
              {step === "restaurant" ? "1 of 2" : "2 of 2"}
            </Text>
          </View>

          {step === "restaurant" && (
            <>
              {/* Proof the tour was not a demo that forgot them. Without this
                  the answers vanish into device storage and the form looks
                  like the app asking a stranger to start over. */}
              {fromTour && (
                <View style={styles.savedCard}>
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={styles.savedText}>
                    Your setup is saved. We'll apply it the moment you're in —
                    no questions to answer twice.
                  </Text>
                </View>
              )}

              <View style={styles.heading}>
                <Text style={styles.title}>What is your restaurant called?</Text>
                <Text style={styles.sub}>
                  {fromTour
                    ? "Create your account and your app is ready — set up exactly the way you chose."
                    : "This is the name printed on your bills."}
                </Text>
                {/* Only where it is TRUE. A build that can sell sends the
                    owner to the paywall next, and Google Play asks for a
                    payment method even to start a free trial — "no card
                    needed" one screen before that is a promise broken on the
                    next tap. */}
                {!isBillingAvailable() && (
                  <View style={styles.trialChip}>
                    <Text style={styles.trialChipText}>
                      FREE TO START · NO CARD NEEDED
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.form}>
                <Text style={styles.label}>Restaurant name</Text>
                <TextInput
                  style={styles.input}
                  autoFocus
                  value={restaurantName}
                  onChangeText={setRestaurantName}
                  placeholder="e.g. Smart Serve Restaurant"
                  placeholderTextColor={colors.textMuted}
                  maxLength={60}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                />

                <Text style={styles.label}>Mobile number</Text>
                {/* "+91" is FURNITURE, not a field. It sits inside the same
                    box as the digits so the pair reads as one number, and it
                    cannot be edited — this app is sold in India only (₹, GST,
                    one Play listing), so a country picker would be a question
                    with one answer asked of someone three fields from
                    finishing.

                    No maxLength on the input: a paste of "+91 98765 43210" or
                    "09876543210" has to survive long enough for localDigits()
                    to trim it, and maxLength would chop the tail off first,
                    leaving a number that is wrong by exactly the amount that
                    is hardest to notice. */}
                <View style={styles.phoneRow}>
                  <Text style={styles.phoneCc}>{PHONE_CC}</Text>
                  <View style={styles.phoneDivider} />
                  <TextInput
                    ref={phoneRef}
                    style={styles.phoneInput}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    value={phone}
                    onChangeText={(t) => setPhone(localDigits(t))}
                    placeholder="9876543210"
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={onNext}
                  />
                </View>
                <Text style={styles.hint}>
                  So we can reach you about your restaurant. We don't send
                  marketing.
                </Text>
                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonGap,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={onNext}
                  onPressIn={feel.tap}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.backLink,
                    pressed && { opacity: 0.6 },
                  ]}
                  // Arriving from the tour is a `replace`, so there is no
                  // history to pop and `back()` would do nothing at all — the
                  // one screen where this link matters most is the one where
                  // it would silently fail.
                  onPress={() =>
                    router.canGoBack() ? router.back() : router.replace("/login")
                  }
                  onPressIn={feel.dismiss}
                >
                  <Text style={styles.backText}>
                    Already have an account?{" "}
                    <Text style={styles.backTextBold}>Sign in</Text>
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* THE FORK. Reached only with the restaurant's name and number in
              hand, so "Continue with Google" can never be a button that opens
              an account picker and then complains about an empty text box. */}
          {step === "choose" && (
            <>
              <View style={styles.heading}>
                <Text style={styles.title}>How do you want to sign in?</Text>
                <Text style={styles.sub}>
                  You will use this every time you open the app.
                </Text>
              </View>

              <View style={styles.form}>
                <GoogleButton
                  busy={pending === "google"}
                  disabled={busy}
                  onPress={onGoogle}
                />
                {/* The Google button's twin, so the two read as a pair of
                    equal choices rather than a button and an afterthought. */}
                <Pressable
                  style={({ pressed }) => [
                    styles.emailButton,
                    busy && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => goTo("email")}
                  onPressIn={feel.press}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name="email-outline"
                    size={20}
                    color={colors.text}
                  />
                  <Text style={styles.emailButtonText}>
                    Use email and password
                  </Text>
                  {/* Keeps the label optically centred against the icon. */}
                  <View style={styles.emailIconSpacer} />
                </Pressable>
                {error && <Text style={styles.error}>{error}</Text>}

                {/* What the tap is about to create. The first screen is gone
                    from view, and a typo in the name is far cheaper to catch
                    here than on a printed bill. */}
                <View style={styles.summary}>
                  <Text style={styles.summaryText}>
                    Creating{" "}
                    <Text style={styles.summaryBold}>
                      {restaurantName.trim()}
                    </Text>
                    {" · "}
                    {PHONE_CC} {phone}
                  </Text>
                </View>
              </View>
            </>
          )}

          {step === "email" && (
            <>
              <View style={styles.heading}>
                <Text style={styles.title}>Create your login</Text>
                <Text style={styles.sub}>
                  For{" "}
                  <Text style={styles.summaryBold}>{restaurantName.trim()}</Text>
                  .
                </Text>
              </View>

              <View style={styles.form}>
                <Text style={styles.label}>Your name</Text>
                <TextInput
                  style={styles.input}
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
                <Text style={styles.label}>Email</Text>
                <TextInput
                  ref={emailRef}
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@restaurant.com"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  ref={confirmRef}
                  style={styles.input}
                  secureTextEntry
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={onSubmit}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <TrialButton
                  busy={pending === "email"}
                  disabled={busy}
                  spotlight={fromTour}
                  onPress={onSubmit}
                />
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/**
 * The button that creates the restaurant.
 *
 * It says what it does, and it must not promise a trial: there isn't one any
 * more, and every route to this screen (the login link, the tour's last card)
 * has been brought into line so the button reads as the same step they were
 * offered rather than a different-sounding one. Do not put a duration back in
 * the label without putting the clock back in firestore.rules first.
 *
 * `spotlight` is for the arrival that comes straight off the tour. The ring
 * pulses three times and then STOPS: an attention cue is a sentence, not a
 * state, and a control that pulses forever stops reading as urgent and starts
 * reading as broken. It is drawn behind the button and takes no touches, so
 * the animation can never be the reason a tap misses.
 */
function TrialButton({
  busy,
  disabled,
  spotlight,
  onPress,
}: {
  /** This button's own flow is running — it says so in the label. */
  busy: boolean;
  /** ANY signup on the screen is running, including the Google one. Separate
   *  from `busy` so this button goes quiet during a Google sign-up without
   *  claiming to be creating the restaurant itself. */
  disabled: boolean;
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
          disabled && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={onPress}
        onPressIn={feel.press}
        disabled={disabled}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>
          {busy ? "Creating your restaurant…" : "Create my restaurant"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Top-aligned, not centred: the question has to sit in the same place on
  // every step, and the buttons have to stay clear of the keyboard.
  scroll: {
    flexGrow: 1,
    padding: space.s6,
    gap: space.s6,
  },
  // Fixed height so the bar does not jump when the back arrow appears.
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    height: 24,
  },
  progress: { flex: 1, flexDirection: "row", gap: space.s1 },
  progressSeg: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  progressOn: { backgroundColor: colors.primary },
  progressCount: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  heading: { gap: space.s2 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  trialChip: {
    alignSelf: "flex-start",
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
  summary: {
    marginTop: space.s3,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  summaryText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  summaryBold: { color: colors.text, fontWeight: "700" },
  // The Google button's twin — same outline, same height — so the two read as
  // a pair of equal choices rather than a main button and an afterthought.
  emailButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: space.s4,
  },
  emailButtonText: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  emailIconSpacer: { width: 20 },
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
  hint: { color: colors.textMuted, fontSize: 12, marginTop: -space.s1 },

  // Mirrors `input` exactly — same surface, border, radius and height — so
  // the country code reads as part of the field rather than as a chip parked
  // next to it. Padding moves onto the children so the digits still start
  // where every other field's text starts.
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  phoneCc: {
    paddingHorizontal: space.s4,
    paddingVertical: space.s4,
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: "600",
  },
  phoneDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: space.s2,
    backgroundColor: colors.border,
  },
  phoneInput: {
    flex: 1,
    padding: space.s4,
    fontSize: 16,
    color: colors.text,
  },

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
  buttonGap: { marginTop: space.s3 },
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
