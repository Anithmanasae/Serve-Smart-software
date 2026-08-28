import { router } from "expo-router";
import { SetupWizard, type SetupAnswers } from "@/features/onboarding";

/**
 * TEMPORARY — ONBOARDING_PREVIEW.
 *
 * The first-run wizard, openable from the signup screen so it can be walked
 * through repeatedly during testing. It lives at the ROOT of `app/`, beside
 * login and signup, rather than inside `(app)/` — that group is auth-gated,
 * and a signed-out tester would be bounced to /login before the wizard ever
 * mounted.
 *
 * It answers nothing and saves nothing: `onComplete` returns to signup, same
 * as `(app)/setup.tsx` does today. The real route is that one.
 *
 * TO REMOVE when testing is done: delete this file, delete
 * `src/features/onboarding/PreviewOnboardingButton.tsx`, and delete the two
 * lines in `app/signup.tsx` tagged `ONBOARDING_PREVIEW`.
 */
export default function SetupPreviewRoute() {
  const handleComplete = (answers: SetupAnswers) => {
    console.log("[setup preview] answers (not saved):", answers);
    router.back();
  };

  return (
    <SetupWizard
      // A stand-in for the name the owner would have just typed at
      // registration — the welcome card has a slot for it, and an empty one
      // wouldn't show how it reads. Deliberately NOT "Smart Serve <anything>":
      // a placeholder built out of the product's own name reads as the app
      // announcing itself as a café rather than as this owner's restaurant.
      restaurantName="Ravi's Kitchen"
      // The preview always shows the FIRST-RUN wording — that is the version
      // being judged.
      mode="firstRun"
      onComplete={handleComplete}
      onExit={() => router.back()}
    />
  );
}
