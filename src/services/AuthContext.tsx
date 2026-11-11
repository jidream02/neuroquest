import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import * as auth from './auth';
import { audit } from '../db/repo';
import { loadServerUrl } from './dmApi';

/** Через сколько времени в фоне приложение блокируется. */
export const AUTO_LOCK_MS = 2 * 60_000;

interface AuthValue {
  session: auth.Session | null;
  ready: boolean;
  signIn: (s: auth.Session) => void;
  signOut: (reason?: 'logout' | 'auto_lock') => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [session, setSession] = useState<auth.Session | null>(null);
  const [ready, setReady] = useState(false);
  const sessionRef = useRef<auth.Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Восстановление сессии после перезапуска приложения.
  useEffect(() => {
    Promise.all([auth.loadSession(db).then(setSession), loadServerUrl()])
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, [db]);

  const signOut = useCallback(
    async (reason: 'logout' | 'auto_lock' = 'logout') => {
      const s = sessionRef.current;
      if (s) await audit(db, s.userId, reason).catch(() => {});
      await auth.endSession();
      setSession(null);
    },
    [db],
  );

  // Автоблокировка: ушли в фон → запоминаем время; вернулись позже AUTO_LOCK_MS или сессия истекла → выход.
  useEffect(() => {
    let backgroundAt = 0;
    const sub = AppState.addEventListener('change', (state) => {
      const s = sessionRef.current;
      if (!s) return;
      if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      } else if (state === 'active') {
        const away = backgroundAt ? Date.now() - backgroundAt : 0;
        backgroundAt = 0;
        if (away > AUTO_LOCK_MS || s.expiresAt < Date.now()) void signOut('auto_lock');
        else void auth.touchSession(s).then(setSession);
      }
    });
    return () => sub.remove();
  }, [signOut]);

  // Продлеваем сессию, пока пользователь активен (раз в 5 минут).
  const activeUserId = session?.userId;
  useEffect(() => {
    if (!activeUserId) return;
    const t = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.expiresAt < Date.now()) void signOut('auto_lock');
      else void auth.touchSession(s).then(setSession);
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [activeUserId, signOut]);

  return <AuthContext.Provider value={{ session, ready, signIn: setSession, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth вне AuthProvider');
  return v;
}

/** Для экранов внутри защищённой зоны: сессия гарантированно есть. */
export function useSession(): auth.Session {
  const { session } = useAuth();
  if (!session) throw new Error('Нет активной сессии');
  return session;
}
