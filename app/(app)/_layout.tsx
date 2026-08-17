import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { BrandSplash } from "@/components/BrandSplash";

/**
 * Authenticated area: requires a signed-in, active profile.
 *
 * This layout is a **Stack whose first screen is the tab navigator**, not the
 * tabs themselves. The five screens reached *from* a tab — bill history,
 * staff, table setup, offers, and Account — sit beside `(tabs)` in this stack
 * rather than inside it as hidden tabs, which buys two things a tab could not:
 *
 * - They **push** (`slide_from_right`) and pop back, so going deeper looks
 *   like going deeper. As hidden tabs they swapped instantly, with no cue that
 *   a back step now existed.
 * - The **tab bar goes away** while they are open. All five draw their own
 *   "‹ Back", so the bar underneath was a second, contradictory way out of a
 *   screen the user had deliberately entered.
 *
 * A table's order is the **exception** and lives in `(tabs)/order/[tableId]`,
 * as a hidden tab. It reads as a place in the app rather than a detour out of
 * one — a waiter moves between a table's order and KDS or Bills constantly,
 * and losing the bar there cost a tap each way and read as the bar glitching
 * out. It gives up the push animation to stay a single move; see the note in
 * `(tabs)/_layout.tsx`.
 *
 * The auth gate lives here rather than on the tabs so it covers those five as
 * well; `(tabs)/_layout.tsx` can therefore assume a profile exists.
 */
export default function AppLayout() {
  const { profile, gate, loading } = useAuth();
  if (loading) return <BrandSplash />;
  // Restricted/removed mid-shift → the live profile listener lands here and
  // kicks the device out to the gate screen instantly.
  if (gate) return <Redirect href="/pending" />;
  if (!profile) return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Every screen in this stack is a detail of the one below it, so they
        // all travel the same way. `(tabs)` is the root and never animates in;
        // it is what slides back into view on the way out.
        animation: "slide_from_right",
      }}
    />
  );
}
