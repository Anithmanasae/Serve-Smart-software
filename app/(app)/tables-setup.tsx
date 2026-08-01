import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import { setTableCount } from "@/features/tables/tablesApi";
import { successFeedback, tapFeedback } from "@/lib/feedback";
import { Loading } from "@/components/Loading";
import { colors, space, radius, shadow } from "@/theme/theme";
import type { Table } from "@/types/models";

const MAX_TABLES = 200;

/**
 * Table setup — reached from the cashier's Account screen.
 *
 * The owner (cashier) or an admin picks how many tables the floor has. Growing
 * appends new tables; shrinking removes the highest-numbered FREE tables only,
 * so a table with a live order is never deleted out from under a waiter.
 * All writes go through tablesApi.setTableCount.
 */
export default function TablesSetupRoute() {
  const { role } = useAuth();
  const canManage = role === "cashier" || role === "admin";

  const tablesQuery = useMemo(() => paths.tables(), []);
  const { data: tables, loading } = useCollectionData<Table>(tablesQuery);

  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the input with the current floor size once, after the first load.
  useEffect(() => {
    if (!loading && target === null) setTarget(tables.length);
  }, [loading, tables.length, target]);

  if (!canManage) return <Redirect href="/account" />;
  if (loading || target === null) return <Loading />;

  const current = tables.length;
  const counts = { available: 0, occupied: 0, billed: 0 };
  for (const t of tables) counts[t.status] += 1;
  const inUse = counts.occupied + counts.billed;

  const changed = target !== current;
  const removingBelowInUse = target < inUse;

  function step(delta: number) {
    tapFeedback();
    setTarget((t) =>
      Math.max(0, Math.min(MAX_TABLES, (t ?? 0) + delta)),
    );
  }

  function onType(text: string) {
    const n = parseInt(text.replace(/[^0-9]/g, ""), 10);
    setTarget(Number.isNaN(n) ? 0 : Math.min(MAX_TABLES, n));
  }

  async function save() {
    if (busy || target === null || !changed) return;
    setBusy(true);
    try {
      const result = await setTableCount(tables, target);
      successFeedback();
      Alert.alert(
        "Tables updated",
        `Your floor now has ${result} table${result === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      Alert.alert(
        "Couldn't update tables",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
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
          <Text style={styles.title}>Tables</Text>
        </View>

        {/* ---- current floor summary ---- */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCount}>{current}</Text>
          <Text style={styles.summaryLabel}>
            table{current === 1 ? "" : "s"} on the floor
          </Text>
          <View style={styles.statusRow}>
            <StatusPill label="Available" value={counts.available} />
            <StatusPill label="Occupied" value={counts.occupied} />
            <StatusPill label="Billed" value={counts.billed} />
          </View>
        </View>

        {/* ---- count setter ---- */}
        <Text style={styles.sectionTitle}>Set the number of tables</Text>
        <View style={styles.stepperCard}>
          <Pressable
            style={({ pressed }) => [
              styles.stepBtn,
              (busy || target <= 0) && styles.stepBtnDisabled,
              pressed && styles.pressed,
            ]}
            onPress={() => step(-1)}
            disabled={busy || target <= 0}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>

          <TextInput
            style={styles.countInput}
            value={String(target)}
            onChangeText={onType}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
            editable={!busy}
          />

          <Pressable
            style={({ pressed }) => [
              styles.stepBtn,
              (busy || target >= MAX_TABLES) && styles.stepBtnDisabled,
              pressed && styles.pressed,
            ]}
            onPress={() => step(1)}
            disabled={busy || target >= MAX_TABLES}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>

        {removingBelowInUse && (
          <Text style={styles.warn}>
            {inUse} table{inUse === 1 ? " is" : "s are"} in use right now. Only
            free tables get removed — bill or clear the busy ones first to go
            this low.
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            (!changed || busy) && styles.saveBtnDisabled,
            pressed && styles.pressed,
          ]}
          onPress={save}
          disabled={!changed || busy}
        >
          <Text style={styles.saveText}>
            {busy
              ? "Saving…"
              : !changed
                ? "Saved"
                : target > current
                  ? `Add ${target - current} table${target - current === 1 ? "" : "s"}`
                  : `Remove ${current - target} table${current - target === 1 ? "" : "s"}`}
          </Text>
        </Pressable>

        <Text style={styles.footnote}>
          New tables are numbered after your highest table and start empty.
          Removing takes the highest-numbered free tables first — a table with a
          live order is never deleted.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPill({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillValue}>{value}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
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

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s6,
    alignItems: "center",
    gap: space.s1,
    ...shadow.card,
  },
  summaryCount: { fontSize: 48, fontWeight: "800", color: colors.primary },
  summaryLabel: { fontSize: 14, color: colors.textMuted },
  statusRow: {
    flexDirection: "row",
    gap: space.s3,
    marginTop: space.s3,
  },
  pill: {
    alignItems: "center",
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    minWidth: 84,
  },
  pillValue: { fontSize: 18, fontWeight: "800", color: colors.text },
  pillLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  sectionTitle: {
    marginTop: space.s4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stepperCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s5,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    ...shadow.card,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: { opacity: 0.4 },
  stepBtnText: { fontSize: 30, fontWeight: "800", color: colors.primary },
  countInput: {
    minWidth: 96,
    textAlign: "center",
    fontSize: 40,
    fontWeight: "800",
    color: colors.text,
    paddingVertical: space.s2,
  },

  warn: {
    fontSize: 13,
    color: colors.danger,
    lineHeight: 19,
    marginTop: space.s1,
  },
  saveBtn: {
    marginTop: space.s4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: space.s4,
    alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: colors.borderStrong },
  saveText: { color: colors.textInverse, fontSize: 16, fontWeight: "700" },
  footnote: {
    marginTop: space.s4,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
