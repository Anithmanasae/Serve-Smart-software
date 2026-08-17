import { useLocalSearchParams } from "expo-router";
import { OrderScreen } from "@/features/order";

/**
 * Dine-in order for a specific table.
 *
 * `key={tableId}` is load-bearing. This is a (hidden) TAB, not a pushed stack
 * screen: moving from T3 to T4 changes the param on the one mounted instance
 * instead of unmounting and remounting it. Without the key, T3's cart sheet,
 * search text, category filter and — worst — its `mirrorRef` (the local order
 * mirror every write is addressed to) would all still be there when T4 opened.
 * The key makes each table its own component instance again, which is what the
 * screen was written against.
 */
export default function OrderRoute() {
  const { tableId } = useLocalSearchParams<{ tableId: string }>();
  return <OrderScreen key={tableId} tableId={tableId} />;
}
