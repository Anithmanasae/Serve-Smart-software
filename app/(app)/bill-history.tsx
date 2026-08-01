import { Redirect } from "expo-router";
import { useAuth } from "@/features/auth/AuthContext";
import { BillHistoryScreen } from "@/features/cashier/BillHistoryScreen";

/** Settled-bill history — billing staff only (reached from Account). */
export default function BillHistoryRoute() {
  const { role } = useAuth();
  if (role !== "cashier" && role !== "admin") return <Redirect href="/" />;
  return <BillHistoryScreen />;
}
