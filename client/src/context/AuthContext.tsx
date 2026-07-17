import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, getAccessToken, getSessionToken, setSessionToken, setAccessToken, clearTokens } from "@/lib/api";
import type { CompanyIndustry, User } from "@/types";

interface RegisterCompanyInput {
  companyName: string;
  slug: string;
  contactEmail?: string;
  fullName: string;
  email: string;
  password: string;
  industry?: CompanyIndustry;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  registerCompany: (input: RegisterCompanyInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<User>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
      clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sign-in/sign-up only return better-auth's own session token — a JWT
  // has to be minted from it separately before this app's own API routes
  // (or the dashboard websocket) will accept it.
  const establishSession = useCallback(
    async (sessionToken: string) => {
      setSessionToken(sessionToken);
      const { data } = await api.get("/auth/token", { headers: { Authorization: `Bearer ${sessionToken}` } });
      setAccessToken(data.token);
      await refreshUser();
    },
    [refreshUser]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post("/auth/sign-in/email", { email, password });
      await establishSession(data.token);
    },
    [establishSession]
  );

  const registerCompany = useCallback(
    async (input: RegisterCompanyInput) => {
      const { data } = await api.post("/auth/register-company", input);
      await establishSession(data.token);
    },
    [establishSession]
  );

  const logout = useCallback(async () => {
    const sessionToken = getSessionToken();
    try {
      if (sessionToken) await api.post("/auth/sign-out", {}, { headers: { Authorization: `Bearer ${sessionToken}` } });
    } catch {
      // ignore — we're logging out regardless
    }
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, registerCompany, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
