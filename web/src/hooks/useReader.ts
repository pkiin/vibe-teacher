import { useCallback } from 'react';
import { DEFAULT_READER_LEVEL, type ReaderLevel, type ReaderPrefs } from '@vibe-teacher/shared';
import { apiPut } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** 읽는 사람 수준. 바꾸면 서버에 저장하고 로그인 정보를 다시 받아 모든 화면이 새 수준으로 다시 불러온다 */
export function useReader(): { level: ReaderLevel; chosen: boolean; available: boolean; setLevel: (level: ReaderLevel) => Promise<void> } {
  const { me, refresh } = useAuth();
  const reader = me?.reader ?? null;
  const setLevel = useCallback(
    async (level: ReaderLevel) => {
      await apiPut<ReaderPrefs>('/api/me/prefs', { readerLevel: level });
      await refresh();
    },
    [refresh],
  );
  return { level: reader?.readerLevel ?? DEFAULT_READER_LEVEL, chosen: !!reader?.chosen, available: !!reader, setLevel };
}
