/**
 * Setup — a welcome, two or three questions, and a card that says what
 * changed.
 *
 * It runs in three places, and `SetupMode` is the difference between them:
 * as the first thing a PROSPECT sees on a fresh install, before there is an
 * account (`app/welcome.tsx`); as first-run setup the moment an owner
 * registers (`(app)/setup.tsx`); and from Account, months later, when they
 * change their mind. Same cards, same questions, three different truths about
 * what exists yet — which is all the copy has to be careful about.
 *
 * It exists because the
 * app cannot be one shape for a food truck and a 40-cover restaurant at the
 * same time. The answers decide what the app IS for that restaurant: whether
 * there is a kitchen display and a Send-KOT step at all, whether there is a
 * floor of tables, and which starter menu lands in Menu Management.
 *
 * The load-bearing decisions, all of them about SPEED — this is the first
 * thing a paying customer touches, and a setup form is a bad first sentence:
 *
 * - **One question per card, and tapping an answer advances.** No Next
 *   button anywhere in the question run. The whole wizard is two or three
 *   taps, which is short enough that nobody looks for a "skip".
 * - **The kitchen-ticket question has NO pre-selected answer.** Every other
 *   default in here can be changed later without consequence; that one
 *   decides whether half the app exists, so it gets asked properly rather
 *   than defaulted past. The delay before the card swaps is what lets the
 *   answer light up under the finger first — instant is not the same as fast.
 * - **The last card is a receipt, not a "You're all set!"** Setup that says
 *   nothing looks like setup that did nothing, so each answer gets a line
 *   naming what it changed (see `describeSetup`).
 * - **Nothing is written until the last card's button.** Back works all the
 *   way through, including out of the summary, so an answer is never a trap.
 *
 * The screen itself only COLLECTS. `onComplete` hands the answers to the
 * caller, which writes them to the restaurant root doc and seeds the starter
 * menu (`onboardingApi.completeSetup`); everything downstream — the KDS tab,
 * the Send-KOT button, the billing guard, the floor — reads that config back
 * through `useAuth().config`. Keeping the write out of here is what lets the
 * same component serve the first run and a later change of mind from Account.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { ScreenEnter } from "@/components/ScreenEnter";
import { BrandMark } from "@/components/BrandLogo";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import {
  BUSINESS_TYPES,
  TABLE_CHOICES,
  businessTypeDef,
  describeSetup,
  type BusinessType,
  type SetupAnswers,
} from "./setupTypes";

/** How long an answer stays lit before the next card arrives. Under ~120ms
 *  the tint never registers and the card looks like it swapped by itself. */
const ADVANCE_DELAY_MS = 150;

type StepId = "welcome" | "type" | "kot" | "gst" | "tables" | "done";

/**
 * WHO is answering, which is the only thing that varies between the three
 * places these same cards appear:
 *
 * - `firstRun` — an owner who registered ninety seconds ago. Their restaurant
 *   exists, it is empty, and finishing seeds a starter menu into it.
 * - `revisit`  — Account → How you work, months later. Re-shapes the app and
 *   touches no data, so it must not claim to have seeded anything.
 * - `tour`     — a PROSPECT, before there is an account at all. Nothing is
 *   written when they finish; the answers are stashed on the device and the
 *   last card sends them to signup. Every line of copy that says "your
 *   restaurant is ready" or "you're all set" would be a lie here, which is
 *   why this is a third mode and not a second boolean.
 */
export type SetupMode = "firstRun" | "revisit" | "tour";

export interface SetupWizardProps {
  /** Named on the welcome card — the owner just typed it, so it proves the
   *  registration landed before any of this is asked of them. Absent on the
   *  tour, where they have not typed anything yet. */
  restaurantName?: string;
  /** Called from the final card. Awaited: the button holds while it runs, so
   *  the next pass can write the config without the screen racing ahead. */
  onComplete: (answers: SetupAnswers) => void | Promise<void>;
  /** Back out of the welcome card. Absent = the welcome card has no back. */
  onExit?: () => void;
  /** See `SetupMode`. */
  mode?: SetupMode;
  /**
   * TOUR ONLY — the way out for someone who already has an account and is
   * only here because this device has never been used. The back chevron does
   * the same job, but a returning customer reinstalling the app should not
   * have to work out that a chevron is how they reach a login screen.
   */
  onSignIn?: () => void;
}

