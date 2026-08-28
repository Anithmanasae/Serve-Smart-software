import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { ReceiptDetailsCard } from "@/features/settings/ReceiptDetailsCard";
import { PrinterSettingsCard } from "@/features/settings/PrinterSettingsCard";
import { TrialStatusCard } from "@/features/settings/TrialStatusCard";
import {
  markGstDecided,
  useRestaurantProfile,
} from "@/features/settings/useRestaurantProfile";
import { useActivationContext } from "@/features/onboarding";
import { feel, feelToggle } from "@/lib/feedback";
import { colors, space, radius, shadow } from "@/theme/theme";

/**
 * Signed-in user's profile, billing settings + sign out.
 *
 * A **pushed** stack screen, not a tab: it is opened from the profile button
 * in each module's header and hides the tab bar while it is up. That means it
 * has to draw its own way back — there is no header and no bar underneath.
 *
 * ## `?focus=`
 *
 * Anything that sends an owner here for one specific job — a lesson, a nudge,
 * a link from another screen — can name the section it means
 * (`?focus=bill-header`, `?focus=printer`) and this screen scrolls to it and
 * lights it up for a moment. Without that they land at the top of a long
 * screen and have to hunt for "Receipt Details" past Billing, the menu rows
 * and the join code, which is a link that technically goes somewhere and
 * practically goes nowhere.
 */
/** Sections that can be linked to directly. */
type FocusTarget = "bill-header" | "printer";

