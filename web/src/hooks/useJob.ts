import { useEffect, useState } from 'react';
import type { BaseJobStatus, EnrichmentRecord } from '@vibe-teacher/shared';
import { api } from '../api/client';

/** 작업 상태 경로를 1.5초 간격으로 폴링한다 (예: /api/jobs/:id). path 가 null 이면 멈춘다 */
export function useJob<R = EnrichmentRecord>(path: string | null): { job: BaseJobStatus<R> | null; error: Error | null } {
  const [job, setJob] = useState<BaseJobStatus<R> | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setJob(null);
      setError(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const j = await api<BaseJobStatus<R>>(path);
        if (stopped) return;
        setJob(j);
        if (j.state === 'queued' || j.state === 'running') timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!stopped) setError(e as Error);
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [path]);

  return { job, error };
}
