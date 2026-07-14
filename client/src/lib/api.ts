import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

// Two different tokens, both from better-auth:
// - The session token (from sign-in/sign-up) is long-lived (~30 days) and is
//   only ever sent to better-auth's own endpoints (sign-out, list/revoke
//   sessions, minting a fresh JWT) — never to this app's own API routes.
// - The JWT (minted from the session via GET /auth/token) is short-lived
//   (15 min) and is what every app API call and the dashboard websocket
//   authenticate with, verified statelessly via JWKS with no DB round-trip.
const SESSION_TOKEN_KEY = "rfid_session_token";
const JWT_KEY = "rfid_jwt";

export function getSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}
export function setSessionToken(token: string) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}
export function getAccessToken() {
  return localStorage.getItem(JWT_KEY);
}
export function setAccessToken(token: string) {
  localStorage.setItem(JWT_KEY, token);
}
export function clearTokens() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(JWT_KEY);
}

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  // A caller-supplied Authorization header wins — used for the handful of
  // better-auth endpoints (session listing/revocation, change-password,
  // update-user, sign-out) that authenticate with the session token rather
  // than this app's usual JWT.
  if (config.headers.Authorization) return config;
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

// Mints a fresh JWT from the still-valid session token — the JWT equivalent
// of the old refresh-token rotation flow.
async function mintFreshAccessToken(): Promise<string> {
  const sessionToken = getSessionToken();
  if (!sessionToken) throw new Error("No session token available");
  const { data } = await axios.get("/api/auth/token", { headers: { Authorization: `Bearer ${sessionToken}` } });
  setAccessToken(data.token);
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
        clearTokens();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

function saveBlob(data: BlobPart, filename: string) {
  const blobUrl = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export async function downloadCsv(url: string, params: Record<string, unknown>, filename: string) {
  const response = await api.get(url, { params, responseType: "blob" });
  saveBlob(response.data, filename);
}

export async function downloadPost(url: string, body: Record<string, unknown>, filename: string) {
  const response = await api.post(url, body, { responseType: "blob" });
  saveBlob(response.data, filename);
}

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string; message?: string })?.error ?? (err.response?.data as { message?: string })?.message ?? fallback;
  }
  return fallback;
}
