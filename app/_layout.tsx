import { useEffect, type ReactNode } from "react";
import { Stack, usePathname } from "expo-router";
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
import { AuthProvider } from "@/features/auth/AuthContext";
import { SettingsProvider } from "@/features/settings/SettingsContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loading } from "@/components/Loading";
import { captureScreen, posthog } from "@/lib/analytics";

// Off-screen routes stop re-rendering on Firestore snapshots (with the tab
// navigator's freezeOnBlur) — must be set before any screen renders.
enableFreeze(true);

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
  // Load the Plus Jakarta Sans family once, app-wide. Hold on a spinner until
  // the glyphs are ready (or bail through on error) so text never flashes in
  // the fallback face. Ionicons is preloaded too: without it each icon
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
  if (!fontsLoaded && !fontError) return <Loading />;

  return (
    <SafeAreaProvider>
      <Analytics>
        <ErrorBoundary>
          <AuthProvider>
            <SettingsProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }} />
            </SettingsProvider>
          </AuthProvider>
        </ErrorBoundary>
      </Analytics>
    </SafeAreaProvider>
  );
}
