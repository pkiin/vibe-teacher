import { useCallback, useEffect, useRef } from 'react';
import type { ExposureAction, LearnerProfile, SelfReport, UnderstandingResponse } from '@vibe-teacher/shared';
import { ApiError, api, apiPost } from '../api/client';

/** 재시도해도 한 번만 기록되도록 붙이는 요청 ID (비보안 컨텍스트에서도 동작) */
export function requestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export interface LearnerActions {
  revision: () => number;
  exposure: (action: ExposureAction, ids: { conceptId?: string; itemId?: string }) => void;
  selfReport: (conceptId: string, value: SelfReport) => Promise<void>;
  correction: (conceptId: string, note?: string) => Promise<void>;
  /** 상태를 바꾸는 요청. 409(다른 곳에서 먼저 바뀜)이면 최신 revision 으로 한 번 다시 보낸다 */
  withRevision: <T>(fn: (revision: number) => Promise<T>) => Promise<T>;
  profileChanged: (profile: LearnerProfile) => void;
}

export function useLearnerActions(projectId: string | undefined, sessionKey: string, revision: number, onProfile: (p: LearnerProfile) => void): LearnerActions {
  const rev = useRef(revision);
  useEffect(() => {
    rev.current = revision;
  }, [revision]);
  const base = `/api/projects/${projectId ?? ''}`;

  const profileChanged = useCallback(
    (p: LearnerProfile) => {
      rev.current = p.revision;
      onProfile(p);
    },
    [onProfile],
  );

  const withRevision = useCallback(
    async <T,>(fn: (revision: number) => Promise<T>): Promise<T> => {
      try {
        return await fn(rev.current);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        const latest = await api<UnderstandingResponse>(`${base}/understanding`);
        profileChanged(latest.profile);
        return fn(latest.profile.revision);
      }
    },
    [base, profileChanged],
  );

  const exposure = useCallback(
    (action: ExposureAction, ids: { conceptId?: string; itemId?: string }) => {
      if (!projectId) return;
      apiPost(`${base}/understanding/feedback`, { baseRevision: rev.current, sessionKey, requestId: requestId(), event: { kind: 'exposure', action, ...ids } }).catch(() => {
        // 노출 기록 실패는 읽기를 막지 않는다
      });
    },
    [base, projectId, sessionKey],
  );

  const send = useCallback(
    async (event: object) => {
      const id = requestId();
      const res = await withRevision((baseRevision) => apiPost<{ profile: LearnerProfile }>(`${base}/understanding/feedback`, { baseRevision, sessionKey, requestId: id, event }));
      profileChanged(res.profile);
    },
    [base, profileChanged, sessionKey, withRevision],
  );

  return {
    revision: () => rev.current,
    exposure,
    selfReport: (conceptId, value) => send({ kind: 'self_report', conceptId, value }),
    correction: (conceptId, note) => send({ kind: 'correction', conceptId, ...(note ? { note } : {}) }),
    withRevision,
    profileChanged,
  };
}
