/**
 * Temporary RN placeholder for a screen not yet rebuilt.
 * Screen subagents REPLACE the feature screen this renders.
 */
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAuth } from "@/features/auth/AuthContext";
import { colors, space, radius } from "@/theme/theme";

export function ScreenPlaceholder({ title }: { title: string }) {
  const { profile, signOut } = useAuth();
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>
        Signed in as {profile?.name} ({profile?.role}). This screen is scaffolded
        and pending its React Native rebuild.
      </Text>
      <Pressable style={styles.btn} onPress={() => signOut()}>
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.s6, gap: space.s4 },
  title: { fontSize: 26, fontWeight: "700", color: colors.primary },
  sub: { color: colors.textMuted, lineHeight: 20 },
  btn: {
    alignSelf: "flex-start",
    marginTop: space.s4,
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnText: { color: colors.text, fontWeight: "600" },
});
