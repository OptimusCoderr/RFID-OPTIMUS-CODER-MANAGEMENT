# Mobile app — real-environment setup and testing

The "actually build and run it" companion to `README.md`. This session's
sandboxed environment could install dependencies and run Jest/TypeScript
fine, but every Android/EAS *build* attempt hit a wall it couldn't get
past — see `README.md`'s "Setup: build a dev client" section for exactly
what that means and why. Everything below assumes a normal Windows or
Linux machine with unrestricted internet access, where that wall doesn't
exist.

(This app doesn't support iOS/Xcode builds from Windows or Linux at all —
Xcode requires macOS. `README.md` covers that path in general terms;
this document is scoped to the two platforms you can actually build on
from Windows/Linux: Android, and web via `expo start --web` for the
screens that don't need native modules.)

## What you'll need

- A Windows 10/11 or Linux (Ubuntu/Debian commands shown) machine with
  internet access.
- A **physical Android phone with NFC hardware** for testing the Tap In
  screen — this is not optional if you want to test that feature. Most
  Android emulators **do not emulate NFC**, so an AVD alone can verify
  every other screen but not a real tap. Everything else (Dashboard,
  Cards, Holders, Attendance, Notifications, Profile) works fine on an
  emulator if you don't have a spare NFC-capable phone.
- The RFID Optimus server running and reachable from the phone's network
  (see the repo root `README.md`) — same "not `localhost`, use a real LAN
  IP" requirement as the hardware firmware.
- At least one card registered in the system with a UID you can actually
  tap (for Tap In testing) — an NFC-capable card, obviously, matching
  whatever your phone's NFC radio supports (MIFARE Classic/Ultralight/
  NTAG are the common ones and read fine as plain NFC tags for UID
  purposes, which is all Tap In needs — see `README.md`'s Tap In section).

## Part 1 — Installing the toolchain

### Windows

1. **Node.js** — install the current LTS from
   [nodejs.org](https://nodejs.org/), or via `nvm-windows` if you want to
   manage multiple versions. Verify: `node -v` (should be 18.x or newer).
2. **Git** — from [git-scm.com](https://git-scm.com/download/win) if not
   already installed.
3. **Java JDK 17** — Android Gradle builds for this Expo SDK/React Native
   version specifically need JDK 17 (not 11, not 21 — a version mismatch
   here is one of the most common Android build failures). Install
   [Eclipse Temurin 17](https://adoptium.net/temurin/releases/?version=17)
   (the "JDK" installer, not JRE). Verify: `java -version` should print
   `17.x.x`.
4. **Android Studio** — download from
   [developer.android.com/studio](https://developer.android.com/studio),
   run the installer, accept the default "Standard" setup type (this
   installs the SDK, platform-tools, and an emulator image for you).
5. Open Android Studio once, let it finish its own first-run SDK setup,
   then open **Settings → Languages & Frameworks → Android SDK** and
   confirm these are installed (SDK Manager tab):
   - Android SDK Platform matching a recent API level (34 is a safe
     choice)
   - Android SDK Build-Tools
   - Android SDK Platform-Tools
   - Android SDK Command-line Tools (latest)
6. **Environment variables** — System Properties → Environment Variables:
   - New system variable `ANDROID_HOME` = `C:\Users\<you>\AppData\Local\Android\Sdk`
     (the SDK Manager screen in step 5 shows the exact path at the top)
   - Add to `Path`: `%ANDROID_HOME%\platform-tools` and
     `%ANDROID_HOME%\cmdline-tools\latest\bin`
   - Open a **new** terminal (env var changes don't apply to already-open
     ones) and verify: `adb version`
7. **USB driver for your phone** — most phones need one for Windows to
   see them over USB. Try plugging it in first; if Windows doesn't
   recognize it, install the **Google USB Driver** via Android Studio's
   SDK Manager ("SDK Tools" tab) for Pixel/Nexus devices, or your phone
   manufacturer's driver (Samsung, etc.) otherwise.
8. On the phone: **Settings → About phone → tap "Build number" 7 times**
   to unlock Developer Options, then **Settings → Developer options →
   enable USB debugging**. Plug it in, accept the "Allow USB debugging?"
   prompt on the phone screen.
9. Verify: `adb devices` should list your phone (not `unauthorized` — if
   it says that, check the phone screen for the debugging prompt again).

### Linux (Ubuntu/Debian; see notes for other distros)

1. **Node.js** — via `nvm` (recommended over the distro package, which is
   often outdated):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   # open a new terminal, then:
   nvm install --lts
   node -v
   ```
2. **Git** — `sudo apt install git` if not already present.
3. **Java JDK 17**:
   ```bash
   sudo apt install openjdk-17-jdk
   java -version   # should print 17.x.x
   ```
   (Fedora: `sudo dnf install java-17-openjdk-devel`. Arch:
   `sudo pacman -S jdk17-openjdk`.)
4. **Android SDK** — two options:
   - **Full Android Studio** (easiest, includes an emulator): download the
     `.tar.gz` from
     [developer.android.com/studio](https://developer.android.com/studio),
     extract it somewhere (e.g. `~/android-studio`), run
     `~/android-studio/bin/studio.sh`, complete the first-run setup
     (Standard install).
   - **Command-line tools only** (lighter, no emulator/no GUI — fine if
     you're testing on a physical phone only): download "Command line
     tools only" from the same page, extract to
     `~/Android/cmdline-tools/latest/` (the nesting matters — `sdkmanager`
     expects exactly that path shape), then:
     ```bash
     cd ~/Android/cmdline-tools/latest/bin
     ./sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
     ```
5. **Environment variables** — add to `~/.bashrc` (or `~/.zshrc`):
   ```bash
   export ANDROID_HOME="$HOME/Android/Sdk"       # Android Studio installs here by default;
                                                   # ~/Android/Sdk if you used cmdline-tools-only above
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
   ```
   Open a new terminal (or `source ~/.bashrc`), verify: `adb version`.
6. **udev rules** so `adb` can see your phone without running as root —
   Android's own docs maintain a
   [community udev rules file](https://github.com/M0Rf30/android-udev-rules)
   covering essentially every OEM:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/M0Rf30/android-udev-rules/main/51-android.rules \
     | sudo tee /etc/udev/rules.d/51-android.rules
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   sudo usermod -aG plugdev "$USER"
   ```
   **Log out and back in** for the group change to apply.
7. On the phone: enable Developer Options + USB debugging (same steps as
   Windows above). Plug it in, accept the debugging prompt.
8. Verify: `adb devices` lists your phone.

## Part 2 — Project setup

```bash
git clone <this repo's URL>
cd RFID-OPTIMUS-CODER-MANAGEMENT/mobile
npm install
```

Point it at your backend — either edit `app.json`'s `expo.extra.apiUrl` to
your server's LAN IP before building (e.g. `"http://192.168.1.50:4000"`),
or leave the default and set it later from the app's **Profile → API
server** field (see `README.md`'s "Pointing it at your backend" section
for the Android-emulator-vs-physical-device address differences).

Real Android devices block plain `http://` network traffic by default
(API 28+) — this app's `app.json` already sets
`android.usesCleartextTraffic: true` to allow it, since the backend here
is typically a plain-HTTP server on your LAN, not `https://`. If you've
forked this and pointed it at an `https://` backend instead, that setting
is harmless either way.

## Part 3 — Building the dev client

This is the step the authoring sandbox could not do at all — no Android
SDK, and network policy blocked downloading one. On your own machine,
neither restriction applies:

```bash
npx expo prebuild          # generates android/ (gitignored, regenerated from app.json + config plugins)
npx expo run:android       # builds a debug dev-client APK and installs it on
                            # whichever device `adb devices` shows (or an emulator)
```

First run downloads a fair amount (Gradle itself, Android build
dependencies) and can take several minutes — subsequent builds are much
faster (incremental Gradle cache). If it fails, read the actual Gradle
error; the most common causes are the JDK version (must be 17 — see Part
1) or a stale `android/` directory from a previous `expo prebuild` run
(delete it and re-run `expo prebuild` if you've changed `app.json` since
the last prebuild and things look inconsistent).

**No local Android Studio, or want a cloud build instead:**
```bash
npx expo install eas-cli    # or: npm install -g eas-cli
eas login                   # needs a (free) Expo account
eas build --platform android --profile development
```
This builds in Expo's cloud and gives you a downloadable APK — no local
Android SDK needed at all. (This is also the path that was blocked by
network policy in the authoring sandbox specifically — `eas whoami`
timed out reaching `expo.dev`. On a normal connection this should just work.)

## Part 4 — Day-to-day iteration

Once the dev-client app is installed once (Part 3), you don't need to
rebuild it for every JS/TS change:

```bash
npm start
```

Open the installed dev-client app on the phone (not Expo Go — a
plain-Expo-Go icon won't have this app's NFC module) — it shows its own
connection screen where you scan the QR code Metro prints, or type the
URL manually if the phone and dev machine aren't discovering each other
automatically (same WiFi network required either way).

## Part 5 — Running the automated tests

```bash
npm run typecheck   # tsc --noEmit
npm test            # Jest — see src/lib/nfcUid.test.ts
```

`npm test` runs today, right now, in any environment with Node.js — no
Android SDK, no device, no emulator needed. It's scoped narrowly on
purpose: `src/lib/nfcUid.ts` (the UID hex-normalization logic used by the
Tap In screen) has zero React Native/Expo imports, so it's tested with
plain `ts-jest`, not the heavier `jest-expo` preset a component-rendering
test would need. This was verified to actually pass (6/6) during
development — unlike the build steps above, this part of the "real
environment" is also this repo's normal Node.js environment, so there was
no reason to leave it undemonstrated.

Expanding coverage to actual screens (React Testing Library + jest-expo,
or an E2E tool like Maestro/Detox for the full Tap In → attendance-record
flow) is a reasonable next step, not something this pass attempted.

## Part 6 — Manual QA checklist

No automated E2E coverage exists yet (see above), so this is how to
actually verify the app end-to-end. Do this against a real backend with
at least one company/user/card set up (see the root `README.md`).

**Auth**
- [ ] Sign in with valid credentials → lands on Dashboard
- [ ] Sign in with a wrong password → inline error, doesn't crash
- [ ] Close and reopen the app after signing in → still signed in (token
      persisted in SecureStore, not re-prompted)
- [ ] Profile → Sign out → back to Login screen

**Dashboard**
- [ ] Stat tiles populate with real numbers matching the web dashboard
- [ ] Pull-to-refresh updates them
- [ ] Recent activity feed shows real operations

**Cards**
- [ ] Search by UID/label/holder name filters the list
- [ ] Tapping a card opens its (read-only) detail view with correct fields

**Holders**
- [ ] Search filters correctly
- [ ] Card counts match what's shown on the web dashboard

**Tap In** (needs a physical NFC-capable phone with the dev-client build
— see "What you'll need")
- [ ] Screen shows the scan UI, not "NFC isn't available" (confirms
      you're on a real dev-client build, not Expo Go)
- [ ] Zone picker chips populate from the company's real zones
- [ ] Tap a **registered** card → UID reads, a check-in/out appears in
      the on-screen history, **and** the same record shows up on the web
      dashboard's Attendance page in real time
- [ ] Tap an **unregistered** card's UID → "No card registered with this
      UID" entry, no crash
- [ ] Start a scan, then tap the button again to cancel mid-scan → aborts
      cleanly, screen is immediately ready for another scan (not stuck
      "scanning" forever)
- [ ] Tap two different registered cards in quick succession → both
      resolve to their own correct holder/result, no mixing (this
      exercises the scan-token guard against a stale scan's result
      landing after a newer one started)
- [ ] Background the app mid-scan (press home), then reopen → no crash,
      scan state recovers sanely

**Attendance**
- [ ] Records list loads and shows correct check-in/check-out badges

**Notifications**
- [ ] List loads; unread count badge is accurate
- [ ] Mark a single notification read → badge count decrements
- [ ] Mark all read → badge clears

**Profile**
- [ ] Displayed user info (name, email, role, company) matches the
      account
- [ ] Change the API server field to a different (valid) server → app
      signs out (expected — see `README.md`'s explanation of why)
- [ ] Sign out works

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `adb: command not found` | `ANDROID_HOME`/`PATH` not set, or you opened a terminal before setting them — open a new one |
| `adb devices` shows nothing | USB debugging not enabled on the phone, cable is charge-only, or (Windows) missing USB driver / (Linux) missing udev rule |
| `adb devices` shows `unauthorized` | Check the phone screen for the "Allow USB debugging?" prompt — it may be waiting behind the lock screen |
| Gradle build fails with a Java-version-related error | Wrong JDK — must be 17. Check `java -version`, and that `JAVA_HOME` (if set) points at the JDK 17 install, not an older/newer one |
| `expo run:android` fails after changing `app.json` | Stale generated `android/` folder — delete it (`rm -rf android`) and let `expo prebuild` regenerate it |
| App installs but can't reach the API (network error on every screen) | Phone and server not on the same network; server's `CLIENT_ORIGIN`/firewall blocking inbound connections; double-check the API server address in Profile matches the server's real LAN IP, not `localhost` |
| Metro won't connect from the dev-client app | Phone and dev machine not on the same WiFi network, or a firewall blocking port 8081 on the dev machine |
| Tap In shows "NFC isn't available" | Either this is Expo Go (rebuild as a dev client — Part 3), or the device genuinely has no NFC radio |
| Tap In never detects a tap on an emulator | Expected — most Android emulators don't emulate NFC hardware at all. Use a physical device |
