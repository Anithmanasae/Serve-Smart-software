import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_ACCESS } from "@/features/auth/roleRoutes";
import { useResponsive } from "@/lib/responsive";
import { feel } from "@/lib/feedback";
import { colors, fonts } from "@/theme/theme";

type IconName = Extract<keyof typeof Ionicons.glyphMap, string>;

// Outline glyph when inactive, filled (brand-tinted) when active.
// `override` lets the tablet bar draw a larger glyph than the navigator's
// phone-scale default.
const icon =
  (name: IconName, override?: number) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IconName)}
      size={override ?? size}
      color={color}
    />
  );

/**
 * The bottom tab bar — the top level of the authenticated app.
 *
 * Tabs show every module the user's role may access (admins see all); modules
 * outside the role are hidden via `href: null`. Screens reached *from* a tab
 * are not here: they are stack siblings of this navigator, one level up in
 * `app/(app)/_layout.tsx`, so they push and hide the bar.
 */
export default function TabsLayout() {
  const { profile } = useAuth();
  // A tablet is held further from the face and tapped with a whole thumb, so
  // the bar grows with the glass rather than staying at phone scale.
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  // The (app) stack has already gated on auth and redirected if there is no
  // profile; this only narrows the type for the role checks below.
  if (!profile) return null;

  const can = (module: keyof typeof ROLE_ACCESS) =>
    ROLE_ACCESS[module].includes(profile.role);

  const glyph = (name: IconName) => icon(name, isTablet ? 26 : undefined);

  return (
    <Tabs
      // The bar is the most-pressed control in the app, and moving between
      // sections is moving between choices — one tick, from one place, so
      // every tab feels the same as every other.
      screenListeners={{ tabPress: () => feel.select() }}
      screenOptions={{
        headerShown: false,
        // Don't mount hidden tabs up front, and freeze them once blurred so
        // background screens skip re-renders from live Firestore snapshots.
        lazy: true,
        freezeOnBlur: true,
        // A 150ms cross-fade, not the `shift` slide. Two reasons: `lazy` above
        // means a tab's first visit mounts empty, and a slide carries that
        // emptiness across the glass where a dissolve hides it; and a slide
        // asserts a left/right order that seven unrelated modules don't have.
        // It also matches the `feel.select()` below — the lightest tick in the
        // vocabulary should not be paired with the heaviest motion.
        animation: "fade",
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // Frosted glass: drop the hard top hairline and let a blur panel sit
        // behind the (transparent) bar.
        tabBarStyle: {
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
          // An explicit height opts out of the navigator's own safe-area
          // padding, so the gesture inset has to be added back by hand.
          ...(isTablet
            ? {
                height: 64 + insets.bottom,
                paddingTop: 8,
                paddingBottom: 8 + insets.bottom,
              }
            : null),
        },
        tabBarBackground: () => (
          <BlurView
            tint="light"
            intensity={40}
            style={[StyleSheet.absoluteFill, styles.tabBlur]}
          />
        ),
        tabBarLabelStyle: {
          fontFamily: fonts.semibold,
          fontSize: isTablet ? 12 : 10,
        },
      }}
    >
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          href: can("insights") ? "/insights" : null,
          tabBarIcon: glyph("stats-chart"),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          href: can("menuAdmin") ? "/menu" : null,
          tabBarIcon: glyph("restaurant"),
        }}
      />
      <Tabs.Screen
        name="tables"
        options={{
          title: "Tables",
          href: can("tables") ? "/tables" : null,
          tabBarIcon: glyph("grid"),
        }}
      />
      <Tabs.Screen
        name="order/index"
        options={{
          title: "Order",
          href: can("order") ? "/order" : null,
          tabBarIcon: glyph("cart"),
        }}
      />
      <Tabs.Screen
        name="kds"
        options={{
          title: "KDS",
          href: can("kds") ? "/kds" : null,
          tabBarIcon: glyph("flame"),
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bills",
          href: can("bills") ? "/bills" : null,
          tabBarIcon: glyph("receipt"),
        }}
      />
      {/* No Account tab. It is a stack screen reached from the profile button
          in each screen's header — see `src/components/ProfileButton.tsx`.
          The bar is for the modules a shift moves between; settings are not
          one, and the slot is worth more to the five that are. */}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Translucent wash over the blur so labels/icons stay legible.
  tabBlur: { backgroundColor: "rgba(255,255,255,0.72)" },
});
