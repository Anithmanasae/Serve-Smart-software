import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_ACCESS } from "@/features/auth/roleRoutes";
import { Loading } from "@/components/Loading";
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
 * Authenticated area: requires a signed-in, active profile.
 * Bottom tabs show every module the user's role may access (admins see all);
 * modules outside the role are hidden via `href: null`.
 */
export default function AppLayout() {
  const { profile, gate, loading } = useAuth();
  // A tablet is held further from the face and tapped with a whole thumb, so
  // the bar grows with the glass rather than staying at phone scale.
  const { isTablet } = useResponsive();
  const insets = useSafeAreaInsets();
  if (loading) return <Loading />;
  // Restricted/removed mid-shift → the live profile listener lands here and
  // kicks the device out to the gate screen instantly.
  if (gate) return <Redirect href="/pending" />;
  if (!profile) return <Redirect href="/login" />;

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
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: glyph("person-circle"),
        }}
      />
      {/* Table-order detail: reached from Tables/Order screens, not a tab. */}
      <Tabs.Screen name="order/[tableId]" options={{ href: null }} />
      {/* Settled-bill history: reached from Account, not a tab. */}
      <Tabs.Screen name="bill-history" options={{ href: null }} />
      {/* Staff approvals/restrictions: reached from Account, not a tab. */}
      <Tabs.Screen name="staff" options={{ href: null }} />
      {/* Table-count setup: reached from Account, not a tab. */}
      <Tabs.Screen name="tables-setup" options={{ href: null }} />
      {/* Offers & discounts: reached from Account, not a tab. */}
      <Tabs.Screen name="offers" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Translucent wash over the blur so labels/icons stay legible.
  tabBlur: { backgroundColor: "rgba(255,255,255,0.72)" },
});
