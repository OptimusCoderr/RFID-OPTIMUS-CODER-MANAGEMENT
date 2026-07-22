# RFID Optimus — Mobile (Expo)

A companion/dashboard mobile app for the same backend the web client
(`../client`) and desktop agent (`../server/agent`) talk to. It's a
**separate, independent Expo/React Native project** — not a shared
monorepo package — that authenticates against the same better-auth
endpoints and calls the same `/api/*` REST routes.

## Scope (read-mostly companion + NFC tap-in, not a desktop-agent replacement)

This app is for looking things up on the go — dashboard stats, card status,
holder roster, attendance history, notifications — plus one write path:
tapping a physical card against the phone to record an attendance
check-in/out, the same way a desktop encoder tap does. It does **not**
attempt to replace the rest of the USB PC/SC encoder workflow — writing
MIFARE/DESFire sector keys, encoding cards, and managing
write-protect/citizen-data all still require the desktop agent's direct
hardware access, which a phone doesn't have in the same way.

- **Dashboard** — stat tiles (cards, holders, currently present, encoders
  online, maintenance, visitor passes) + recent activity feed
- **Cards** — searchable list + read-only detail view
- **Holders** — searchable list with card counts
- **Tap In** — hold a card to the phone to record a check-in/out (see
  below)
- **Attendance** — recent check-in/check-out records
- **Notifications** — list + mark read / mark all read
- **Profile** — signed-in user info, API server address, sign out

### Tap In

`src/lib/nfc.ts` wraps `react-native-nfc-manager` to read just a tapped
card's UID — never its NDEF content or sector/file data, and never
authenticated with a key — so it works against any card already registered
in the system regardless of what key (if any) the desktop side has stored
for it. The screen then:

1. Looks the UID up via `GET /api/cards?search=<uid>` (exact match against
   the results — the server's `search` is a substring match, so this
   narrows it to the one card whose UID matches exactly)
2. `POST /api/attendance` with that card's id (and the selected zone, if
   any) — the exact same endpoint and toggle logic (FREE / CHECK_IN_ONLY /
   etc., per whichever schedule is open) that a desktop encoder tap uses.
   `encoderId` is intentionally omitted — attendance recording doesn't
   require one, so tap-in never needs to register the phone itself as an
   `Encoder` in the system.

No server changes were needed for this — `POST /api/attendance` already
accepted `cardId` + optional `zoneId` with no `encoderId` requirement.

**This screen needs a custom dev-client build, not just Expo Go** — see
the next section.

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

Every screen *except* Tap In works fine in plain Expo Go this way.

## Building a dev client (required for Tap In / NFC)

`react-native-nfc-manager` is a native module — Expo Go's prebuilt binary
doesn't include it, and can't (Expo Go can't include every possible native
module, which is exactly what a custom dev-client build is for). Without
one, the Tap In screen loads and correctly reports "NFC isn't available"
(see `isNfcSupported()` in `src/lib/nfc.ts`, which treats a missing native
module the same as no hardware) rather than crashing — but you won't get a
real scan.

To get a build that includes it:

```bash
npx expo install expo-dev-client   # already in package.json — just documenting why it's there
npx expo prebuild                  # generates ios/ and android/ native projects from app.json
npx expo run:android               # builds + installs on a connected device/emulator
npx expo run:ios                   # builds + installs on the simulator or a connected device
```

Or, without a local Android Studio/Xcode setup, use an
[EAS Build](https://docs.expo.dev/build/introduction/) development build
instead of `expo run:*`. Either way, `npm start` still works afterward —
point the resulting dev-client app at the same Metro server instead of
Expo Go.

The `react-native-nfc-manager` config plugin (wired into `app.json`'s
`expo.plugins`) handles the platform-specific wiring during `prebuild`:
the iOS `NFCReaderUsageDescription` string + `nfc.readersession.formats`
entitlement, and the Android `NFC` permission.

**Not verified against physical hardware.** This code was written and
bundle-verified (Metro resolves every import cleanly, `tsc` passes) in a
sandboxed environment with no NFC reader attached, so the exact tag-tech
list in `src/lib/nfc.ts` (`READ_TECH`) is based on the library's documented
API rather than a confirmed real-device read against a MIFARE/DESFire
card. If a tap doesn't resolve a UID on your device, that tech list is the
first place to adjust.

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
      nfc.ts                  — NFC tag-UID read wrapper (Tap In screen)
    context/AuthContext.tsx  — sign-in/sign-out, current user
    navigation/
      RootNavigator.tsx       — Login vs. main app stack
      MainTabs.tsx             — bottom tab bar
    screens/                  — one file per screen (see Scope above)
    components/Badge.tsx      — status pill, shared across screens
    theme.ts                  — color palette (matches the web client's dark theme)
    types/index.ts            — hand-copied subset of client/src/types/index.ts
```
