import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_ACCESS } from "@/features/auth/roleRoutes";
import { useResponsive } from "@/lib/responsive";
import { feel } from "@/lib/feedback";
import { colors, fonts } from "@/theme/theme";

type IconName = Extract<keyof typeof MaterialCommunityIcons.glyphMap, string>;

// Outline glyph when inactive, filled (brand-tinted) when active.
// `override` lets the tablet bar draw a larger glyph than the navigator's
// phone-scale default.
//
// Material Community over Ionicons: it is the only family bundled with
// `@expo/vector-icons` that has an actual restaurant vocabulary, and every
// glyph the bar uses has a matching `-outline` cut, so the filled/outline
// pairing survives the swap. Two of them carry real meaning that the Ionicons
// set did not — a steaming pot is the kitchen, where a flame reads as
// "trending"; and `chart-box` sits on the same optical square as its
// neighbours where `stats-chart` floated small between them.
const icon =
  (name: IconName, override?: number) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <MaterialCommunityIcons
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
        // OPAQUE, with a real edge. The bar used to be transparent over a
        // `BlurView` — but the canvas behind it is `colors.bg` (#f4f5f7) and
        // the wash on top was 72% white, so there was nothing dark enough to
        // frost: the blur cost an Android render pass to produce a flat pale
        // band. With `borderTopWidth: 0` on top of that, the bar had no edge
        // at all and content dissolved into it. A bar needs one of a hairline,
        // real elevation, or genuinely strong blur; this now has the first two.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
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
        // 11 is the floor in both the HIG and Material 3; the old phone size
        // of 10 is the single most reliable "homemade" tell in a tab bar.
        tabBarLabelStyle: {
          fontFamily: fonts.semibold,
          fontSize: isTablet ? 12 : 11,
        },
      }}
    >
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          href: can("insights") ? "/insights" : null,
          tabBarIcon: glyph("chart-box"),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          href: can("menuAdmin") ? "/menu" : null,
          tabBarIcon: glyph("food"),
        }}
      />
      <Tabs.Screen
        name="tables"
        options={{
          title: "Tables",
          href: can("tables") ? "/tables" : null,
          tabBarIcon: glyph("view-grid"),
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
          tabBarIcon: glyph("pot-steam"),
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bills",
          href: can("bills") ? "/bills" : null,
          tabBarIcon: glyph("receipt-text"),
        }}
      />
      {/* No Account tab. It is a stack screen reached from the profile button
          in each screen's header — see `src/components/ProfileButton.tsx`.
          The bar is for the modules a shift moves between; settings are not
          one, and the slot is worth more to the five that are. */}
    </Tabs>
  );
}
