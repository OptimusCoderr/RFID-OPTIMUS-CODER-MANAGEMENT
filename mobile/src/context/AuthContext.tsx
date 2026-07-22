import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from "react";
import { api, setOnUnauthorized } from "@/lib/api";
import { getAccessToken, getSessionToken, setSessionToken, setAccessToken, clearTokens } from "@/lib/tokenStorage";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<User>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
      await clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // If a refresh attempt fails (session token itself expired/revoked), the
  // API layer clears tokens and calls this so the UI drops back to Login
  // instead of quietly failing every subsequent request.
  useEffect(() => {
    setOnUnauthorized(() => setUser(null));
    return () => setOnUnauthorized(null);
  }, []);

  // Sign-in only returns better-auth's own session token — a JWT has to be
  // minted from it separately before this app's own API routes accept it.
  // Same two-step flow as the web client's AuthContext.
  const establishSession = useCallback(async (sessionToken: string) => {
    await setSessionToken(sessionToken);
    const { data } = await api.get("/auth/token", { headers: { Authorization: `Bearer ${sessionToken}` } });
    await setAccessToken(data.token);
    await refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post("/auth/sign-in/email", { email, password });
      await establishSession(data.token);
    },
    [establishSession]
  );

  const logout = useCallback(async () => {
    const sessionToken = await getSessionToken();
    try {
      if (sessionToken) await api.post("/auth/sign-out", {}, { headers: { Authorization: `Bearer ${sessionToken}` } });
    } catch {
      // ignore — we're logging out regardless
    }
    await clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refreshUser }), [user, loading, login, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
