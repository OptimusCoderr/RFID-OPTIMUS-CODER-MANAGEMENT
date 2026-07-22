import * as SecureStore from "expo-secure-store";

// Same two-token model as client/src/lib/api.ts: a long-lived better-auth
// session token (only ever sent to better-auth's own endpoints) and a
// short-lived JWT minted from it (sent to every app API call). SecureStore
// backs onto Keychain/Keystore instead of localStorage.
const SESSION_TOKEN_KEY = "rfid_session_token";
const JWT_KEY = "rfid_jwt";

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}
export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}
export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(JWT_KEY);
}
export async function setAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(JWT_KEY, token);
}
export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  await SecureStore.deleteItemAsync(JWT_KEY);
}
