import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// The web client talks to "/api" and lets Vite's dev proxy (or the same
// production origin) resolve the host. A native app has no such proxy — it
// needs a real, reachable host:port, and that's something only the person
// running this app can know (their LAN IP, a tunnel, a deployed URL). This
// ships a build-time default (app.json's expo.extra.apiUrl) but lets it be
// overridden at runtime from the Settings screen, persisted across restarts,
// so switching backends doesn't require a rebuild.
const API_URL_KEY = "rfid_api_base_url";

const BUILD_DEFAULT_API_URL = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:4000";

export async function getApiBaseUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(API_URL_KEY);
  return stored ?? BUILD_DEFAULT_API_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(API_URL_KEY, url.replace(/\/+$/, ""));
}

export function getBuildDefaultApiUrl(): string {
  return BUILD_DEFAULT_API_URL;
}
