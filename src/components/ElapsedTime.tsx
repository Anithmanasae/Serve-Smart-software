/**
 * A tiny leaf component that renders a live "time since" label.
 *
 * The ticking clock lives HERE, not in the screen: each instance subscribes to
 * a shared interval and re-renders only its own <Text> node, so per-second
 * ticks never re-render whole cards/lists (which would defeat their memo()).
 * Instances with the same `intervalMs` share one setInterval.
 */
import { memo, useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { agoLabel, elapsedMs } from "@/lib/date";
import type { Ts } from "@/types/models";

type Listener = () => void;
const tickers = new Map<
  number,
  { id: ReturnType<typeof setInterval>; listeners: Set<Listener> }
>();

/** Subscribe to a shared ticker for `intervalMs`; returns the unsubscriber. */
function subscribe(intervalMs: number, fn: Listener): () => void {
  let t = tickers.get(intervalMs);
  if (!t) {
    const listeners = new Set<Listener>();
    t = {
      id: setInterval(() => listeners.forEach((l) => l()), intervalMs),
      listeners,
    };
    tickers.set(intervalMs, t);
  }
  t.listeners.add(fn);
  return () => {
    t!.listeners.delete(fn);
    if (t!.listeners.size === 0) {
      clearInterval(t!.id);
      tickers.delete(intervalMs);
    }
  };
}

function ElapsedTimeImpl({
  createdAt,
  format = agoLabel,
  intervalMs = 1000,
  style,
  alertAfterMs,
  alertStyle,
}: {
  createdAt: Ts;
  /** ms -> label; defaults to `agoLabel` ("5m ago"). */
  format?: (ms: number) => string;
  /** Tick granularity; coarse labels can use 30000 to tick less often. */
  intervalMs?: number;
  style?: StyleProp<TextStyle>;
  /** Once elapsed ≥ this, merge `alertStyle` over `style` (overdue tickets). */
  alertAfterMs?: number;
  alertStyle?: StyleProp<TextStyle>;
}) {
  const compute = (ms: number) => ({
    label: format(ms),
    alert: alertAfterMs != null && ms >= alertAfterMs,
  });
  const [state, setState] = useState(() =>
    compute(elapsedMs(createdAt, Date.now()))
  );

  useEffect(() => {
    const update = () => {
      const ms = elapsedMs(createdAt, Date.now());
      const label = format(ms);
      const alert = alertAfterMs != null && ms >= alertAfterMs;
      // Returning the same object bails out of re-rendering, so coarse
      // formats ("5m ago") cost nothing on most ticks.
      setState((prev) =>
        prev.label === label && prev.alert === alert ? prev : { label, alert }
      );
    };
    update(); // re-sync when the ticket or format changes
    return subscribe(intervalMs, update);
  }, [createdAt, format, intervalMs, alertAfterMs]);

  return (
    <Text style={[style, state.alert && alertStyle]}>{state.label}</Text>
  );
}

export const ElapsedTime = memo(ElapsedTimeImpl);
