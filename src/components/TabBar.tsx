/**
 * The app's top-level navigation — a Material 3 navigation BAR on a phone and
 * a navigation RAIL on a tablet, from one component.
 *
 * Why this is hand-drawn rather than the navigator's default bar:
 *
 * - **The active tab needs a shape, not just a tint.** A colour swap alone is
 *   the iOS idiom, and it is carried there by SF Symbols and a bar the OS
 *   draws. On Android the same trick reads as "the label went blue". M3 puts a
 *   filled pill behind the active icon, which is a *position* you can see from
 *   across a counter — the thing a POS actually needs. `colors.primarySoft`
 *   has been sitting in the theme commented "selected card / active nav
 *   background" since the beginning; this is the nav finally using it.
 * - **A bottom bar is the wrong component on a tablet.** M3 switches to a rail
 *   at 600dp and Square/Toast/Lightspeed all put navigation down the left edge
 *   on a counter-mounted tablet. A rail also gives back the 64dp of vertical
 *   space that a bottom bar costs in the orientation with the least of it, and
 *   it has no five-item ceiling — this app has six tabs.
 *
 * The navigator still owns state, deep links, `lazy` and `freezeOnBlur`; this
 * only draws. `tabBarPosition: "left"` (React Navigation v7, vendored inside
 * expo-router 57) means the rail is a supported layout, not an absolutely
 * positioned overlay — the scene is laid out beside it automatically.
 */
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_ACCESS } from "@/features/auth/roleRoutes";
import { useResponsive } from "@/lib/responsive";
import { feel } from "@/lib/feedback";
import { colors, fonts, radius, space } from "@/theme/theme";
import type { Role } from "@/types/models";

type IconName = Extract<keyof typeof MaterialCommunityIcons.glyphMap, string>;

export interface TabDef {
  /** Route name inside `(tabs)` — must match the file path exactly. */
  name: string;
  href: string;
  title: string;
  /** MaterialCommunityIcons base name; the `-outline` cut is the inactive one. */
  icon: IconName;
  module: keyof typeof ROLE_ACCESS;
}

/**
 * The bar's contents, in order, in ONE place.
 *
 * Both the layout (which turns each into a `<Tabs.Screen>` with an `href`) and
 * this bar (which decides what to draw) read this array, so the two can't
 * drift. It matters more than it looks: expo-router's `href: null` does *not*
 * remove a route from navigator state — it sets `tabBarItemStyle.display` to
 * `"none"` and returns `null` from `tabBarButton`. A custom bar that ignored
 * that would happily draw every tab to every role. Filtering here, from the
 * same `ROLE_ACCESS` the layout uses, is why it doesn't.
 */
export const TABS: readonly TabDef[] = [
  { name: "insights", href: "/insights", title: "Insights", icon: "chart-box", module: "insights" },
  { name: "menu", href: "/menu", title: "Menu", icon: "food", module: "menuAdmin" },
  { name: "tables", href: "/tables", title: "Tables", icon: "view-grid", module: "tables" },
  { name: "order/index", href: "/order", title: "Order", icon: "cart", module: "order" },
  { name: "kds", href: "/kds", title: "KDS", icon: "pot-steam", module: "kds" },
  { name: "bills", href: "/bills", title: "Bills", icon: "receipt-text", module: "bills" },
];

export const canSeeTab = (tab: TabDef, role: Role) =>
  ROLE_ACCESS[tab.module].includes(role);

/** M3: a 32dp-tall indicator, 64 wide in a bar and 56 in the narrower rail. */
const INDICATOR_H = 32;
const INDICATOR_W_BAR = 64;
const INDICATOR_W_RAIL = 56;
/** M3 navigation rail is 80dp wide. */
const RAIL_W = 80;

/** `order/[tableId]` → `order`. A route's module is its first segment. */
function firstSegment(routeName: string): string {
  return routeName.split("/")[0];
}

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { profile } = useAuth();
  const { isTablet } = useResponsive();
  if (!profile) return null;

  const rail = isTablet;
  const items = TABS.filter((tab) => canSeeTab(tab, profile.role))
    // A tab the navigator doesn't know about can't be navigated to. Guards the
    // gap between this array and the route files if one is ever renamed.
    .map((tab) => ({ tab, route: state.routes.find((r) => r.name === tab.name) }))
    .filter((entry): entry is { tab: TabDef; route: (typeof state.routes)[number] } =>
      entry.route !== undefined
    );

  return (
    <View
      style={[
        rail ? styles.rail : styles.bar,
        rail
          ? { paddingTop: insets.top + space.s3, paddingBottom: insets.bottom + space.s3 }
          : { paddingBottom: insets.bottom },
      ]}
    >
      {items.map(({ tab, route }) => (
        <TabItem
          key={route.key}
          tab={tab}
          rail={rail}
          // Matched on the first path segment, not the whole route name, so a
          // module's secondary screens keep their tab lit: `order/[tableId]`
          // (a table's dine-in order) is the Order tab, same as `order/index`.
          focused={
            firstSegment(state.routes[state.index]?.name ?? "") ===
            firstSegment(tab.name)
          }
          onPress={() => {
            // Emitted so anything listening for `tabPress` still hears it, and
            // so a screen may preventDefault. The feel is NOT played here —
            // see `onPressIn` below.
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (state.routes[state.index]?.key !== route.key && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          }}
        />
      ))}
    </View>
  );
}

function TabItem({
  tab,
  rail,
  focused,
  onPress,
}: {
  tab: TabDef;
  rail: boolean;
  focused: boolean;
  onPress: () => void;
}) {
  // The pill grows into place rather than appearing. Opacity + scale only, so
  // this rides the native driver; animating `backgroundColor` would not, and a
  // JS-driven colour tween on the most-pressed control in the app is exactly
  // where dropped frames get noticed.
  const grow = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(grow, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [focused, grow]);

  const tint = focused ? colors.primary : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      // Touch-DOWN, per the haptics rules: the pulse should read as the tab
      // giving way under the finger, not as a report that navigation happened.
      onPressIn={() => feel.select()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={tab.title}
      style={rail ? styles.railItem : styles.barItem}
    >
      <View style={rail ? styles.railIndicatorBox : styles.barIndicatorBox}>
        <Animated.View
          style={[
            styles.indicator,
            {
              opacity: grow,
              transform: [
                { scaleX: grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
              ],
            },
          ]}
        />
        <MaterialCommunityIcons
          name={focused ? tab.icon : (`${tab.icon}-outline` as IconName)}
          size={rail ? 26 : 22}
          color={tint}
        />
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
        {tab.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.s2,
  },
  barItem: {
    flex: 1,
    alignItems: "center",
    gap: space.s1,
    paddingBottom: space.s2,
  },
  barIndicatorBox: {
    height: INDICATOR_H,
    width: INDICATOR_W_BAR,
    alignItems: "center",
    justifyContent: "center",
  },

  rail: {
    width: RAIL_W,
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: "center",
    gap: space.s4,
  },
  railItem: {
    alignItems: "center",
    gap: space.s1,
    width: RAIL_W,
  },
  railIndicatorBox: {
    height: INDICATOR_H,
    width: INDICATOR_W_RAIL,
    alignItems: "center",
    justifyContent: "center",
  },

  // Sits behind the glyph, hence absolute: the icon must not move when the
  // pill appears, or every tab change nudges the whole row. The indicator box
  // is already exactly pill-sized, so filling it needs no dimensions here.
  indicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  // 11 is the floor in both the HIG and M3. Family, never a bare fontWeight —
  // RN cannot synthesise a weight for a loaded custom font.
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
  },
});
