import { useEffect, useState } from 'react';
import type { JobStatus } from '@vibe-teacher/shared';
import { api } from '../api/client';

/** 작업 id 를 1.5초 간격으로 폴링한다 */
export function useJob(jobId: string | null): { job: JobStatus | null; error: Error | null } {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const j = await api<JobStatus>(`/api/jobs/${jobId}`);
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
  }, [jobId]);

  return { job, error };
}
