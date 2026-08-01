import { View, Text, Pressable, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { Loading } from "@/components/Loading";
import { colors, space, radius, shadow } from "@/theme/theme";

/**
 * Gate screen for signed-in accounts that can't use the app yet (or anymore).
 * The profile doc is watched live, so the moment the cashier taps Approve the
 * user is redirected straight to their role's home — and the moment they're
 * restricted, any screen they were on collapses back to this one.
 */
export default function Pending() {
  const { firebaseUser, profile, gate, loading, signOut } = useAuth();

  if (loading) return <Loading />;
  // Approved while looking at this screen → straight in.
  if (profile) return <Redirect href={homePathForRole(profile.role)} />;
  if (!firebaseUser || !gate) return <Redirect href="/login" />;

  const copy = {
    pending: {
      icon: "⏳",
      title: "Waiting for approval",
      body: "Your account has been created. The cashier needs to approve it before you can start. This screen updates by itself — no need to refresh.",
    },
    denied: {
      icon: "🚫",
      title: "Request denied",
      body: "The cashier denied this account request. If you think this is a mistake, talk to the cashier.",
    },
    restricted: {
      icon: "🔒",
      title: "Access restricted",
      body: "Your account is switched off right now. If you're scheduled to work today, ask the cashier to re-enable it.",
    },
    removed: {
      icon: "❌",
      title: "Account removed",
      body: "This account no longer exists. Contact the cashier if you believe this is an error.",
    },
  }[gate];

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.icon}>{copy.icon}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
          onPress={() => signOut()}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: space.s6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s6,
    alignItems: "center",
    gap: space.s3,
    ...shadow.card,
  },
  icon: { fontSize: 48 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  signOutBtn: {
    marginTop: space.s3,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    paddingHorizontal: space.s6,
  },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
