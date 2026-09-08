import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

export interface ApiState<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => void;
}

/** path 가 null 이면 요청하지 않는다 */
export function useApi<T>(path: string | null, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => {
        if (latest.current === id) setData(d);
      })
      .catch((e: Error) => {
        if (latest.current === id) setError(e);
      })
      .finally(() => {
        if (latest.current === id) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
