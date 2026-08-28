/**
 * `/practice` — the guided run a new owner takes before their real first one.
 *
 * A pushed screen outside the tab navigator, like the other five, because it
 * owns the whole display for the ninety seconds it lasts: a tab bar
 * underneath would offer a way to wander off mid-lesson and come back to a
 * half-finished order that exists nowhere.
 *
 * Owner-only, and read-only. It subscribes to the menu so the run happens on
 * this restaurant's real dishes at their real prices, and writes nothing at
 * all — see `practiceState.ts`.
 */
import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { useMenuCategories, useMenuItems } from "@/features/menu/useMenuData";
import { firstRunPathForRole } from "@/features/auth/roleRoutes";
import { PracticeRun, markPracticeDone } from "@/features/onboarding/practice";
import { colors } from "@/theme/theme";

export default function PracticeRoute() {
  const { role, config, restaurantId, restaurantName, restaurant } = useAuth();
  const { gstEnabled } = useSettings();
  const menu = useMenuItems();
  const categories = useMenuCategories();

  const isOwner = role === "cashier" || role === "admin";

  const exit = useCallback(
    (_reason: "finished" | "skipped") => {
      // Recorded either way. Somebody who skipped out has told us they do not
      // want this, and offering it again on the next launch is how a helpful
      // screen becomes a nuisance. It stays available from Account.
      if (restaurantId) void markPracticeDone(restaurantId);
      router.replace(
        (role ? firstRunPathForRole(role, config) : "/") as never
      );
    },
    [restaurantId, role, config]
  );

  if (!isOwner) return <Redirect href="/" />;
  // Setup is still owed — the menu this run needs has not been seeded yet.
  if (config.needsSetup) return <Redirect href="/setup" />;

  if (menu.loading || categories.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // No menu, no run. The wizard seeds one and is best-effort about it
  // (`seedStarterData` never throws), so a restaurant CAN arrive here with
  // nothing to sell — and the "tap a dish" step would then be an instruction
  // the owner cannot carry out, with no way forward but the Skip button.
  // Sending them to the floor is the honest outcome; Account → Menu is where
  // they fix it, and the walkthrough is waiting there when they have.
  if (menu.data.length === 0) {
    return <Redirect href={(role ? firstRunPathForRole(role, config) : "/") as never} />;
  }

  return (
    <PracticeRun
      config={config}
      menu={menu.data}
      categories={categories.data}
      restaurantName={restaurantName}
      addressLine={restaurant?.addressLine ?? null}
      gstEnabled={gstEnabled}
      onExit={exit}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
