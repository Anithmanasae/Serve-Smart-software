import { useLocalSearchParams } from "expo-router";
import { OrderScreen } from "@/features/order";

/** Dine-in order for a specific table. */
export default function OrderRoute() {
  const { tableId } = useLocalSearchParams<{ tableId: string }>();
  return <OrderScreen tableId={tableId} />;
}
