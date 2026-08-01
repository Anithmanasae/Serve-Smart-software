/**
 * In-app waiter notification for kitchen progress.
 *
 * The KDS updates each kot's `status` in Firestore, and waiter screens already
 * hold live kot subscriptions — so "notify the waiter" is just detecting a
 * status TRANSITION (new → preparing, → ready) between consecutive snapshots
 * and flashing a banner ("T1 — Order READY"). No server involved.
 *
 * TODO: real push notifications that reach a backgrounded phone need
 * expo-notifications + per-device push tokens; out of scope for now.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow, space } from "@/theme/theme";
import type { Kot, KotStatus } from "@/types/models";

type LiveKot = Kot & { id: string };

export interface KotAlert {
  /** Changes per alert so a repeat status still re-triggers the banner. */
  key: number;
  tableLabel: string;
  status: "preparing" | "ready";
}

/**
 * Watch a live kot array for status transitions. `isMine` (optional) filters
 * to the current waiter's tickets; it's read through a ref, so an inline
 * closure is fine. The first snapshot only seeds the baseline — no alert.
 */
export function useKotStatusAlerts(
  kots: LiveKot[],
  isMine?: (kot: LiveKot) => boolean
): KotAlert | null {
  const [alert, setAlert] = useState<KotAlert | null>(null);
  const prevRef = useRef<Map<string, KotStatus> | null>(null);
  const isMineRef = useRef(isMine);
  isMineRef.current = isMine;

  useEffect(() => {
    const prev = prevRef.current;
    const next = new Map<string, KotStatus>();
    for (const k of kots) next.set(k.id, k.status);
    if (prev) {
      for (const k of kots) {
        const before = prev.get(k.id);
        if (
          before !== undefined &&
          before !== k.status &&
          (k.status === "preparing" || k.status === "ready") &&
          (isMineRef.current ? isMineRef.current(k) : true)
        ) {
          setAlert({
            key: Date.now(),
            tableLabel: k.tableLabel,
            status: k.status,
          });
        }
      }
    }
    prevRef.current = next;
  }, [kots]);

  // Auto-dismiss after a few seconds.
  useEffect(() => {
    if (!alert) return;
    const id = setTimeout(() => setAlert(null), 4000);
    return () => clearTimeout(id);
  }, [alert]);

  return alert;
}

/** Floating toast-style banner; render last inside the screen root. */
export function KotAlertBanner({
  alert,
  topOffset,
}: {
  alert: KotAlert | null;
  topOffset: number;
}) {
  if (!alert) return null;
  const ready = alert.status === "ready";
  return (
    <View
      pointerEvents="none"
      style={[
        styles.banner,
        { top: topOffset },
        ready ? styles.ready : styles.preparing,
      ]}
    >
      <Text style={styles.text}>
        {alert.tableLabel} — Order {ready ? "READY" : "STARTED"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: space.s4,
    right: space.s4,
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    alignItems: "center",
    zIndex: 10,
    ...shadow.card,
  },
  preparing: {
    backgroundColor: colors.statusIndigo,
  },
  ready: {
    backgroundColor: colors.statusGreen,
  },
  text: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "800",
  },
});
