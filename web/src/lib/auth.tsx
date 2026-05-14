import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/**
 * Auth = a single shared secret (the Bearer token) stored in localStorage.
 * Until the onboarding wizard (P9) issues a real per-device secret, this is
 * the BOOTSTRAP_SECRET the user pastes on the Welcome screen.
 */
const STORAGE_KEY = 'vox.shared_secret';

interface AuthContextValue {
  secret: string | null;
  isAuthed: boolean;
  setSecret: (s: string) => void;
  clearSecret: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [secret, setSecretState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setSecret = useCallback((s: string) => {
    const trimmed = s.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    setSecretState(trimmed);
  }, []);

  const clearSecret = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSecretState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ secret, isAuthed: Boolean(secret), setSecret, clearSecret }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/** Read the secret outside React (for the api client). */
export function readSecret(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
