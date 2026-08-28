import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { BrandSplash } from "@/components/BrandSplash";
import { SetupWizard, type SetupAnswers } from "@/features/onboarding";
import {
  markTourSeen,
  savePendingSetup,
} from "@/features/onboarding/pendingSetup";

/**
 * The FIRST screen on a fresh install — the setup wizard, run before there is
 * an account.
 *
 * The order used to be register → wizard → app, which asked a stranger for an
 * email address and a password before the app had said anything about itself.
 * Now it is wizard → register → app: two questions, a card showing the app
 * shaped around their answers, and only then a form — one they are filling in
 * to keep something they have already seen.
 *
 * It lives at the ROOT of `app/`, beside login and signup, and NOT inside
 * `(app)/`: that group's layout redirects anyone without a profile to /login,
 * so a signed-out prospect would be bounced before this ever mounted.
 *
 * Nothing here is written to a server — there is no restaurant to write to.
 * The answers are stashed on the device by `pendingSetup`, and `(app)/setup`
 * applies them once registration has created something to apply them to.
 *
 * Who does NOT see this:
 *
 * - anyone with a usable profile — they are signed in, and are sent home;
 * - anyone this device has already shown it to, finished or backed out of
 *   (`markTourSeen`), which is what `app/index.tsx` checks before routing
 *   here. That flag is written on BOTH exits, so the tour cannot become a
 *   wall between a returning customer and the login screen.
 */
export default function WelcomeRoute() {
  const { profile, loading, config } = useAuth();

  // Wait for auth before deciding: a signed-in owner reopening the app would
  // otherwise see the tour flash past on the way to their floor screen.
  if (loading) return <BrandSplash />;
  if (profile) return <Redirect href={homePathForRole(profile.role, config)} />;

  const handleComplete = async (answers: SetupAnswers) => {
    // Stash BEFORE navigating: the tour's whole promise is that these
    // questions are not asked twice, and the signup screen also reads this to
    // decide whether to spotlight the trial button.
    await savePendingSetup(answers);
    await markTourSeen();
    // `replace`, not `push` — the tour is finished, and backing out of signup
    // should reach the login screen, not walk back through the questions.
    router.replace("/signup");
  };

  const leaveForLogin = async () => {
    await markTourSeen();
    router.replace("/login");
  };

  return (
    <SetupWizard
      mode="tour"
      onComplete={handleComplete}
      // Backing out of the welcome card is a person saying "not this" — the
      // login screen is where they were headed before the tour got in the way.
      onExit={leaveForLogin}
      onSignIn={leaveForLogin}
    />
  );
}
