/**
 * Tables (Floor View) — SADA POS, React Native port.
 *
 * Live floor grid: subscribes to `tables` and to every open/billed order, maps
 * each table to its running order (total + elapsed time), and colour-codes cards
 * by status. All writes go through the ported `tablesApi` — this screen never
 * touches Firestore directly.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { query, where } from "firebase/firestore";
import { router } from "expo-router";

import { paths } from "@/lib/firestore/paths";
import { useCollectionData } from "@/lib/firestore/useRealtime";
import { formatMoney } from "@/lib/money";
import { tapFeedback } from "@/lib/feedback";
import { colors, fonts, radius, space } from "@/theme/theme";
import type { Kot, Order, OrderItem, Table, TableStatus } from "@/types/models";
import { useAuth } from "@/features/auth/AuthContext";
import { KotAlertBanner, useKotStatusAlerts } from "@/features/order/kotAlerts";
import { TableCard } from "./TableCard";
import {
  closeTable,
  mergeTables,
  shiftTable,
  splitTable,
} from "./tablesApi";

type FilterKey = "all" | TableStatus;
type Sheet = "actions" | "merge" | "shift" | "split" | null;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "occupied", label: "Occupied" },
  { key: "billed", label: "Billed" },
];

function tableName(t: Table): string {
  return t.label ?? `T${t.number}`;
}

export function TablesScreen() {
  const insets = useSafeAreaInsets();
  const { profile, firebaseUser } = useAuth();
  const waiterId = profile?.uid ?? firebaseUser?.uid ?? "";
  // Counter flow entry point: cashier/admin start a takeaway order (no table)
  // straight from the floor — items → KOT → bill, all on the order screen.
  const canTakeaway = profile?.role === "cashier" || profile?.role === "admin";

  // ── Live subscriptions ────────────────────────────────────────────────────
  const tablesQuery = useMemo(() => paths.tables(), []);
  const ordersQuery = useMemo(
    () => query(paths.orders(), where("status", "in", ["open", "billed"])),
    []
  );
  const { data: tables, loading } = useCollectionData<Table>(tablesQuery);
  const { data: orders } = useCollectionData<Order>(ordersQuery);

  // Kitchen progress toast: watch every active ticket, but only alert for
  // tables whose order belongs to this waiter ("T1 — Order READY").
  const kotsQuery = useMemo(
    () =>
      query(paths.kots(), where("status", "in", ["new", "preparing", "ready"])),
    []
  );
  const { data: kots } = useCollectionData<Kot>(kotsQuery);
  const myOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of orders) if (o.waiterId === waiterId) ids.add(o.id);
    return ids;
  }, [orders, waiterId]);
  const kotAlert = useKotStatusAlerts(kots, (k) => myOrderIds.has(k.orderId));

  // tableId -> its running order
  const orderByTable = useMemo(() => {
    const map = new Map<string, Order & { id: string }>();
    for (const o of orders) {
      if (o.tableId) map.set(o.tableId, o);
    }
    return map;
  }, [orders]);

  const tableById = useMemo(() => {
    const map = new Map<string, Table & { id: string }>();
    for (const t of tables) map.set(t.id, t);
    return map;
  }, [tables]);

  // ── Filtering + counts ─────────────────────────────────────────────────────
  const [filter, setFilter] = useState<FilterKey>("all");
  const counts = useMemo(() => {
    const c = { all: tables.length, available: 0, occupied: 0, billed: 0 };
    for (const t of tables) c[t.status] += 1;
    return c;
  }, [tables]);

  const visibleTables = useMemo(() => {
    const sorted = [...tables].sort((a, b) => a.number - b.number);
    if (filter === "all") return sorted;
    return sorted.filter((t) => t.status === filter);
  }, [tables, filter]);

  // ── Action sheet state ─────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = selectedId ? tableById.get(selectedId) ?? null : null;
  const selectedOrder = selectedId ? orderByTable.get(selectedId) ?? null : null;

  const freeTables = useMemo(
    () =>
      [...tables]
        .filter(
          (t) =>
            t.status === "available" &&
            !t.mergedInto &&
            t.id !== selectedId
        )
        .sort((a, b) => a.number - b.number),
    [tables, selectedId]
  );

  function closeSheet() {
    setSheet(null);
    setSelectedId(null);
  }

  async function run(fn: () => Promise<unknown>, onDone?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const handleCardPress = useCallback((t: Table & { id: string }) => {
    if (t.status === "available" && !t.mergedInto) {
      // Fast path: straight to the order screen, no write needed here — the
      // first item added creates the order and flips the table to occupied
      // (orderApi.createOrderLocal), keeping order creation in one place.
      router.push("/order/" + t.id);
      return;
    }
    setSelectedId(t.id);
    setSheet("actions");
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Tables</Text>
          <Text style={styles.subtitle}>Manage your floor</Text>
        </View>
        {canTakeaway && (
          <Pressable
            style={({ pressed }) => [styles.takeawayBtn, pressed && styles.pressed]}
            onPress={() => {
              tapFeedback();
              router.push("/order");
            }}
          >
            <Text style={styles.takeawayBtnText}>🥡 Takeaway</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                tapFeedback();
                setFilter(f.key);
              }}
              style={({ pressed }) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.filterText, active && styles.filterTextActive]}
              >
                {f.label} {counts[f.key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={visibleTables}
        keyExtractor={(t) => t.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: insets.bottom + space.s6 },
        ]}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? "Loading floor…" : "No tables to show."}
          </Text>
        }
        renderItem={({ item }) => (
          <TableCard
            table={item}
            order={orderByTable.get(item.id) ?? null}
            primary={
              item.mergedInto ? tableById.get(item.mergedInto) ?? null : null
            }
            onPress={handleCardPress}
          />
        )}
      />

      {/* Action sheet modal */}
      <Modal
        visible={sheet !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.backdrop} onPress={closeSheet}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {sheet === "actions" && selected && (
              <ActionsSheet
                table={selected}
                hasOrder={!!selectedOrder}
                busy={busy}
                onOpenOrder={() => {
                  const id = selected.id;
                  closeSheet();
                  router.push("/order/" + id);
                }}
                onMerge={() => setSheet("merge")}
                onShift={() => setSheet("shift")}
                onSplit={() => setSheet("split")}
                onClose={() =>
                  run(() => closeTable(selected.id), closeSheet)
                }
                onDismiss={closeSheet}
              />
            )}

            {sheet === "merge" && selected && (
              <MergeSheet
                primary={selected}
                candidates={tables
                  .filter((t) => t.id !== selected.id && !t.mergedInto)
                  .sort((a, b) => a.number - b.number)}
                busy={busy}
                onConfirm={(ids) =>
                  run(() => mergeTables(selected.id, ids), closeSheet)
                }
                onBack={() => setSheet("actions")}
              />
            )}

            {sheet === "shift" && selected && (
              <PickTableSheet
                heading={`Shift ${tableName(selected)} to…`}
                tables={freeTables}
                busy={busy}
                disabled={!selectedOrder}
                emptyHint={
                  !selectedOrder
                    ? "This table has no active order to shift."
                    : "No free tables available."
                }
                onPick={(target) => {
                  if (!selectedOrder) return;
                  run(
                    () =>
                      shiftTable(selectedOrder.id, selected.id, target.id),
                    closeSheet
                  );
                }}
                onBack={() => setSheet("actions")}
              />
            )}

            {sheet === "split" && selected && (
              <SplitSheet
                order={selectedOrder}
                freeTables={freeTables}
                busy={busy}
                onConfirm={(lineIds, target) =>
                  run(
                    () =>
                      splitTable(
                        selectedOrder!.id,
                        target.id,
                        lineIds,
                        waiterId
                      ),
                    closeSheet
                  )
                }
                onBack={() => setSheet("actions")}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Live kitchen status toast */}
      <KotAlertBanner alert={kotAlert} topOffset={insets.top + space.s2} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action sheets
// ─────────────────────────────────────────────────────────────────────────────

function SheetHeader({ title }: { title: string }) {
  return <Text style={styles.sheetTitle}>{title}</Text>;
}

function ActionButton({
  label,
  onPress,
  variant = "default",
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        variant === "primary" && styles.actionPrimary,
        variant === "danger" && styles.actionDanger,
        disabled && styles.actionDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          variant === "primary" && styles.actionTextPrimary,
          variant === "danger" && styles.actionTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ActionsSheet({
  table,
  hasOrder,
  busy,
  onOpenOrder,
  onMerge,
  onShift,
  onSplit,
  onClose,
  onDismiss,
}: {
  table: Table;
  hasOrder: boolean;
  busy: boolean;
  onOpenOrder: () => void;
  onMerge: () => void;
  onShift: () => void;
  onSplit: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  return (
    <View>
      <SheetHeader title={tableName(table)} />
      <ActionButton
        label="View / edit order"
        variant="primary"
        onPress={onOpenOrder}
        disabled={busy || !hasOrder}
      />
      <ActionButton label="Merge tables" onPress={onMerge} disabled={busy} />
      <ActionButton
        label="Shift to another table"
        onPress={onShift}
        disabled={busy || !hasOrder}
      />
      <ActionButton
        label="Split table"
        onPress={onSplit}
        disabled={busy || !hasOrder}
      />
      <ActionButton
        label="Close table (free)"
        variant="danger"
        onPress={onClose}
        disabled={busy}
      />
      <ActionButton label="Cancel" onPress={onDismiss} disabled={busy} />
    </View>
  );
}

function MergeSheet({
  primary,
  candidates,
  busy,
  onConfirm,
  onBack,
}: {
  primary: Table;
  candidates: (Table & { id: string })[];
  busy: boolean;
  onConfirm: (ids: string[]) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <View>
      <SheetHeader title={`Merge into ${tableName(primary)}`} />
      <Text style={styles.sheetHint}>
        Pick the tables to fold into this one.
      </Text>
      <ScrollView style={styles.pickList}>
        {candidates.length === 0 && (
          <Text style={styles.empty}>No other tables available.</Text>
        )}
        {candidates.map((t) => (
          <Pressable
            key={t.id}
            style={({ pressed }) => [
              styles.pickRow,
              picked.has(t.id) && styles.pickRowActive,
              pressed && styles.pressed,
            ]}
            onPress={() => toggle(t.id)}
          >
            <Text style={styles.pickLabel}>{tableName(t)}</Text>
            <Text style={styles.pickMeta}>
              {picked.has(t.id) ? "Selected" : t.status}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ActionButton
        label={`Merge ${picked.size} table${picked.size === 1 ? "" : "s"}`}
        variant="primary"
        onPress={() => onConfirm([...picked])}
        disabled={busy || picked.size === 0}
      />
      <ActionButton label="Back" onPress={onBack} disabled={busy} />
    </View>
  );
}

function PickTableSheet({
  heading,
  tables,
  busy,
  disabled,
  emptyHint,
  onPick,
  onBack,
}: {
  heading: string;
  tables: (Table & { id: string })[];
  busy: boolean;
  disabled?: boolean;
  emptyHint: string;
  onPick: (t: Table & { id: string }) => void;
  onBack: () => void;
}) {
  return (
    <View>
      <SheetHeader title={heading} />
      <ScrollView style={styles.pickList}>
        {disabled || tables.length === 0 ? (
          <Text style={styles.empty}>{emptyHint}</Text>
        ) : (
          tables.map((t) => (
            <Pressable
              key={t.id}
              style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
              onPress={() => !busy && onPick(t)}
            >
              <Text style={styles.pickLabel}>{tableName(t)}</Text>
              <Text style={styles.pickMeta}>{t.capacity} seats</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
      <ActionButton label="Back" onPress={onBack} disabled={busy} />
    </View>
  );
}

function SplitSheet({
  order,
  freeTables,
  busy,
  onConfirm,
  onBack,
}: {
  order: (Order & { id: string }) | null;
  freeTables: (Table & { id: string })[];
  busy: boolean;
  onConfirm: (lineIds: string[], target: Table & { id: string }) => void;
  onBack: () => void;
}) {
  const [lines, setLines] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState<string | null>(null);
  const activeLines: OrderItem[] = order
    ? order.items.filter((l) => !l.voided)
    : [];

  function toggleLine(id: string) {
    setLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const target = freeTables.find((t) => t.id === targetId) ?? null;
  const canConfirm =
    !busy && lines.size > 0 && !!target && activeLines.length > lines.size;

  return (
    <View>
      <SheetHeader title="Split table" />
      {!order || activeLines.length === 0 ? (
        <Text style={styles.empty}>No order lines to split.</Text>
      ) : (
        <>
          <Text style={styles.sheetHint}>Move these items:</Text>
          <ScrollView style={styles.pickList}>
            {activeLines.map((l) => (
              <Pressable
                key={l.lineId}
                style={({ pressed }) => [
                  styles.pickRow,
                  lines.has(l.lineId) && styles.pickRowActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => toggleLine(l.lineId)}
              >
                <Text style={styles.pickLabel}>
                  {l.qty}× {l.name}
                </Text>
                <Text style={styles.pickMeta}>
                  {formatMoney(l.price * l.qty)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.sheetHint}>To table:</Text>
          <ScrollView horizontal style={styles.targetRow}>
            {freeTables.length === 0 && (
              <Text style={styles.empty}>No free tables.</Text>
            )}
            {freeTables.map((t) => (
              <Pressable
                key={t.id}
                style={({ pressed }) => [
                  styles.targetChip,
                  targetId === t.id && styles.targetChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setTargetId(t.id)}
              >
                <Text
                  style={[
                    styles.targetChipText,
                    targetId === t.id && styles.targetChipTextActive,
                  ]}
                >
                  {tableName(t)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      <ActionButton
        label="Split selected"
        variant="primary"
        onPress={() => target && onConfirm([...lines], target)}
        disabled={!canConfirm}
      />
      <ActionButton label="Back" onPress={onBack} disabled={busy} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.floor },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    paddingHorizontal: space.s4,
    paddingTop: space.s4,
    paddingBottom: space.s2,
  },
  headerText: { flex: 1 },
  takeawayBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  takeawayBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.textInverse,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 34,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMuted,
    marginTop: space.s1,
  },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  filterChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
  },
  filterTextActive: { color: colors.textInverse },

  grid: { paddingHorizontal: space.s4 },
  column: { gap: space.s3, marginBottom: space.s3 },
  empty: {
    textAlign: "center",
    fontFamily: fonts.regular,
    color: colors.textMuted,
    padding: space.s5,
    fontSize: 14,
  },

  pressed: { opacity: 0.7 },

  // Modal / sheets
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.s4,
    paddingBottom: space.s6,
    maxHeight: "80%",
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.text,
    marginBottom: space.s3,
  },
  sheetHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: space.s2,
    marginTop: space.s2,
  },

  action: {
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginTop: space.s2,
    alignItems: "center",
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  actionDisabled: { opacity: 0.45 },
  actionText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  actionTextPrimary: { color: colors.textInverse },
  actionTextDanger: { color: colors.danger },

  pickList: { maxHeight: 260 },
  pickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: space.s2,
  },
  pickRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  pickLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  pickMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },

  targetRow: { flexDirection: "row", marginBottom: space.s2 },
  targetChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: space.s2,
  },
  targetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  targetChipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textMuted,
  },
  targetChipTextActive: { color: colors.textInverse },
});
