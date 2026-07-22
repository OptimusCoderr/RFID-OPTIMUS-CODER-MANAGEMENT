# RFID Optimus — Mobile (Expo)

A companion/dashboard mobile app for the same backend the web client
(`../client`) and desktop agent (`../server/agent`) talk to. It's a
**separate, independent Expo/React Native project** — not a shared
monorepo package — that authenticates against the same better-auth
endpoints and calls the same `/api/*` REST routes.

## Scope (read-mostly companion, not a desktop-agent replacement)

This app is for looking things up on the go: dashboard stats, card status,
holder roster, attendance history, notifications. It does **not** attempt
to replace the USB PC/SC encoder workflow — writing MIFARE/DESFire sector
keys, encoding cards, and managing write-protect/citizen-data all require
the desktop agent's direct hardware access, which a phone doesn't have in
the same way. A future iteration could add native NFC for simple tap-based
attendance check-in (Android's NFC APIs support this; iOS Core NFC is more
limited), but that's out of scope for this first pass — see the app's
screens for what's implemented today:

- **Dashboard** — stat tiles (cards, holders, currently present, encoders
  online, maintenance, visitor passes) + recent activity feed
- **Cards** — searchable list + read-only detail view
- **Holders** — searchable list with card counts
- **Attendance** — recent check-in/check-out records
- **Notifications** — list + mark read / mark all read
- **Profile** — signed-in user info, API server address, sign out

Everything here reuses the exact same REST endpoints and better-auth flow
the web client uses (see `../client/src/lib/api.ts` and
`../client/src/context/AuthContext.tsx` — this app's `src/lib/api.ts` and
`src/context/AuthContext.tsx` are the React Native equivalents).

## Why a separate folder instead of one shared codebase

React Native and the web client's Vite/DOM stack don't share a build or
component layer, so there's nothing to gain from forcing them into one
package — a hand-copied subset of `client/src/types/index.ts` (see
`src/types/index.ts`) is enough to keep the two in sync without a shared
workspace's coordination overhead. If this app grows to need most of the
web client's types, revisit that.

## Setup

```bash
cd mobile
npm install
npm start   # opens Expo Dev Tools — press "a"/"i"/"w" for Android/iOS/web,
            # or scan the QR code with Expo Go on a physical device
```

## Pointing it at your backend

Unlike the web client, there's no dev-proxy rewriting `/api` to
`localhost:4000` — a phone (physical or emulator) needs a real, reachable
host:port for the server:

- **Android emulator**: the host machine is reachable at `10.0.2.2`, so
  `http://10.0.2.2:4000` if the server's running on your dev machine.
- **iOS simulator**: `http://localhost:4000` works directly.
- **Physical device (Expo Go)**: use your dev machine's LAN IP, e.g.
  `http://192.168.1.10:4000` — the phone and server must be on the same
  network (or reachable via a tunnel like `ngrok`).

The build-time default lives in `app.json` under `expo.extra.apiUrl`. It
can be overridden at runtime, per-install, from the **Profile → API
server** field — persisted in SecureStore so it survives app restarts.
Changing it signs you out, since the previously-issued JWT won't verify
against a different server.

No server-side changes are needed to support this: `cors` in
`server/src/app.ts` only affects *browser* requests (it's enforced by the
browser reading the response, not the server rejecting the request), and a
native app's HTTP client doesn't send an `Origin` header the way a browser
does — so CORS doesn't come into play here at all.

## Auth model

Same two-token better-auth flow as the web client:

1. `POST /api/auth/sign-in/email` → a long-lived session token
2. `GET /api/auth/token` (bearer: session token) → mints a short-lived JWT
3. Every other API call uses the JWT; a 401 triggers minting a fresh one
   from the still-valid session token (see the response interceptor in
   `src/lib/api.ts`)

Both tokens live in `expo-secure-store` (iOS Keychain / Android Keystore),
not plain storage.

## Project layout

```
mobile/
  App.tsx                    — root: QueryClientProvider, AuthProvider, NavigationContainer
  src/
    lib/
      api.ts                 — axios instance, 401-refresh interceptor
      config.ts               — runtime-configurable API base URL
      tokenStorage.ts         — SecureStore-backed token get/set/clear
    context/AuthContext.tsx  — sign-in/sign-out, current user
    navigation/
      RootNavigator.tsx       — Login vs. main app stack
      MainTabs.tsx             — bottom tab bar
    screens/                  — one file per screen (see Scope above)
    components/Badge.tsx      — status pill, shared across screens
    theme.ts                  — color palette (matches the web client's dark theme)
    types/index.ts            — hand-copied subset of client/src/types/index.ts
```
