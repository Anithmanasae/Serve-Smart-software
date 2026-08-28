/**
 * "Has this owner been offered the practice run?" — one flag, device-local.
 *
 * ## Why local, when graduation is on the restaurant
 *
 * Because this one genuinely IS about the person holding the device. The
 * getting-started checklist described the RESTAURANT ("is this place set
 * up?"), which is why its marker had to live on the restaurant doc — a
 * second tablet asking a months-old business to take its first order was the
 * bug that came from getting that wrong.
 *
 * A walkthrough is the opposite: it is about whether the human looking at
 * this screen has been shown how the app works. The owner's phone and the
 * cashier's tablet may well be two different people, and the second one has
 * learnt nothing from the first one's run. Keyed by restaurant all the same,
 * so a device signed into a new workspace tomorrow is offered it again.
 *
 * Written when the run ENDS, however it ends. Somebody who skipped out has
 * told us they do not want this; re-offering it next launch is how a helpful
 * screen becomes a nuisance. It stays reachable from Account for ever.
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (rid: string) => `practice:done:${rid}`;

export async function markPracticeDone(rid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(rid), "1");
  } catch {
    // A device that cannot persist this is offered the run again. Annoying,
    // never broken — and it is one tap to leave.
  }
}

export async function readPracticeDone(rid: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(rid))) === "1";
  } catch {
    // Treated as DONE on a read failure, deliberately: the cost of wrongly
    // skipping it is an owner who never sees a tutorial, and the cost of
    // wrongly showing it is a tutorial ambushing somebody mid-service.
    return true;
  }
}

/**
 * `null` while unknown — callers must render nothing rather than guess.
 * Guessing "not done" flashes a walkthrough offer at an established
 * restaurant; guessing "done" costs a new owner the run entirely.
 */
export function usePracticeDone(restaurantId: string | null): boolean | null {
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    if (!restaurantId) {
      setDone(null);
      return;
    }
    readPracticeDone(restaurantId)
      .then((v) => live && setDone(v))
      .catch(() => live && setDone(true));
    return () => {
      live = false;
    };
  }, [restaurantId]);

  return done;
}
