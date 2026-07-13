import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const ACCESS_TOKEN_KEY = "rfid_access_token";
const REFRESH_TOKEN_KEY = "rfid_refresh_token";

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}
export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("No refresh token available");
  const { data } = await axios.post("/api/auth/refresh", { refreshToken });
  setTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isAuthRoute = originalRequest?.url?.includes("/auth/");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
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
    return (err.response?.data as { error?: string })?.error ?? fallback;
  }
  return fallback;
}
