import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthMeResponse, SignupResponse } from '@vibe-teacher/shared';
import { api, apiPost, clearApiCache, getToken, onUnauthorized, setToken } from '../api/client';

interface AuthState {
  me: AuthMeResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string) => Promise<SignupResponse>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    clearApiCache();
    try {
      let result = await api<AuthMeResponse>('/api/auth/me');
      if (result.mode === 'supabase' && getToken()) {
        setToken(null);
        result = await api<AuthMeResponse>('/api/auth/me');
      }
      setMe(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setMe(null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
    return onUnauthorized(() => {
      // 세션이 만료되면 로그인 화면으로
      setMe((prev) => (prev && prev.authenticated && prev.mode !== 'none' ? { ...prev, authenticated: false, username: undefined, isAdmin: undefined, canManageInstallation: false, canManageScan: false, reader: null, email: undefined } : prev));
    });
  }, [refresh]);

  const login = useCallback(
    async (username: string, token: string) => {
      await apiPost('/api/auth/login', me?.mode === 'supabase' ? { email: username, password: token } : { username, token });
      await refresh();
    },
    [refresh, me?.mode],
  );

  const signup = useCallback(async (email: string, password: string) => {
    const result = await apiPost<SignupResponse>('/api/auth/signup', { email, password });
    if (!result.confirmationRequired) await refresh();
    return result;
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      await refresh();
    }
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, error, refresh, login, logout, signup }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider 안에서만 쓸 수 있습니다');
  return v;
}
