import { useRef, useState } from "react";
import { Alert } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { feel } from "@/lib/feedback";
import { requestNotificationPermission } from "@/lib/notifications";
import { BrandSplash } from "@/components/BrandSplash";
import { SetupWizard, type SetupAnswers } from "@/features/onboarding";
import { completeSetup } from "@/features/onboarding/onboardingApi";
import { markSetupCompleted } from "@/features/onboarding/activation";
import {
  clearPendingSetup,
  readPendingSetup,
} from "@/features/onboarding/pendingSetup";

/**
 * First-run setup, for real.
 *
 * A **pushed** stack screen beside `(tabs)`, so it takes the whole window and
 * the tab bar is out of the way — the owner is deciding what the app is, not
 * navigating it. `(app)/_layout` sends them here automatically while the
 * restaurant carries `needsSetup`, and this screen is what clears it.
 *
 * OWNER ONLY. `_layout` gates on role before routing anyone here, and this
 * screen re-checks: a waiter who deep-links to /setup would otherwise be
 * asked to re-shape a restaurant that is not theirs, and the root-doc write
 * would then be refused by the rules with no explanation on screen.
 */
export default function SetupRoute() {
  const { restaurantName, restaurantId, role, config } = useAuth();
  const [done, setDone] = useState(false);
  /**
   * FIRST RUN IS LATCHED, not re-read.
   *
   * `config.needsSetup` is live, and `completeSetup` DELETES that field as its
   * last write — so by the time the handler is deciding where to send the
   * owner, the value it branched on has already flipped underneath it. Read
   * fresh, the same run is a first run at the top of the handler and a revisit
   * at the bottom: the floor never gets seeded (`seedStarterMenuIfEmpty` is
   * the revisit path and seeds a menu only), `markSetupCompleted` is skipped,
   * and the walkthrough is replaced by an ordinary trip home.
   *
   * Latched on the first render instead, which is before any of this screen's
   * writes exist. `AuthContext` holds the splash until the restaurant doc has
   * answered, so that first render is reading a real value rather than
   * DEFAULT_CONFIG's `needsSetup: false`.
   */
  const firstRunRef = useRef<boolean | null>(null);
  if (firstRunRef.current === null) firstRunRef.current = config.needsSetup;
  const firstRun = firstRunRef.current;

  const isOwner = role === "cashier" || role === "admin";
  if (!isOwner) return <Redirect href="/" />;
  // The write has landed and `handleComplete` has already navigated. Hold the
  // brand splash for that one frame rather than rendering a competing
  // <Redirect href="/">, which used to race the router.replace() into the
  // walkthrough and could win — sending the owner home from a screen that had
  // just decided to send them somewhere else.
  if (done) return <BrandSplash />;

  const handleComplete = async (answers: SetupAnswers) => {
    try {
      const { seeded } = await completeSetup(answers, firstRun);
      // The write landed — this is the beat that means the app is now theirs.
      feel.success();

      // The anchor every activation nudge is measured from. Local and
      // instant, so it can be awaited here without holding the screen.
      if (firstRun && restaurantId) await markSetupCompleted(restaurantId);

      if (!seeded) {
        Alert.alert(
          "Setup saved",
          "Your app is set up, but the starter menu couldn't be added. " +
            "You can add your dishes from Account → Menu Management."
        );
      }

      setDone(true);
      // ANSWERS rather than `config`: the root-doc write has landed but the
      // snapshot carrying it back may not have, so `config.tablesEnabled`
      // can still be the default `true` here and would send a food truck to
      // a floor it just said it does not have. A returning owner re-running
      // the wizard from Account goes to their usual home instead.
      // FIRST RUN GOES TO THE WALKTHROUGH, not to the floor.
      //
      // The wizard's last button promises "take your first order", and the
      // floor is where that happens — but a floor of six identical empty
      // tiles is not an answer to the only question a new owner has, which is
      // "what is this and can I work it?". The practice run answers it in
      // ninety seconds and then hands them the floor itself.
      //
      // Read off the ANSWERS rather than `config`: the root-doc write has
      // landed but the snapshot carrying it back may not have, so
      // `config.tablesEnabled` can still be the default `true` here and would
      // send a food truck to a floor it just said it does not have. A
      // returning owner re-running the wizard from Account goes home instead.
      router.replace(
        firstRun
          ? ("/practice" as never)
          : ("/" as never)
      );

      // AFTER the navigation, and deliberately NOT awaited.
      //
      // Android 13+ raises a system dialog here, which BACKGROUNDS the app.
      // Awaiting it before navigating parked the owner on the wizard while
      // Firestore's listen stream tore down and re-established underneath —
      // and the profile listener read the empty snapshot that came back as
      // "this account was deleted" and locked them out of their brand-new
      // restaurant. `AuthContext` no longer draws that conclusion, but there
      // is still no reason to hold a navigation behind a dialog: it fires on
      // the floor screen, one beat after they arrive, with the wizard's
      // footnote still fresh. Nothing depends on the answer — a refusal costs
      // the nudges and nothing else.
      if (firstRun) void requestNotificationPermission();
    } catch (e) {
      feel.error();
      Alert.alert(
        "Couldn't save your setup",
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  return (
    <SetupWizard
      restaurantName={restaurantName ?? undefined}
      mode={firstRun ? "firstRun" : "revisit"}
      onComplete={handleComplete}
      // No way out while setup is still owed — the app behind this screen has
      // no menu and no floor yet. Reached by hand afterwards, it backs out.
      onExit={firstRun ? undefined : () => router.back()}
    />
  );
}
