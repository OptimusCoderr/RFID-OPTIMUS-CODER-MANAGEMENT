import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, setTokens, clearTokens, getAccessToken } from "@/lib/api";
import type { User } from "@/types";

interface RegisterCompanyInput {
  companyName: string;
  slug: string;
  contactEmail?: string;
  fullName: string;
  email: string;
  password: string;
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

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }, []);

  const registerCompany = useCallback(async (input: RegisterCompanyInput) => {
    const { data } = await api.post("/auth/register-company", input);
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem("rfid_refresh_token");
    try {
      if (refreshToken) await api.post("/auth/logout", { refreshToken });
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
