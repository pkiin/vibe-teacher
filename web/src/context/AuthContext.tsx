import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthMeResponse } from '@vibe-teacher/shared';
import { api, apiPost, onUnauthorized } from '../api/client';

interface AuthState {
  me: AuthMeResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<AuthMeResponse>('/api/auth/me'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onUnauthorized(() => {
      // 세션이 만료되면 로그인 화면으로
      setMe((prev) => (prev && prev.authenticated && prev.mode === 'home-token' ? { ...prev, authenticated: false, username: undefined, isAdmin: undefined } : prev));
    });
  }, [refresh]);

  const login = useCallback(
    async (username: string, token: string) => {
      await apiPost('/api/auth/login', { username, token });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      await refresh();
    }
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, error, refresh, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider 안에서만 쓸 수 있습니다');
  return v;
}
