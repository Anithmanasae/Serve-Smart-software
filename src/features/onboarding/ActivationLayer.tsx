/**
 * The one place activation is wired into the running app.
 *
 * Everything hangs off a SINGLE `useActivation` call, and that is the point:
 * the coach floating over the tabs, the checklist on Insights and the
 * notification ladder all have to agree about where this owner has got to,
 * and two independent subscriptions to the same question is how they start
 * disagreeing. A provider, not three hooks.
 *
 * It wraps the tab navigator rather than living inside a screen so the coach
 * survives moving between Tables, Order and Bills — which is exactly the trip
 * it is there to narrate. Screens come and go under it; it does not.
 *
 * For anyone who is not a brand-new owner the whole layer costs one
 * AsyncStorage read and then renders nothing but its children forever:
 * `useActivation` graduates permanently the first time the checklist is
 * finished or dismissed, and never subscribes again.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { onNotificationTap } from "@/lib/notifications";
import { useActivation, type Activation } from "./activation";
import { useActivationNudges, type NudgeInput } from "./nudges";

/** Inert by default, so a screen rendered outside the provider (a test, a
 *  future stack screen) reads "nobody is activating" rather than crashing. */
const ActivationContext = createContext<Activation | null>(null);

/**
 * The shared activation state. Returns `null` outside the provider — callers
 * render nothing, which is also the right answer for every established
 * restaurant.
 */
export function useActivationContext(): Activation | null {
  return useContext(ActivationContext);
}

export function ActivationProvider({ children }: { children: ReactNode }) {
  const { restaurantId, role, config, restaurant } = useAuth();
  const isOwner = role === "cashier" || role === "admin";

  const activation = useActivation({
    restaurantId,
    isOwner,
    needsSetup: config.needsSetup,
    // The root doc AuthContext already watches. It carries the retirement
    // marker, so activation ends on every device at once.
    profile: restaurant,
  });

  // `null` whenever there is nothing to nudge about — the hook still runs and
  // clears any alarms an earlier state left scheduled.
  const nudgeInput = useMemo<NudgeInput | null>(() => {
    if (!activation.active || activation.setupAt == null) return null;
    return {
      setupAt: activation.setupAt,
      firstOrderDone: activation.firstOrderDone,
      teamInvited: activation.teamInvited,
      teamPending: activation.teamPending,
      tablesEnabled: config.tablesEnabled,
    };
  }, [
    activation.active,
    activation.setupAt,
    activation.firstOrderDone,
    activation.teamInvited,
    activation.teamPending,
    config.tablesEnabled,
  ]);

  useActivationNudges(nudgeInput);

  // A nudge that opens the app on whatever screen it was last on has wasted
  // the one interruption it was allowed. Mounted here rather than at the root
  // because the routes it targets only exist once the tabs do.
  useEffect(
    () =>
      onNotificationTap((payload) => {
        if (payload.route) router.push(payload.route as never);
      }),
    []
  );

  return (
    <ActivationContext.Provider value={activation}>
      <View style={styles.root}>{children}</View>
    </ActivationContext.Provider>
  );
}

const styles = StyleSheet.create({
  // The navigator fills it and the coach is absolutely positioned inside it,
  // so this box is what "above the tab bar" is measured against.
  root: { flex: 1 },
});
