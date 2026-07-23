# RFID Optimus — Mobile (Expo)

> **Setting this up on a real Windows/Linux machine, or want to actually
> run it and test it end-to-end (including Tap In on a physical device)?
> See [`TESTING.md`](./TESTING.md)** — full toolchain install, build, and
> a manual QA checklist. This file covers architecture and design
> decisions; that one covers "how do I actually run this."

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

## Setup: build a dev client (don't use Expo Go)

This app includes `react-native-nfc-manager` for Tap In — a native module
Expo Go's prebuilt binary doesn't (and can't) include, since Expo Go can
only ever ship the fixed set of modules Expo bundled into it. Once a
native module is in the dependency tree, **the project needs its own
custom-built dev client, not Expo Go, even to run the screens that don't
use NFC** — Expo Go would just be missing the module the JS bundle
imports. `npm run android` / `npm run ios` below are wired to Expo's
`expo run:*` commands for exactly this reason.

```bash
cd mobile
npm install
npx expo prebuild      # generates android/ + ios/ (gitignored — regenerated
                        # from app.json + config plugins, never hand-edited
                        # or committed) — expo run:* below does this
                        # automatically if you skip it
npm run android         # builds + installs a debug dev-client build on a
                         # connected device/emulator (needs Android Studio /
                         # the Android SDK installed locally)
npm run ios              # same, for the simulator or a connected device
                          # (needs Xcode — macOS only)
```

No local Android Studio/Xcode setup? Use an
[EAS Build](https://docs.expo.dev/build/introduction/) development build
instead — it builds in the cloud and gives you an installable app/APK.
Either path, once the dev-client app is installed, `npm start` runs Metro
as usual — the installed app has its own connect screen (branded
"RFID Optimus", built from this project, not Expo Go) for pointing it at
that Metro server.

The `react-native-nfc-manager` config plugin (wired into `app.json`'s
`expo.plugins`) handles the platform-specific wiring during `prebuild`:
the iOS `NFCReaderUsageDescription` string + `nfc.readersession.formats`
entitlement, and the Android `NFC` permission.

### Not built or run against real hardware here

I attempted the actual `expo prebuild` + Gradle build in the sandboxed
environment this app was developed in, to confirm this works rather than
just documenting it from the library's README. `expo prebuild` itself
succeeded (it's pure Node/config-plugin codegen, no SDK needed) — but the
build past that point isn't something this environment can do:

- No Android SDK is installed (no `ANDROID_HOME`, no `platform-tools`),
  and the network policy here doesn't allow downloading one — the Gradle
  wrapper's own distribution download came back `403`, and Gradle's plugin
  repository resolution failed similarly even in offline mode against the
  preinstalled system Gradle.
- iOS builds need Xcode, which only runs on macOS — this environment is
  Linux, so there's no path to an iOS build here at all, independent of
  network access.

None of that is fixable by trying harder in this environment — it needs
an actual Android SDK (locally or via EAS Build's cloud builders) and, for
iOS, an actual Mac. So: `tsc`, ESLint, and Metro's full bundle resolution
are all verified clean (every import in the NFC code resolves, nothing
references a nonexistent API), but the NFC read itself — the tag-tech
list in `src/lib/nfc.ts` (`READ_TECH`), UID casing, session lifecycle —
has never run against a real reader or a real card. Treat it as
implemented-not-verified until it's been tapped against real hardware.

## Pointing it at your backend

Unlike the web client, there's no dev-proxy rewriting `/api` to
`localhost:4000` — a phone (physical or emulator) needs a real, reachable
host:port for the server:

- **Android emulator**: the host machine is reachable at `10.0.2.2`, so
  `http://10.0.2.2:4000` if the server's running on your dev machine.
- **iOS simulator**: `http://localhost:4000` works directly.
- **Physical device**: use your dev machine's LAN IP, e.g.
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
      nfcUid.ts               — pure UID-normalization logic, split out of nfc.ts so it's unit-testable (see nfcUid.test.ts, TESTING.md)
    context/AuthContext.tsx  — sign-in/sign-out, current user
    navigation/
      RootNavigator.tsx       — Login vs. main app stack
      MainTabs.tsx             — bottom tab bar
    screens/                  — one file per screen (see Scope above)
    components/Badge.tsx      — status pill, shared across screens
    theme.ts                  — color palette (matches the web client's dark theme)
    types/index.ts            — hand-copied subset of client/src/types/index.ts
```
