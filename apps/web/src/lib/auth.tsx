import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Auth, User as FirebaseUser } from 'firebase/auth';
import { appConfig } from './config';
import { ApiError, publicApi, setAuthTokenGetter, setUnauthorizedHandler } from './api';
import { FullPageSpinner } from '@/components/ui/spinner';

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: 'firebase' | 'dev';
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName?: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
  /** Reloads the user from the auth provider (e.g. after verifying email). Returns the fresh user. */
  refreshUser(): Promise<AuthUser | null>;
  getIdToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const DEV_AUTH_STORAGE_KEY = 'chatpilot.devAuth';

interface DevSession {
  token: string;
  uid: string;
  email: string;
  displayName?: string;
}

function readDevSession(): DevSession | null {
  try {
    const raw = localStorage.getItem(DEV_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevSession;
    return parsed?.token && parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

function writeDevSession(s: DevSession | null) {
  try {
    if (s) localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Maps Firebase / API auth errors to friendly messages. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
    'auth/weak-password': 'Please choose a stronger password (at least 8 characters).',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled.',
  };
  if (map[code]) return map[code];
  if (e instanceof ApiError) return e.code === 'network_error' ? 'Could not reach the server. Is the API running?' : e.message;
  if (e instanceof Error && e.message) return e.message.replace(/^Firebase:\s*/, '');
  return 'Something went wrong. Please try again.';
}

function toAuthUser(u: FirebaseUser): AuthUser {
  return { uid: u.uid, email: u.email ?? '', emailVerified: u.emailVerified, displayName: u.displayName ?? undefined };
}

type FirebaseHandle = { auth: Auth; mod: typeof import('firebase/auth') };

async function loadFirebaseAuth(): Promise<FirebaseHandle> {
  const [{ initializeApp, getApps, getApp }, mod] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: appConfig.firebase.apiKey,
        authDomain: appConfig.firebase.authDomain,
        projectId: appConfig.firebase.projectId,
        appId: appConfig.firebase.appId,
      });
  return { auth: mod.getAuth(app), mod };
}

function devUser(s: DevSession | null): AuthUser | null {
  return s ? { uid: s.uid, email: s.email, emailVerified: true, displayName: s.displayName } : null;
}

export function AuthProvider({ children, mode = appConfig.authMode }: { children: ReactNode; mode?: 'firebase' | 'dev' }) {
  const [user, setUser] = useState<AuthUser | null>(() => (mode === 'dev' ? devUser(readDevSession()) : null));
  const [loading, setLoading] = useState(mode !== 'dev');
  const fbReady = useRef<Promise<FirebaseHandle> | null>(null);

  const getFirebase = useCallback(() => {
    if (!fbReady.current) fbReady.current = loadFirebaseAuth();
    return fbReady.current;
  }, []);

  // Firebase session restore + token refresh tracking
  useEffect(() => {
    if (mode === 'dev') return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    getFirebase()
      .then(({ auth, mod }) => {
        if (cancelled) return;
        unsub = mod.onIdTokenChanged(auth, (u) => {
          setUser(u ? toAuthUser(u) : null);
          setLoading(false);
        });
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [mode, getFirebase]);

  // Keep dev sessions in sync across tabs
  useEffect(() => {
    if (mode !== 'dev') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_AUTH_STORAGE_KEY) setUser(devUser(readDevSession()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mode]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (mode === 'dev') return readDevSession()?.token ?? null;
    const { auth } = await getFirebase();
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  }, [mode, getFirebase]);

  const signOut = useCallback(async () => {
    if (mode === 'dev') {
      writeDevSession(null);
      setUser(null);
      return;
    }
    const { auth, mod } = await getFirebase();
    await mod.signOut(auth);
    setUser(null);
  }, [mode, getFirebase]);

  // Wire the API client to this auth layer.
  useEffect(() => {
    setAuthTokenGetter(getIdToken);
    setUnauthorizedHandler(
      mode === 'dev'
        ? () => {
            // Dev tokens become invalid when the API restarts with a fresh store/secret.
            if (readDevSession()) {
              writeDevSession(null);
              setUser(null);
            }
          }
        : null,
    );
    return () => {
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [getIdToken, mode]);

  const devLogin = useCallback(async (email: string, displayName?: string) => {
    const res = await publicApi.post<{ token: string; uid: string; email: string }>('/dev/login', {
      email: email.trim().toLowerCase(),
    });
    const prev = readDevSession();
    const session: DevSession = {
      token: res.token,
      uid: res.uid,
      email: res.email,
      displayName: displayName || (prev?.email === res.email ? prev.displayName : undefined),
    };
    writeDevSession(session);
    setUser(devUser(session));
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (mode === 'dev') return devLogin(email);
      const { auth, mod } = await getFirebase();
      const cred = await mod.signInWithEmailAndPassword(auth, email.trim(), password);
      setUser(toAuthUser(cred.user));
    },
    [mode, devLogin, getFirebase],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      if (mode === 'dev') return devLogin(email, displayName);
      const { auth, mod } = await getFirebase();
      const cred = await mod.createUserWithEmailAndPassword(auth, email.trim(), password);
      if (displayName) await mod.updateProfile(cred.user, { displayName });
      try {
        await mod.sendEmailVerification(cred.user, { url: `${appConfig.appUrl}/verify-email` });
      } catch {
        /* the user can resend from the verify page */
      }
      setUser(toAuthUser(cred.user));
    },
    [mode, devLogin, getFirebase],
  );

  const resetPassword = useCallback(
    async (email: string) => {
      if (mode === 'dev') return; // no passwords in dev mode
      const { auth, mod } = await getFirebase();
      await mod.sendPasswordResetEmail(auth, email.trim(), { url: `${appConfig.appUrl}/login` });
    },
    [mode, getFirebase],
  );

  const resendVerification = useCallback(async () => {
    if (mode === 'dev') return;
    const { auth, mod } = await getFirebase();
    if (!auth.currentUser) throw new Error('You need to be signed in.');
    await mod.sendEmailVerification(auth.currentUser, { url: `${appConfig.appUrl}/verify-email` });
  }, [mode, getFirebase]);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    if (mode === 'dev') return devUser(readDevSession());
    const { auth } = await getFirebase();
    if (!auth.currentUser) return null;
    await auth.currentUser.reload();
    // Force a fresh token so the API sees email_verified=true.
    await auth.currentUser.getIdToken(true);
    const fresh = toAuthUser(auth.currentUser);
    setUser(fresh);
    return fresh;
  }, [mode, getFirebase]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, mode, signIn, signUp, signOut, resetPassword, resendVerification, refreshUser, getIdToken }),
    [user, loading, mode, signIn, signUp, signOut, resetPassword, resendVerification, refreshUser, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Route guard: redirects signed-out visitors to /login?next=<current path>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner label="Checking your session…" />;
  if (!user) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

/** Inverse guard for /login and /register: signed-in users go straight to ?next or /app. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading, mode } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (user) {
    const next = safeNext(new URLSearchParams(location.search).get('next'));
    if (mode === 'firebase' && !user.emailVerified) {
      return <Navigate to={`/verify-email?next=${encodeURIComponent(next)}`} replace />;
    }
    return <Navigate to={next} replace />;
  }
  return <>{children}</>;
}