export function SetupWizard({
  restaurantName,
  onComplete,
  onExit,
  mode = "firstRun",
  onSignIn,
}: SetupWizardProps) {
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [kotEnabled, setKotEnabled] = useState<boolean | null>(null);
  const [gstEnabled, setGstEnabled] = useState<boolean | null>(null);
  const [tableCount, setTableCount] = useState<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const def = businessType ? businessTypeDef(businessType) : null;

  // A food truck is never asked about tables, so the step list is derived
  // rather than fixed — the dots and the back button both read it, which is
  // why picking "Food truck" makes the wizard visibly shorter.
  const steps = useMemo<StepId[]>(
    () => [
      "welcome",
      "type",
      "kot",
      "gst",
      ...(def?.hasFloor ? (["tables"] as StepId[]) : []),
      "done",
    ],
    [def]
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // Answering advances on a timer, so it has to be cancelled if the screen
  // goes away first (back-swipe out of the wizard mid-tap).
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  const advance = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(
      () => setStepIndex((i) => i + 1),
      ADVANCE_DELAY_MS
    );
  }, []);

  const goBack = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (stepIndex === 0) onExit?.();
    else setStepIndex((i) => Math.max(0, i - 1));
  }, [stepIndex, onExit]);

  const answers: SetupAnswers | null =
    businessType && kotEnabled !== null && gstEnabled !== null
      ? {
          businessType,
          kotEnabled,
          gstEnabled,
          // No floor means no floor, whatever the chips were last left on.
          tableCount: businessTypeDef(businessType).hasFloor
            ? tableCount ?? businessTypeDef(businessType).defaultTables
            : 0,
        }
      : null;

  const handleFinish = async () => {
    if (!answers || busy) return;
    setBusy(true);
    try {
      await onComplete(answers);
      // No feel.success() here: the write is the caller's, so the caller owns
      // the beat that confirms it landed.
    } finally {
      setBusy(false);
    }
  };

  // The dots count QUESTIONS, not cards — the welcome and the summary aren't
  // work the owner has to do, and counting them would make two taps look like
  // four.
  const questionSteps: StepId[] = steps.filter(
    (s) => s !== "welcome" && s !== "done"
  );
  const questionIndex = questionSteps.indexOf(step);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        {step !== "done" && (stepIndex > 0 || onExit) ? (
          <PressableScale
            style={styles.backBtn}
            containerStyle={styles.backHit}
            activeScale={0.92}
            haptic="dismiss"
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={26}
              color={colors.textMuted}
            />
          </PressableScale>
        ) : (
          <View style={styles.backHit} />
        )}

        <View style={styles.dots}>
          {questionIndex >= 0 &&
            questionSteps.map((s, i) => (
              <View
                key={s}
                style={[styles.dot, i === questionIndex && styles.dotOn]}
              />
            ))}
        </View>

        {/* Balances the back button so the dots sit centred. */}
        <View style={styles.backHit} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenEnter replayKey={step} style={styles.card}>
          {step === "welcome" && (
            <WelcomeCard
              restaurantName={restaurantName}
              mode={mode}
              onStart={() => setStepIndex(1)}
              onSignIn={onSignIn}
            />
          )}

          {step === "type" && (
            <Question
              title="What kind of place is this?"
              hint="It sets your starting menu and how the app is laid out."
            >
              {BUSINESS_TYPES.map((t) => (
                <OptionRow
                  key={t.value}
                  icon={t.icon}
                  label={t.label}
                  hint={t.hint}
                  selected={businessType === t.value}
                  onPress={() => {
                    setBusinessType(t.value);
                    advance();
                  }}
                />
              ))}
            </Question>
          )}

          {step === "kot" && (
            <Question
              title="Do orders go to the kitchen?"
              hint="However food actually gets made in your place — there's no wrong answer."
            >
              <OptionRow
                icon="pot-steam"
                label="Yes — send a kitchen ticket"
                hint="Cooks see every order on the kitchen display, or on a printed KOT. You bill once the food is out."
                selected={kotEnabled === true}
                onPress={() => {
                  setKotEnabled(true);
                  advance();
                }}
              />
              <OptionRow
                icon="receipt-text"
                label="No — just take it and bill it"
                hint="Straight from the cart to the bill in one go. No kitchen display, no extra step at the counter."
                selected={kotEnabled === false}
                onPress={() => {
                  setKotEnabled(false);
                  advance();
                }}
              />
            </Question>
          )}

          {/* No option is pre-selected, and neither is phrased as the normal
              one. The old behaviour — GST silently ON, discoverable only by
              scrolling the Account screen — meant an unregistered owner
              charged tax on every bill they printed until an accountant
              noticed. Both answers are ordinary here, and the wrong one is
              now a thing somebody chose rather than a default they never
              met. */}
          {step === "gst" && (
            <Question
              title="Do you charge GST?"
              hint="If you're not GST-registered, say no — you can change this later in Account."
            >
              <OptionRow
                icon="percent"
                label="Yes — add GST to bills"
                hint="Bills show CGST and SGST at 5% on top of the food. Pick this if you are GST-registered."
                selected={gstEnabled === true}
                onPress={() => {
                  setGstEnabled(true);
                  advance();
                }}
              />
              <OptionRow
                icon="percent-outline"
                label="No — the price is the price"
                hint="Bills total up to exactly what is on the menu. Nothing is added."
                selected={gstEnabled === false}
                onPress={() => {
                  setGstEnabled(false);
                  advance();
                }}
              />
            </Question>
          )}

          {step === "tables" && def && (
            <Question
              title="How many tables?"
              hint="A rough number is fine — you can add or remove tables any time."
            >
              <View style={styles.chipWrap}>
                {TABLE_CHOICES.map((n) => (
                  <CountChip
                    key={n}
                    count={n}
                    selected={(tableCount ?? def.defaultTables) === n}
                    onPress={() => {
                      setTableCount(n);
                      advance();
                    }}
                  />
                ))}
              </View>
              <OptionRow
                icon="counter"
                label="We don't have tables"
                hint="Counter service only — the app skips the floor screen entirely."
                selected={tableCount === 0}
                onPress={() => {
                  setTableCount(0);
                  advance();
                }}
              />
            </Question>
          )}

          {step === "done" && answers && (
            <DoneCard
              answers={answers}
              mode={mode}
              busy={busy}
              onFinish={handleFinish}
            />
          )}
        </ScreenEnter>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── cards ────────────────────────────────────────────────────────────────────

