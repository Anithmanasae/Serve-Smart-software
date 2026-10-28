import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Stack, usePathname, useSegments } from "expo-router";
import { PostHogProvider } from "posthog-react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableFreeze } from "react-native-screens";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { AuthProvider, useAuth } from "@/features/auth/AuthContext";
import { SettingsProvider } from "@/features/settings/SettingsContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BootSplash } from "@/components/BrandSplash";
import { captureScreen, posthog } from "@/lib/analytics";

// Off-screen routes stop re-rendering on Firestore snapshots (with the tab
// navigator's freezeOnBlur) — must be set before any screen renders.
enableFreeze(true);

/** Once the session has resolved, how long the launch splash will wait for
 *  the router to leave `/` before it comes off regardless. */
const BOOT_ARRIVAL_GRACE_MS = 1500;

/**
 * Tells the root when the first real screen is in place.
 *
 * "In place" is two things: the session has resolved, and the router has left
 * `app/index.tsx` — which draws nothing but a splash and a redirect, so lifting
 * the launch splash while it is still the route would dissolve navy into navy
 * and then cut to the real screen anyway. `index` is the only route with no
 * segments at all.
 *
 * The grace timer is the floor under that: an overlay that never lifts is the
 * whole app gone, so once the session has answered it is on a clock.
 */
function BootReporter({ onArrived }: { onArrived: () => void }) {
  const { loading } = useAuth();
  const segments: string[] = useSegments();
  const arrived = !loading && segments.length > 0;

  useEffect(() => {
    if (arrived) onArrived();
  }, [arrived, onArrived]);

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(onArrived, BOOT_ARRIVAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [loading, onArrived]);

  return null;
}

/** expo-router hides the NavigationContainer, so PostHog can't auto-capture
 *  screens — record a screen view whenever the route changes instead. */
function ScreenTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) captureScreen(pathname);
  }, [pathname]);
  return null;
}

/** Only mounts PostHog when a key is configured (see src/lib/analytics.ts). */
function Analytics({ children }: { children: ReactNode }) {
  if (!posthog) return <>{children}</>;
  return (
    <PostHogProvider
      client={posthog}
      autocapture={{ captureScreens: false, captureTouches: false }}
    >
      <ScreenTracker />
      {children}
    </PostHogProvider>
  );
}

export default function RootLayout() {
  // Load the Plus Jakarta Sans family once, app-wide. Nothing below mounts
  // until the glyphs are ready (or the load has failed) so text never flashes
  // in the fallback face. Ionicons is preloaded too: without it each icon
  // lazy-loads the font and silently renders blank if that load fails
  // (e.g. cleaner apps wiping the cache on the client's device).
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...Ionicons.font,
  });
  const fontsReady = fontsLoaded || !!fontError;

  // The launch splash is ONE overlay across the whole boot — fonts, session,
  // first redirect — rather than a splash returned by whichever layer happens
  // to be waiting. Swapping instances restarted the animation at each seam,
  // and a splash that is *instead of* the app can only be cut away from,
  // never dissolved out of.
  const [arrived, setArrived] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const onArrived = useCallback(() => setArrived(true), []);
  const onGone = useCallback(() => setSplashGone(true), []);

  return (
    <SafeAreaProvider>
      <Analytics>
        {/* The splash sits INSIDE the boundary so a crash during boot replaces
            it with the recovery screen instead of hiding that screen behind it. */}
        <ErrorBoundary>
          {/* Light icons while the navy is up, dark once the app is showing. */}
          <StatusBar style={arrived ? "dark" : "light"} />
          {fontsReady && (
            <AuthProvider>
              <SettingsProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    // The redirects that happen under the splash must not
                    // animate: the dissolve would reveal a screen mid-slide.
                    animation: splashGone ? "default" : "none",
                  }}
                />
                <BootReporter onArrived={onArrived} />
              </SettingsProvider>
            </AuthProvider>
          )}
          {!splashGone && <BootSplash leaving={arrived} onGone={onGone} />}
        </ErrorBoundary>
      </Analytics>
    </SafeAreaProvider>
  );
}
