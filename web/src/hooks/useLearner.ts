import { useCallback, useEffect, useRef } from 'react';
import type { ExposureAction, LearnerProfile, SelfReport } from '@vibe-teacher/shared';
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

/**
 * 내 이해 정보 쓰기 (사용자 전체 프로필, /api/me). sessionKey 를 주면 이벤트에 그 세션·프로젝트가 남는다.
 */
export function useLearnerActions(sessionKey: string | undefined, revision: number, onProfile: (p: LearnerProfile) => void): LearnerActions {
  const rev = useRef(revision);
  useEffect(() => {
    rev.current = revision;
  }, [revision]);

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
        const latest = await api<{ profile: LearnerProfile }>('/api/me/profile');
        profileChanged(latest.profile);
        return fn(latest.profile.revision);
      }
    },
    [profileChanged],
  );

  const exposure = useCallback(
    (action: ExposureAction, ids: { conceptId?: string; itemId?: string }) => {
      apiPost('/api/me/feedback', { baseRevision: rev.current, ...(sessionKey ? { sessionKey } : {}), requestId: requestId(), event: { kind: 'exposure', action, ...ids } }).catch(() => {
        // 노출 기록 실패는 읽기를 막지 않는다
      });
    },
    [sessionKey],
  );

  const send = useCallback(
    async (event: object) => {
      const id = requestId();
      const res = await withRevision((baseRevision) => apiPost<{ profile: LearnerProfile }>('/api/me/feedback', { baseRevision, ...(sessionKey ? { sessionKey } : {}), requestId: id, event }));
      profileChanged(res.profile);
    },
    [profileChanged, sessionKey, withRevision],
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