/**
 * The first card — and, in `tour` mode, the first thing anyone ever sees of
 * Smart Serve.
 *
 * It has to answer "what IS this?" before it asks for anything, because the
 * Play listing is the only salesperson this product has. So the card leads
 * with what the software is — a restaurant POS and billing system — and
 * proves it with four lines naming the four things it does, rather than
 * opening on a bare "Welcome" that assumes the reader already knows.
 *
 * `revisit` is the exception: Account → How you work is not a first meeting,
 * so it gets neither the pitch nor the feature list.
 */
const WELCOME_FEATURES: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  text: string;
}[] = [
  {
    icon: "silverware-fork-knife",
    text: "Take orders at the table or the counter",
  },
  { icon: "chef-hat", text: "Send them straight to the kitchen" },
  { icon: "receipt", text: "Print the bill, with GST, in a tap" },
  { icon: "chart-line", text: "See what sold and what it made" },
];

function WelcomeCard({
  restaurantName,
  mode,
  onStart,
  onSignIn,
}: {
  restaurantName?: string;
  mode: SetupMode;
  onStart: () => void;
  onSignIn?: () => void;
}) {
  const isRevisit = mode === "revisit";

  return (
    <View style={styles.welcome}>
      {/* The mark in a soft navy halo. A logo floating on the canvas reads as
          a placeholder; sitting it in a disc gives the screen a subject. */}
      <View style={styles.brandHalo}>
        <BrandMark size={52} />
      </View>

      {!isRevisit && (
        <View style={styles.eyebrow}>
          <Text style={styles.eyebrowText}>ALL-IN-ONE RESTAURANT POS</Text>
        </View>
      )}

      <Text style={styles.welcomeTitle}>
        {isRevisit ? "How you work" : "Welcome to Smart Serve"}
      </Text>

      <Text style={styles.welcomeBody}>
        {isRevisit ? (
          "Answer these again to re-shape the app. Your menu, tables and bills are not touched."
        ) : mode === "tour" ? (
          // No name and no "your restaurant is ready" — they have not
          // registered and the card must not pretend otherwise. It says what
          // the software IS, which is the only thing a stranger needs first.
          "Smart Serve runs the whole floor — point of sale, kitchen tickets, billing and reports — on one tablet."
        ) : (
          <>
            {restaurantName ? (
              <>
                <Text style={styles.welcomeName}>{restaurantName}</Text> is
                ready.
              </>
            ) : (
              "Your restaurant is ready."
            )}
            {"\n"}Point of sale, kitchen tickets, billing and reports — one app
            for the whole place.
          </>
        )}
      </Text>

      {!isRevisit && (
        <View style={styles.features}>
          {WELCOME_FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <MaterialCommunityIcons
                  name={f.icon}
                  size={17}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>
      )}

      <PressableScale
        style={styles.cta}
        containerStyle={styles.ctaHit}
        activeScale={0.97}
        haptic="press"
        onPress={onStart}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>
          {mode === "tour" ? "Set it up for my place" : "Set up my app"}
        </Text>
        <MaterialCommunityIcons
          name="arrow-right"
          size={18}
          color={colors.textInverse}
        />
      </PressableScale>
      <Text style={styles.welcomeFoot}>
        {mode === "tour"
          ? "Two quick questions · about 30 seconds · no account needed"
          : mode === "firstRun"
            ? "Two quick questions · about 30 seconds"
            : "Takes about 30 seconds"}
      </Text>

      {/* The returning customer's way out — a reinstall, a new tablet on an
          existing restaurant. Deliberately quiet: it is the rarer of the two
          things someone can want from this card, and it must not compete
          with the button above it. */}
      {mode === "tour" && onSignIn ? (
        <PressableScale
          style={styles.welcomeLink}
          activeScale={0.97}
          haptic="press"
          onPress={onSignIn}
          accessibilityRole="button"
        >
          <Text style={styles.welcomeLinkText}>
            Already have an account?{" "}
            <Text style={styles.welcomeLinkBold}>Sign in</Text>
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function DoneCard({
  answers,
  mode,
  busy,
  onFinish,
}: {
  answers: SetupAnswers;
  mode: SetupMode;
  busy: boolean;
  onFinish: () => void;
}) {
  const def = businessTypeDef(answers.businessType);
  return (
    <View style={styles.welcome}>
      <View style={styles.doneBadge}>
        <MaterialCommunityIcons name="check" size={34} color={colors.primary} />
      </View>
      <Text style={styles.welcomeTitle}>
        {mode === "revisit"
          ? "Updated"
          : mode === "tour"
            ? "This is your app"
            : "You're all set"}
      </Text>
      <Text style={styles.welcomeBody}>
        {mode === "tour"
          ? `Set up for a ${def.label.toLowerCase()} — it'll be waiting exactly like this.`
          : `Smart Serve is now set up for a ${def.label.toLowerCase()}.`}
      </Text>

      {/* The tour seeds a starter menu too — just later, at registration —
          so it reads the same lines the first run does. Only a revisit, which
          genuinely writes nothing but the config, gets the shorter list. */}
      <View style={styles.summary}>
        {describeSetup(answers, mode !== "revisit").map((line) => (
          <View key={line.text} style={styles.summaryRow}>
            <MaterialCommunityIcons
              name={line.icon}
              size={18}
              color={colors.primary}
              style={styles.summaryIcon}
            />
            <Text style={styles.summaryText}>{line.text}</Text>
          </View>
        ))}
      </View>

      <PressableScale
        style={[styles.cta, busy && styles.ctaBusy]}
        containerStyle={styles.ctaHit}
        activeScale={0.97}
        haptic="press"
        onPress={onFinish}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>
          {busy
            ? mode === "tour"
              ? "One moment…"
              : "Setting things up…"
            : mode === "revisit"
              ? "Back to the app"
              : mode === "tour"
                ? // The trial button, at the moment the app has just proved
                  // it understood their restaurant. Naming the trial rather
                  // than the account is the whole point of putting the tour
                  // first: they are agreeing to try THIS, which they have
                  // now seen, not to fill in a form.
                  "Start my 3-day free trial"
                : "Take your first order"}
        </Text>
        {!busy && (
          <MaterialCommunityIcons
            name="arrow-right"
            size={18}
            color={colors.textInverse}
          />
        )}
      </PressableScale>
      {/* PRIMING for the notification permission dialog that `setup.tsx`
          raises the moment this button's write lands. Android shows that
          dialog exactly once — a "deny" is permanent — so it must never be
          the first time the owner hears the idea. One line, no extra tap:
          a pre-permission card of our own would put a question in front of
          a wizard whose whole claim is that it is two taps. */}
      <Text style={styles.welcomeFoot}>
        {mode === "firstRun"
          ? "We'll send a couple of tips while you find your way around. Everything here can be changed later in Account."
          : mode === "tour"
            ? "Free for 3 days. No card needed, and everything here can be changed later."
            : "All of this can be changed later in Account."}
      </Text>
    </View>
  );
}

// ── question pieces ──────────────────────────────────────────────────────────

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.question}>
      <Text style={styles.questionTitle}>{title}</Text>
      <Text style={styles.questionHint}>{hint}</Text>
      <View style={styles.options}>{children}</View>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  hint,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.option, selected && styles.optionOn]}
      // A tall row scaled to 0.9 looks like it is being sucked away; the
      // smaller squeeze reads as the row taking the press.
      activeScale={0.98}
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={[styles.optionIcon, selected && styles.optionIconOn]}>
        <MaterialCommunityIcons
          name={icon}
          size={22}
          color={selected ? colors.textInverse : colors.primary}
        />
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
      {selected && (
        <MaterialCommunityIcons
          name="check-circle"
          size={20}
          color={colors.primary}
        />
      )}
    </PressableScale>
  );
}

