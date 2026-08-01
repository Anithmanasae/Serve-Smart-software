import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_ACCESS } from "@/features/auth/roleRoutes";
import { Loading } from "@/components/Loading";
import { colors, fonts } from "@/theme/theme";

type IconName = keyof typeof Ionicons.glyphMap;

// Outline glyph when inactive, filled (brand-tinted) when active.
const icon =
  (name: IconName) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons
      name={focused ? name : (`${name}-outline` as IconName)}
      size={size}
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
  if (loading) return <Loading />;
  // Restricted/removed mid-shift → the live profile listener lands here and
  // kicks the device out to the gate screen instantly.
  if (gate) return <Redirect href="/pending" />;
  if (!profile) return <Redirect href="/login" />;

  const can = (module: keyof typeof ROLE_ACCESS) =>
    ROLE_ACCESS[module].includes(profile.role);

  return (
    <Tabs
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
        },
        tabBarBackground: () => (
          <BlurView
            tint="light"
            intensity={40}
            style={[StyleSheet.absoluteFill, styles.tabBlur]}
          />
        ),
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          href: can("insights") ? "/insights" : null,
          tabBarIcon: icon("stats-chart"),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          href: can("menuAdmin") ? "/menu" : null,
          tabBarIcon: icon("restaurant"),
        }}
      />
      <Tabs.Screen
        name="tables"
        options={{
          title: "Tables",
          href: can("tables") ? "/tables" : null,
          tabBarIcon: icon("grid"),
        }}
      />
      <Tabs.Screen
        name="order/index"
        options={{
          title: "Order",
          href: can("order") ? "/order" : null,
          tabBarIcon: icon("cart"),
        }}
      />
      <Tabs.Screen
        name="kds"
        options={{
          title: "KDS",
          href: can("kds") ? "/kds" : null,
          tabBarIcon: icon("flame"),
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bills",
          href: can("bills") ? "/bills" : null,
          tabBarIcon: icon("receipt"),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: icon("person-circle"),
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Translucent wash over the blur so labels/icons stay legible.
  tabBlur: { backgroundColor: "rgba(255,255,255,0.72)" },
});
