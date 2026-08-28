'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, lastUsername, tokenStore } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on first paint so a refresh doesn't sign you out.
  useEffect(() => {
    const stored = tokenStore.get();
    if (!stored) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .me(stored)
      .then(({ user: u }) => {
        if (cancelled) return;
        setUser(u);
        setToken(stored);
      })
      .catch(() => tokenStore.clear())
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((next: { user: AuthUser; token: string }) => {
    tokenStore.set(next.token);
    lastUsername.set(next.user.username);
    setUser(next.user);
    setToken(next.token);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => adopt(await api.login(username, password)),
    [adopt]
  );

  const register = useCallback(
    async (username: string, password: string) => adopt(await api.register(username, password)),
    [adopt]
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout }),
    [user, token, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
