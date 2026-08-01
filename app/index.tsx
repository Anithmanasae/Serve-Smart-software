import { Redirect } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { homePathForRole } from "@/features/auth/roleRoutes";
import { Loading } from "@/components/Loading";

/** Entry: send the user to their role's home, to the approval-gate screen,
 *  or to login. */
export default function Index() {
  const { role, gate, loading } = useAuth();
  if (loading) return <Loading />;
  if (gate) return <Redirect href="/pending" />;
  return <Redirect href={role ? homePathForRole(role) : "/login"} />;
}
