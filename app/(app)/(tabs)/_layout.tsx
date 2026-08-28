import { Tabs } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { useResponsive } from "@/lib/responsive";
import { TABS, TabBar, canSeeTab } from "@/components/TabBar";
import { ActivationProvider } from "@/features/onboarding";

/**
 * The app's top-level navigator.
 *
 * Tabs show every module the user's role may access (admins see all); modules
 * outside the role are hidden via `href: null`. Screens reached *from* a tab
 * are not here: they are stack siblings of this navigator, one level up in
 * `app/(app)/_layout.tsx`, so they push and hide the bar. The one exception is
 * a table's order, which pushes *within* the Order tab and so keeps the bar —
 * see `order/_layout.tsx`.
 *
 * The bar itself is drawn by `<TabBar />` — a Material 3 navigation bar on a
 * phone, a navigation rail on a tablet. Its contents come from `TABS`, which
 * this file also reads, so the screens registered here and the buttons drawn
 * there can't drift apart. Everything else (state, deep links, `lazy`,
 * `freezeOnBlur`) is still the navigator's.
 */
export default function TabsLayout() {
  const { profile, config } = useAuth();
  // The (app) stack has already gated on auth and redirected if there is no
  // profile; this only narrows the type for the role checks below.
  const { isTablet } = useResponsive();
  if (!profile) return null;

  return (
    // Wraps the navigator, not a screen: the first-order coach has to survive
    // the trip from Tables to a table's order to Bills, which is the whole
    // journey it narrates. It renders nothing at all for anyone who is not a
    // brand-new owner — see `ActivationProvider`.
    <ActivationProvider>
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
            // Role AND the restaurant's setup: a quick-billing cafe has no
            // KDS and a food truck has no floor, so those routes get no href
            // at all rather than a tab leading to an empty screen.
            href: canSeeTab(tab, profile.role, config) ? tab.href : null,
          }}
        />
      ))}
      {/* A table's dine-in order: a tab, but a hidden one, so the bar stays put
          when a waiter opens a table. It was briefly a stack nested in the
          Order tab, which kept the bar too but made the trip there TWO moves —
          the navigator cross-faded to the takeaway screen sitting at the
          bottom of that stack before the table's order slid over it, and the
          takeaway screen visibly flashed past on the way. As a sibling tab it
          is one cross-fade to the screen actually asked for.

          `TabBar` draws from `TABS`, which this is deliberately not in, so it
          gets no button of its own; it lights the Order tab instead, by first
          path segment. Its "‹ Back" goes to Tables by name — see
          `OrderScreen` — because there is no stack here to pop. */}
      <Tabs.Screen name="order/[tableId]" options={{ href: null }} />

      {/* No Account tab. It is a stack screen reached from the profile button
          in each screen's header — see `src/components/ProfileButton.tsx`.
          The bar is for the modules a shift moves between; settings are not
          one, and the slot is worth more to the six that are. */}
      </Tabs>
    </ActivationProvider>
  );
}
