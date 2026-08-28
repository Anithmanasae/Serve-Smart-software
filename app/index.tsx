import { Redirect } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { BrandSplash } from "@/components/BrandSplash";
import { useTourSeen } from "@/features/onboarding/pendingSetup";

/** Entry: send the user to their role's home, to the approval-gate screen,
 *  to the first-launch tour, or to login.
 *
 *  The tour check comes LAST of the four, and that ordering is the whole of
 *  "new customers only": anyone with a profile is already inside, anyone
 *  gated has an account that exists, and only a device with neither — and
 *  which has never been offered the tour — is a stranger holding this app for
 *  the first time.
 *
 *  `useTourSeen` reads device storage, so it has a loading state of its own
 *  and the splash has to cover it. Guessing either way is visible: guess
 *  "seen" and a new customer never gets the tour, guess "not seen" and a
 *  returning one watches it flash past on the way to login. */
export default function Index() {
  const { role, gate, loading, config } = useAuth();
  // Read unconditionally — every `return` below it is early, and a hook
  // cannot sit under one.
  const tourSeen = useTourSeen();

  if (loading) return <BrandSplash />;
  if (gate) return <Redirect href="/pending" />;
  if (role) return <Redirect href={homePathForRole(role, config)} />;
  if (tourSeen === null) return <BrandSplash />;
  return <Redirect href={tourSeen ? "/login" : "/welcome"} />;
}
