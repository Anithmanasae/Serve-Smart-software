import { View, Text, Pressable, StyleSheet, Switch, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { useSettings } from "@/features/settings/SettingsContext";
import { ReceiptDetailsCard } from "@/features/settings/ReceiptDetailsCard";
import { PrinterSettingsCard } from "@/features/settings/PrinterSettingsCard";
import { useRestaurantProfile } from "@/features/settings/useRestaurantProfile";
import { colors, space, radius, shadow } from "@/theme/theme";

/** Signed-in user's profile, billing settings + sign out. */
export default function AccountRoute() {
  const { profile, signOut, role } = useAuth();
  const { gstEnabled, setGstEnabled } = useSettings();
  // Join code lives on the restaurant root doc; only fetched for the roles
  // that may share it.
  const canShareJoinCode = role === "cashier" || role === "admin";
  const { data: restaurant } = useRestaurantProfile();

  // Waiters/kitchen never generate bills — the tax switch is a billing control.
  const canToggleGst = role === "cashier" || role === "admin";
  // Admins reach Menu Management from its own tab; cashiers get an entry here.
  const showMenuManagement = role === "cashier";
  // The cashier is the "2nd owner": approves signups, restricts/removes staff.
  const showStaff = role === "cashier" || role === "admin";
  // Owner (cashier) + admin size the floor — how many tables the restaurant has.
  const showTablesSetup = role === "cashier" || role === "admin";
  // Receipt header + thermal printer are billing concerns: admin + cashier.
  const showReceiptSetup = role === "cashier" || role === "admin";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <Text style={styles.title}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.avatar}>👤</Text>
        <Text style={styles.name}>{profile?.name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{profile?.role.toUpperCase()}</Text>
        </View>
      </View>

      {canToggleGst && (
        <View style={styles.settingsCard}>
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
              onValueChange={setGstEnabled}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          <View style={styles.settingsDivider} />

          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/bill-history")}
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
          <ReceiptDetailsCard />
          <PrinterSettingsCard />
        </>
      )}

      {showMenuManagement && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Menu</Text>
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/menu")}
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
        </View>
      )}

      {canShareJoinCode && restaurant?.joinCode && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Staff Join Code</Text>
          <Text style={styles.joinCode}>{restaurant.joinCode}</Text>
          <Text style={styles.settingHint}>
            Share this code with new waiters and kitchen staff — they enter it
            on the signup screen to join {restaurant.name}. You approve them
            from Staff Management.
          </Text>
        </View>
      )}

      {showTablesSetup && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Floor</Text>
          <Pressable
            style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            onPress={() => router.push("/tables-setup")}
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
