/**
 * Generic real-time subscription hooks — the heart of "live updates for free".
 *
 * These wrap Firestore's onSnapshot so every module gets live data with the
 * same loading/error contract. Feature-specific hooks (useTables, useKots, …)
 * are thin wrappers over these.
 */
import { useEffect, useState } from "react";
import {
  onSnapshot,
  type DocumentReference,
  type Query,
} from "firebase/firestore";

export interface RealtimeState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** Subscribe to a collection query. `data` is an array of docs (with id). */
export function useCollectionData<T>(
  query: Query<T> | null
): RealtimeState<(T & { id: string })[]> {
  const [state, setState] = useState<RealtimeState<(T & { id: string })[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const unsub = onSnapshot(
      query,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setState({ data, loading: false, error: null });
      },
      (error) => setState({ data: [], loading: false, error })
    );
    return unsub;
    // Query identity is managed by callers via useMemo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return state;
}

/** Subscribe to a single document. `data` is null until loaded / if missing. */
export function useDocData<T>(
  refOrNull: DocumentReference<T> | null
): RealtimeState<(T & { id: string }) | null> {
  const [state, setState] = useState<RealtimeState<(T & { id: string }) | null>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!refOrNull) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const unsub = onSnapshot(
      refOrNull,
      (snap) => {
        setState({
          data: snap.exists() ? ({ id: snap.id, ...snap.data() }) : null,
          loading: false,
          error: null,
        });
      },
      (error) => setState({ data: null, loading: false, error })
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refOrNull]);

  return state;
}