export default function AccountRoute() {
  const { profile, signOut, role, config } = useAuth();
  const { gstEnabled, setGstEnabled } = useSettings();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const activation = useActivationContext();

  const scrollRef = useRef<ScrollView>(null);
  // Measured as each section lays out, because the sections above them are
  // conditional on role — there is no fixed offset to hard-code.
  const offsets = useRef<Partial<Record<FocusTarget, number>>>({});
  const [highlight, setHighlight] = useState<FocusTarget | null>(null);
  const focusHandled = useRef(false);

  // The TOPMOST element claiming a target wins. "Make bills look like yours"
  // covers two cards — the GST switch and the receipt header — and scrolling
  // to the second of them would put the first off screen above, answering
  // half the row.
  const onSectionLayout = useCallback(
    (target: FocusTarget) => (e: LayoutChangeEvent) => {
      const y = e.nativeEvent.layout.y;
      const seen = offsets.current[target];
      if (seen == null || y < seen) offsets.current[target] = y;
    },
    []
  );

  // One shot, after layout. The tint fades on its own: it is there to answer
  // "which of these is the checklist talking about?", and a highlight that
  // stayed would just be a second thing to dismiss.
  useEffect(() => {
    if (focusHandled.current) return;
    if (focus !== "bill-header" && focus !== "printer") return;
    focusHandled.current = true;
    const target = focus;
    const t = setTimeout(() => {
      const y = offsets.current[target];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - space.s4), animated: true });
      }
      setHighlight(target);
    }, 260);
    const clear = setTimeout(() => setHighlight(null), 2600);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [focus]);
  // Join code lives on the restaurant root doc; only fetched for the roles
  // that may share it.
  const canShareJoinCode = role === "cashier" || role === "admin";
  const { data: restaurant } = useRestaurantProfile();

  // Waiters/kitchen never generate bills — the tax switch is a billing control.
  const canToggleGst = role === "cashier" || role === "admin";
  // Admins reach Menu Management from its own tab; cashiers get an entry here.
  const showMenuManagement = role === "cashier";
  // Offers price every order, so they sit with the menu they discount. Admin
  // gets the entry here too — unlike the menu, offers have no tab of their own.
  const showOffers = role === "cashier" || role === "admin";
  // The cashier is the "2nd owner": approves signups, restricts/removes staff.
  const showStaff = role === "cashier" || role === "admin";
  // Owner (cashier) + admin size the floor — how many tables the restaurant
  // has. A counter business said it has none, so there is no floor to size;
  // the section's other row (re-running setup) is where they turn tables back
  // on if that ever changes.
  const isOwner = role === "cashier" || role === "admin";
  const showTablesSetup = isOwner && config.tablesEnabled;
  // Receipt header + thermal printer are billing concerns: admin + cashier.
  const showReceiptSetup = role === "cashier" || role === "admin";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          onPressIn={feel.dismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtnText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Account</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.avatar}>👤</Text>
        <Text style={styles.name}>{profile?.name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{profile?.role.toUpperCase()}</Text>
        </View>
      </View>

      {/* Renders nothing once the restaurant is activated (permanent). */}
      <TrialStatusCard />

      {/* HOW TO USE THE APP — the walkthrough's permanent home.
          The guided run fires once, straight after setup, and is never
          forced on anyone again. But an owner who skipped it on day one, or
          a second person picking up the cashier's tablet in week three, has
          nowhere else to learn this app — so it lives here for good rather
          than only existing during the days nobody was ready to watch it.

          Owner-only, because the run bills a practice order and the roles
          that cannot bill would be taught a screen they never see. */}
      {isOwner && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>How to use Smart Serve</Text>
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/practice")}
            onPressIn={feel.press}
          >
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Walk me through an order</Text>
              <Text style={styles.settingHint}>
                {config.kotEnabled
                  ? "Table to kitchen to bill, step by step — nothing is saved"
                  : "Cart to bill, step by step — nothing is saved"}
              </Text>
            </View>
            <Text style={styles.settingChevron}>›</Text>
          </Pressable>
        </View>
      )}

      {/* Somebody is locked out RIGHT NOW, waiting on a tap the owner does
          not know exists. Nothing else in the app says so, which is why this
          gets a card of its own rather than a line inside Staff. */}
      {isOwner && (activation?.teamPending ?? 0) > 0 && (
        <Pressable
          style={({ pressed }) => [styles.pendingCard, pressed && styles.pressed]}
          onPress={() => router.push("/staff")}
          onPressIn={feel.press}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{activation?.teamPending}</Text>
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>
              {activation?.teamPending === 1
                ? "Someone is waiting to join"
                : "People are waiting to join"}
            </Text>
            <Text style={styles.settingHint}>
              They can&apos;t use the app until you approve them
            </Text>
          </View>
          <Text style={styles.settingChevron}>›</Text>
        </Pressable>
      )}

      {canToggleGst && (
        <View
          style={[
            styles.settingsCard,
            highlight === "bill-header" && styles.settingsCardFocused,
          ]}
          onLayout={onSectionLayout("bill-header")}
        >
          <Text style={styles.settingsTitle}>Billing</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Charge GST (5%)</Text>
              <Text style={styles.settingHint}>
                {gstEnabled
                  ? "New bills add CGST + SGST to the total"
                  : "New bills are generated without GST"}
              </Text>
            </View>
            <Switch
              value={gstEnabled}
              onValueChange={(v) => {
                feelToggle(v);
                setGstEnabled(v);
                // Touching this switch IS the decision, wherever it happens.
                // Without this the checklist would keep asking an owner who
                // had already answered here rather than in the wizard — and
                // an owner who deliberately left it ON would look, to the
                // app, exactly like one who had never been asked.
                void markGstDecided(v);
              }}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          {/* Only for a restaurant that has never been ASKED — one that
              registered before the setup wizard put the question in, and has
              therefore been charging 5% since day one on a default nobody
              chose. The switch alone cannot settle it: stamping the decision
              by flipping it would force a change on an owner whose answer
              happens to be "yes", so the confirmation is its own tap. It
              disappears the moment either one is used. */}
          {restaurant && restaurant.gstDecidedAt == null && (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmText}>
                {gstEnabled
                  ? "You have not set this yet — bills are adding 5% GST. Is that right?"
                  : "You have not set this yet — bills are adding no GST. Is that right?"}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  feel.success();
                  void markGstDecided(gstEnabled);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.confirmBtnText}>
                  Yes, that&apos;s right
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.settingsDivider} />

          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/bill-history")}
            onPressIn={feel.press}
          >
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Bill History</Text>
              <Text style={styles.settingHint}>
                View settled bills and reprint a customer's copy
              </Text>
            </View>
            <Text style={styles.settingChevron}>›</Text>
          </Pressable>
        </View>
      )}

      {showReceiptSetup && (
        <>
          {/* Shares the bill-header target with the GST switch above it: the
              checklist row talks about both halves of what prints on a bill,
              so pointing at one and not the other would answer half a
              question. The wrapper is what carries the offset. */}
          <View
            style={[highlight === "bill-header" && styles.focusRing]}
            onLayout={onSectionLayout("bill-header")}
          >
            <ReceiptDetailsCard />
          </View>
          <View
            style={[highlight === "printer" && styles.focusRing]}
            onLayout={onSectionLayout("printer")}
          >
            <PrinterSettingsCard />
          </View>
        </>
      )}

      {(showMenuManagement || showOffers) && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Menu</Text>
          {showMenuManagement && (
            <Pressable
              style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
              onPress={() => router.push("/menu")}
              onPressIn={feel.press}
            >
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Menu Management</Text>
                <Text style={styles.settingHint}>
                  Add, edit or remove items (up to 1,000) and mark dishes
                  unavailable for the day
                </Text>
              </View>
              <Text style={styles.settingChevron}>›</Text>
            </Pressable>
          )}

          {showMenuManagement && showOffers && (
            <View style={styles.settingsDivider} />
          )}

          {showOffers && (
            <Pressable
              style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
              onPress={() => router.push("/offers")}
              onPressIn={feel.press}
            >
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Offers & Discounts</Text>
                <Text style={styles.settingHint}>
                  Buy One Get One, combo prices, Monday-only deals — applied to
                  orders automatically
                </Text>
              </View>
              <Text style={styles.settingChevron}>›</Text>
            </Pressable>
          )}
        </View>
      )}

      {canShareJoinCode && restaurant?.joinCode && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Staff Join Code</Text>
          <Text style={styles.joinCode}>{restaurant.joinCode}</Text>
          <Text style={styles.settingHint}>
            Share this code with new waiters and kitchen staff. They install
            the app, tap "Joining a team?" on the sign-in screen and enter it
            to join {restaurant.name} — then you approve them from Staff
            Management.
          </Text>
        </View>
      )}

      {isOwner && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>How you work</Text>
          {/* Re-runs first-run setup. This is the ONLY way back to those
              answers, and they decide whether half the app exists — a cafe
              that adds tables next year, or turns the kitchen display on,
              must not be stuck with what it said on day one. */}
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/setup")}
            onPressIn={feel.press}
          >
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Set up my app</Text>
              <Text style={styles.settingHint}>
                {config.kotEnabled
                  ? "Kitchen tickets on"
                  : "Quick billing — no kitchen tickets"}
                {config.tablesEnabled ? " · tables on" : " · counter service"}
              </Text>
            </View>
            <Text style={styles.settingChevron}>›</Text>
          </Pressable>
        </View>
      )}

      {showTablesSetup && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Floor</Text>
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/tables-setup")}
            onPressIn={feel.press}
          >
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Table Setup</Text>
              <Text style={styles.settingHint}>
                Set how many tables your restaurant has
              </Text>
            </View>
            <Text style={styles.settingChevron}>›</Text>
          </Pressable>
        </View>
      )}

      {showStaff && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Staff</Text>
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/staff")}
            onPressIn={feel.press}
          >
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Staff Management</Text>
              <Text style={styles.settingHint}>
                Approve new waiter/kitchen accounts, restrict staff for the
                day, or remove them
              </Text>
            </View>
            <Text style={styles.settingChevron}>›</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
        onPress={() => signOut()}
        onPressIn={feel.warn} // you are about to be thrown out of the app
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: space.s6,
    gap: space.s5,
    paddingBottom: space.s6 * 2,
  },
  header: { gap: space.s4 },
  backBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: { fontSize: 14, fontWeight: "600", color: colors.text },
  title: { fontSize: 28, fontWeight: "800", color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s6,
    alignItems: "center",
    gap: space.s2,
    ...shadow.card,
  },
  avatar: { fontSize: 48 },
  name: { fontSize: 20, fontWeight: "700", color: colors.text },
  email: { color: colors.textMuted },
  roleBadge: {
    marginTop: space.s2,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingVertical: space.s1,
    paddingHorizontal: space.s3,
  },
  roleText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  // Same ring, for a target whose card draws its own background (the receipt
  // and printer cards). Wrapping rather than restyling them keeps the
  // highlight out of components that know nothing about the checklist.
  focusRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.lg,
  },
  pendingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    borderWidth: 1.5,
    borderColor: colors.danger,
    ...shadow.card,
  },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.textInverse,
    fontWeight: "800",
    fontSize: 12,
  },

  // The section the checklist sent them to. A ring, not a shadow: these cards
  // already sit on their own elevation, and a second one reads as a rendering
  // fault rather than as "this is the one".
  settingsCardFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    gap: space.s3,
    ...shadow.card,
  },
  settingsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 16, fontWeight: "600", color: colors.text },
  settingHint: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  confirmRow: {
    marginTop: space.s3,
    padding: space.s3,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    gap: space.s3,
  },
  confirmText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  confirmBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
  },
  confirmBtnText: {
    color: colors.textInverse,
    fontWeight: "700",
    fontSize: 13,
  },
  settingChevron: { fontSize: 24, color: colors.textMuted, fontWeight: "600" },
  joinCode: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.primary,
    letterSpacing: 6,
    textAlign: "center",
    paddingVertical: space.s2,
  },
  settingsDivider: { height: 1, backgroundColor: colors.border },
  signOutBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: space.s4,
    alignItems: "center",
  },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 16 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
