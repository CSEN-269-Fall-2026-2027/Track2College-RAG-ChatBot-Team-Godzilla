import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setAccessToken } from "./api";
import { getStore, type Session, type SignUpResult } from "./data";
import type { Account } from "./types";

export { AuthError } from "./data";

interface AuthContextValue {
  account: Account | null;
  loading: boolean;
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((next: Session | null) => {
    setAccessToken(next?.accessToken ?? null);
    setSession(next);
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    getStore().then(async (store) => {
      const initial = await store.auth.getSession();
      if (cancelled) return;
      apply(initial);
      setLoading(false);
      unsubscribe = store.auth.onChange(apply);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [apply]);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const result = await (await getStore()).auth.signUp(name, email, password);
    if ("session" in result) apply(result.session);
    return result;
  }, [apply]);

  const signIn = useCallback(async (email: string, password: string) => {
    apply(await (await getStore()).auth.signIn(email, password));
  }, [apply]);

  const signOut = useCallback(async () => {
    await (await getStore()).auth.signOut();
    apply(null);
  }, [apply]);

  const value = useMemo(
    () => ({ account: session?.account ?? null, loading, signUp, signIn, signOut }),
    [session, loading, signUp, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
