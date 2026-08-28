import { Redirect, Stack, usePathname } from "expo-router";
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
 * well; `(tabs)/_layout.tsx` can therefore assume a profile exists. The
 * first-run setup gate rides with it, for the same reason: every screen below
 * reads the config those answers produce.
 */
export default function AppLayout() {
  const { profile, gate, loading, config } = useAuth();
  // Which route the router is currently on. Needed for the setup gate below —
  // and read here, unconditionally, because every `return` under it is early.
  const pathname = usePathname();
  if (loading) return <BrandSplash />;
  // Restricted/removed mid-shift → the live profile listener lands here and
  // kicks the device out to the gate screen instantly.
  if (gate) return <Redirect href="/pending" />;
  if (!profile) return <Redirect href="/login" />;
  // A brand-new restaurant, before its owner has said what kind of place it
  // is. Everything past this point — which tabs exist, whether there is a
  // floor, whether an order becomes a kitchen ticket — depends on those
  // answers, and the menu behind this screen has not been seeded yet, so
  // there is nothing useful to let them into first.
  //
  // Owner only, and it survives being killed mid-wizard: the marker is
  // cleared by the LAST write of `completeSetup`, so an interrupted setup
  // lands right back here. Staff can never see it — they join a restaurant
  // that is already configured, and re-shaping the workspace is not theirs
  // to do.
  //
  // `pathname !== "/setup"` is LOAD-BEARING, and its absence was an infinite
  // loop rather than a missing feature. `/setup` is `app/(app)/setup.tsx` — a
  // screen INSIDE the very Stack this function returns. Redirecting to it
  // *instead of* rendering that Stack means the router arrives at a route
  // whose host navigator was never mounted, so nothing renders, so the layout
  // re-runs, so it redirects again: React counts the repeats and throws
  // "Maximum update depth exceeded". A redirect can only ever point OUT of the
  // navigator it replaces — /pending and /login above are fine because both
  // live outside this group. Once the router is already on /setup there is
  // nothing left to redirect, and the Stack below is exactly what has to
  // render for the wizard to appear.
  if (
    config.needsSetup &&
    (profile.role === "cashier" || profile.role === "admin") &&
    pathname !== "/setup"
  ) {
    return <Redirect href="/setup" />;
  }

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
