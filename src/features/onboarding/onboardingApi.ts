/**
 * Committing the setup wizard's answers.
 *
 * Three writes, in a deliberate ORDER, because the marker is what makes an
 * interrupted setup safe:
 *
 *   1. the config onto the restaurant root doc — what the app IS from now on,
 *   2. the starter menu and floor the answers imply,
 *   3. `needsSetup` deleted, which is the app's "setup is finished" latch.
 *
 * If the owner kills the app between any two of these, `needsSetup` is still
 * true, so the next launch puts them back in the wizard and the whole thing
 * runs again. Every write here is idempotent — fixed document ids, `merge`
 * on the profile — so running it twice lands exactly where running it once
 * did. Doing step 3 first would strand a restaurant with no menu and no way
 * back to the screen that seeds one.
 *
 * The config goes on the RESTAURANT, not in the device-local settings store:
 * a waiter's phone and the cashier's tablet have to agree about whether this
 * restaurant has a kitchen display. `firestore.rules` already allows an
 * admin/cashier to update the root profile, so no rules change was needed —
 * the fields ride along with the name the owner can already edit.
 */
import { deleteField, serverTimestamp, setDoc } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";
import {
  seedStarterData,
  seedStarterMenuIfEmpty,
} from "@/features/auth/starterData";
import type { RestaurantProfile } from "@/types/models";
import { businessTypeDef, type SetupAnswers } from "./setupTypes";

export interface SetupResult {
  /** False when the menu/floor write failed — setup still completed. True
   *  when it succeeded, and when a re-run found a menu already in place and
   *  correctly left it alone. */
  seeded: boolean;
}

export async function completeSetup(
  answers: SetupAnswers,
  /**
   * Whether this is the restaurant's FIRST run — which decides how much gets
   * seeded, not whether anything does.
   *
   * The wizard is also reachable from Account → How you work, long after the
   * owner has typed in their real menu. Seeding the FLOOR there would
   * resurrect tables they had deleted, because the starter documents have
   * fixed ids and would simply be re-written, so the floor is first-run only
   * and Table Setup owns it from then on. The MENU is different: it is
   * back-filled on every run, but only onto a restaurant that has no menu at
   * all (`seedStarterMenuIfEmpty`), so an owner's own dishes are never
   * touched and an owner whose first-run seed missed is not left staring at
   * an empty order screen with no way back to the screen that seeds one.
   */
  firstRun: boolean
): Promise<SetupResult> {
  const def = businessTypeDef(answers.businessType);

  // 1. What the app is from now on. `merge` — this doc also holds the name,
  //    the join code and the trial clock, none of which this screen owns.
  await setDoc(
    paths.restaurantProfile(),
    {
      businessType: answers.businessType,
      kotEnabled: answers.kotEnabled,
      gstEnabled: answers.gstEnabled,
      // Separate from the value, and this is the field the checklist reads.
      // `gstEnabled` is written `true` at registration, so on its own it
      // cannot tell "the owner chose to charge GST" from "nobody has ever
      // been asked" — and those two want opposite things from the app.
      gstDecidedAt:
        serverTimestamp() as unknown as RestaurantProfile["gstDecidedAt"],
      // Derived, not asked: "no tables" is what a table count of zero MEANS,
      // and storing both an answer and its consequence is how the two drift
      // apart. A restaurant with a floor has tables enabled by definition.
      tablesEnabled: answers.tableCount > 0,
      updatedAt: serverTimestamp() as unknown as RestaurantProfile["updatedAt"],
    },
    { merge: true }
  );

  // 2. A menu for the kind of place this is, and only as many tables as they
  //    said they have. Every business type has a menu and an unrecognised one
  //    falls back to a real menu, so no answer on any card of this wizard can
  //    produce a restaurant with nothing to sell. Neither call throws.
  const seeded = firstRun
    ? await seedStarterData(
        answers.businessType,
        def.hasFloor ? answers.tableCount : 0
      )
    : await seedStarterMenuIfEmpty(answers.businessType);

  // 3. The latch. Deleted rather than set false so "has this restaurant been
  //    set up?" stays a question about a field's ABSENCE, matching how the
  //    trial fields and the config defaults already work.
  await setDoc(
    paths.restaurantProfile(),
    { needsSetup: deleteField() },
    { merge: true }
  );

  return { seeded };
}
