import { Tabs } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { useResponsive } from "@/lib/responsive";
import { TABS, TabBar, canSeeTab } from "@/components/TabBar";

/**
 * The app's top-level navigator.
 *
 * Tabs show every module the user's role may access (admins see all); modules
 * outside the role are hidden via `href: null`. Screens reached *from* a tab
 * are not here: they are stack siblings of this navigator, one level up in
 * `app/(app)/_layout.tsx`, so they push and hide the bar.
 *
 * The bar itself is drawn by `<TabBar />` — a Material 3 navigation bar on a
 * phone, a navigation rail on a tablet. Its contents come from `TABS`, which
 * this file also reads, so the screens registered here and the buttons drawn
 * there can't drift apart. Everything else (state, deep links, `lazy`,
 * `freezeOnBlur`) is still the navigator's.
 */
export default function TabsLayout() {
  const { profile } = useAuth();
  // The (app) stack has already gated on auth and redirected if there is no
  // profile; this only narrows the type for the role checks below.
  const { isTablet } = useResponsive();
  if (!profile) return null;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Don't mount hidden tabs up front, and freeze them once blurred so
        // background screens skip re-renders from live Firestore snapshots.
        lazy: true,
        freezeOnBlur: true,
        // A cross-fade, not the `shift` slide. Two reasons: `lazy` above means
        // a tab's first visit mounts empty, and a slide carries that emptiness
        // across the glass where a dissolve hides it; and a slide asserts a
        // left/right order that six unrelated modules don't have. It also
        // matches `feel.select()` — the lightest tick in the vocabulary should
        // not be paired with the heaviest motion.
        animation: "fade",
        // Bottom bar on a phone, left rail from 600dp up (Material 3's
        // breakpoint, and `useResponsive`'s shorter-edge rule keeps a phone in
        // landscape on the bar where the thumb can still reach it). React
        // Navigation lays the scene out beside the rail, so no screen needs to
        // know which one it got.
        tabBarPosition: isTablet ? "left" : "bottom",
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            href: canSeeTab(tab, profile.role) ? tab.href : null,
          }}
        />
      ))}
      {/* No Account tab. It is a stack screen reached from the profile button
          in each screen's header — see `src/components/ProfileButton.tsx`.
          The bar is for the modules a shift moves between; settings are not
          one, and the slot is worth more to the six that are. */}
    </Tabs>
  );
}
