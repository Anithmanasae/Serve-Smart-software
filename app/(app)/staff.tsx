import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/features/auth/AuthContext";
import {
  approveStaff,
  denyStaff,
  removeStaff,
  setStaffActive,
} from "@/features/staff/staffApi";
import { paths } from "@/lib/firestore/paths";
import { agoLabel, elapsedMs } from "@/lib/date";
import { animateNextLayout, successFeedback, tapFeedback } from "@/lib/feedback";
import { Loading } from "@/components/Loading";
import { colors, space, radius, shadow } from "@/theme/theme";
import type { AppUser } from "@/types/models";

/**
 * Staff management — reached from the cashier's Account screen.
 *
 * The cashier (2nd owner) sees every account that was self-created from the
 * signup screen: approves or denies new requests, restricts an account for
 * the day (their phone locks out instantly), and removes staff who left.
 * Admin and cashier profiles are shown but not manageable — the security
 * rules only let a cashier act on waiter/kitchen profiles.
 */
export default function StaffRoute() {
  const { role, profile } = useAuth();
  const [users, setUsers] = useState<AppUser[] | null>(null);

  const canManage = role === "cashier" || role === "admin";

  useEffect(() => {
    if (!canManage) return;
    return onSnapshot(
      paths.users(),
      (snap) => {
        setUsers(snap.docs.map((d) => ({ ...d.data(), uid: d.id })));
      },
      (e) => {
        console.warn("[staff] failed to load staff list:", e);
        setUsers([]);
      },
    );
  }, [canManage]);

  if (!canManage) return <Redirect href="/account" />;
  if (users === null) return <Loading />;

  // Cashier manages floor staff only; own/admin profiles are informational.
  const manageable = users.filter(
    (u) => u.role === "waiter" || u.role === "kitchen",
  );
  const byNewest = (a: AppUser, b: AppUser) =>
    (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
  const pending = manageable.filter((u) => u.status === "pending").sort(byNewest);
  const team = manageable.filter((u) => u.status === "approved").sort(byNewest);
  const denied = manageable.filter((u) => u.status === "denied").sort(byNewest);
  const now = Date.now();

  function confirmDeny(u: AppUser) {
    Alert.alert(
      "Deny this request?",
      `${u.name} won't be able to use the app. The request stays here so you can approve it later if you change your mind.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deny",
          style: "destructive",
          onPress: () => {
            animateNextLayout();
            tapFeedback();
            denyStaff(u.uid).catch(() => {});
          },
        },
      ],
    );
  }

  function confirmRemove(u: AppUser) {
    Alert.alert(
      "Remove this account?",
      `${u.name} (${u.email}) will be locked out permanently. This can't be undone from the app.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            animateNextLayout();
            tapFeedback();
            removeStaff(u.uid).catch(() => {});
          },
        },
      ],
    );
  }

  function approve(u: AppUser) {
    animateNextLayout();
    successFeedback();
    approveStaff(u.uid).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Staff</Text>
        </View>

        {/* ---- pending signup requests ---- */}
        <Text style={styles.sectionTitle}>
          Pending requests{pending.length > 0 ? ` (${pending.length})` : ""}
        </Text>
        {pending.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No new requests. When a waiter or kitchen staff member creates an
              account, it shows up here for your approval.
            </Text>
          </View>
        ) : (
          pending.map((u) => (
            <View key={u.uid} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.who}>
                  <Text style={styles.name}>{u.name}</Text>
                  <Text style={styles.email}>{u.email}</Text>
                  <Text style={styles.meta}>
                    {u.role.toUpperCase()} · requested{" "}
                    {agoLabel(elapsedMs(u.createdAt, now))}
                  </Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <Pressable
                  style={({ pressed }) => [styles.approveBtn, pressed && styles.pressed]}
                  onPress={() => approve(u)}
                >
                  <Text style={styles.approveText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.denyBtn, pressed && styles.pressed]}
                  onPress={() => confirmDeny(u)}
                >
                  <Text style={styles.denyText}>Deny</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        {/* ---- approved team ---- */}
        <Text style={styles.sectionTitle}>Team</Text>
        {team.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No approved staff yet.</Text>
          </View>
        ) : (
          team.map((u) => (
            <View key={u.uid} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.who}>
                  <Text style={styles.name}>{u.name}</Text>
                  <Text style={styles.email}>{u.email}</Text>
                  <Text style={styles.meta}>{u.role.toUpperCase()}</Text>
                </View>
                <View style={styles.activeCol}>
                  <Switch
                    value={u.active}
                    onValueChange={(v) => {
                      tapFeedback();
                      setStaffActive(u.uid, v).catch(() => {});
                    }}
                    trackColor={{ false: colors.borderStrong, true: colors.primary }}
                    thumbColor={colors.surface}
                  />
                  <Text style={[styles.activeLabel, !u.active && styles.offLabel]}>
                    {u.active ? "Active" : "Restricted"}
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.removeLink, pressed && styles.pressed]}
                onPress={() => confirmRemove(u)}
              >
                <Text style={styles.removeText}>Remove from staff</Text>
              </Pressable>
            </View>
          ))
        )}

        {/* ---- denied requests ---- */}
        {denied.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Denied</Text>
            {denied.map((u) => (
              <View key={u.uid} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.who}>
                    <Text style={styles.name}>{u.name}</Text>
                    <Text style={styles.email}>{u.email}</Text>
                    <Text style={styles.meta}>{u.role.toUpperCase()} · denied</Text>
                  </View>
                </View>
                <View style={styles.actionsRow}>
                  <Pressable
                    style={({ pressed }) => [styles.approveBtn, pressed && styles.pressed]}
                    onPress={() => approve(u)}
                  >
                    <Text style={styles.approveText}>Approve anyway</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.denyBtn, pressed && styles.pressed]}
                    onPress={() => confirmRemove(u)}
                  >
                    <Text style={styles.denyText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        <Text style={styles.footnote}>
          Restricted staff are locked out on their phone the moment you flip
          the switch — flip it back when they're working again. Removing an
          account is permanent.
          {profile?.role === "cashier"
            ? " You can only manage waiter and kitchen accounts."
            : ""}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scrollContent: {
    padding: space.s6,
    gap: space.s3,
    paddingBottom: space.s6 * 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: space.s3 },
  backBtn: { paddingVertical: space.s1, paddingRight: space.s2 },
  backBtnText: { color: colors.primary, fontSize: 17, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "800", color: colors.text },
  sectionTitle: {
    marginTop: space.s4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    ...shadow.card,
  },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    gap: space.s3,
    ...shadow.card,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  who: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text },
  email: { fontSize: 13, color: colors.textMuted },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  activeCol: { alignItems: "center", gap: 2 },
  activeLabel: { fontSize: 11, fontWeight: "600", color: colors.primary },
  offLabel: { color: colors.danger },
  actionsRow: { flexDirection: "row", gap: space.s3 },
  approveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: space.s3,
    alignItems: "center",
  },
  approveText: { color: colors.textInverse, fontWeight: "700", fontSize: 15 },
  denyBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: space.s3,
    alignItems: "center",
  },
  denyText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  removeLink: { alignSelf: "flex-start" },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  footnote: {
    marginTop: space.s4,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