function CountChip({
  count,
  selected,
  onPress,
}: {
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.chip, selected && styles.chipOn]}
      activeScale={0.94}
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${count} tables`}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>
        {count}
      </Text>
    </PressableScale>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
  },
  backHit: { width: 40, height: 40, justifyContent: "center" },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: space.s2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  dotOn: { backgroundColor: colors.primary, width: 22 },

  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: space.s5,
  },
  // Capped and centred so the wizard reads as a single column on a
  // counter-mounted tablet instead of a stretched row of wide bars.
  card: { width: "100%", maxWidth: 520, alignSelf: "center" },

  // ── welcome / done ──
  welcome: { alignItems: "center", gap: space.s3 },
  welcomeTitle: {
    fontFamily: fonts.extrabold,
    // 26, not 28: at 28 "Welcome to Smart Serve" breaks after "Smart" on a
    // 360dp phone, which splits the brand name across two lines.
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: colors.text,
    textAlign: "center",
    marginTop: space.s1,
  },
  welcomeName: { fontFamily: fonts.bold, color: colors.text },
  welcomeBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
  },
  welcomeFoot: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
  welcomeLink: { alignItems: "center", paddingVertical: space.s3 },
  welcomeLinkText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
  },
  welcomeLinkBold: { fontFamily: fonts.bold, color: colors.primary },
  // The mark sitting in a soft navy disc. A logo floating loose on the
  // canvas reads as a placeholder waiting for a real one; a disc gives the
  // top of the screen a subject and an edge.
  brandHalo: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  // The category line. It is the one place the app names what it IS, so it
  // is set apart from the prose rather than buried in it.
  eyebrow: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.offerBorder,
    borderRadius: radius.pill,
    paddingVertical: space.s1 + 2,
    paddingHorizontal: space.s3,
  },
  eyebrowText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.primary,
  },

  // Four lines that prove the sentence above them. Left-aligned inside a
  // centred card on purpose: a list is read down its left edge, and centring
  // four ragged lines is what makes a welcome screen look like a poster.
  features: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    gap: space.s3,
    marginTop: space.s1,
    ...shadow.card,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: space.s3 },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },

  doneBadge: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },

  summary: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.s4,
    gap: space.s3,
    marginTop: space.s2,
    ...shadow.card,
  },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: space.s3 },
  summaryIcon: { marginTop: 1 },
  summaryText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },

  ctaHit: { alignSelf: "stretch", marginTop: space.s3 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: space.s4,
    ...shadow.glow,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textInverse,
  },

  // ── questions ──
  question: { gap: space.s2 },
  questionTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: colors.text,
  },
  questionHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  options: { gap: space.s3, marginTop: space.s3 },

  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.s4,
    ...shadow.card,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIconOn: { backgroundColor: colors.primary },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  optionHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.s3 },
  chip: {
    minWidth: 62,
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    ...shadow.card,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  chipTextOn: { color: colors.textInverse },
});
