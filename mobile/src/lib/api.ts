import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getApiBaseUrl } from "./config";
import { getAccessToken, getSessionToken, setAccessToken, clearTokens } from "./tokenStorage";

// No baseURL set here — resolved per-request in the interceptor below since
// it can change at runtime (Settings screen), unlike the web client's fixed
// "/api" dev-proxy path.
export const api = axios.create({ timeout: 20_000 });

// Fires once, after tokens are cleared, so AuthContext can drop the user
// back to the Login screen. Plain callback rather than a navigation import
// here — this module has no business knowing about the navigator.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

api.interceptors.request.use(async (config) => {
  const baseUrl = await getApiBaseUrl();
  config.baseURL = `${baseUrl}/api`;
  if (!config.headers.Authorization) {
    const token = await getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function mintFreshAccessToken(): Promise<string> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) throw new Error("No session token available");
  const baseUrl = await getApiBaseUrl();
  const { data } = await axios.get(`${baseUrl}/api/auth/token`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  await setAccessToken(data.token);
  return data.token;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isAuthRoute = originalRequest?.url?.includes("/auth/");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= mintFreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const newToken = await refreshPromise;
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch {
        await clearTokens();
        onUnauthorized?.();
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string; message?: string })?.error ?? (err.response?.data as { message?: string })?.message ?? fallback;
  }
  return fallback;
}
