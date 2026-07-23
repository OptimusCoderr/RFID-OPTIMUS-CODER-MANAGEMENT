# Hardware/firmware — real-environment setup and testing

This is the "actually build and test it" companion to `README.md`. Nothing
here was runnable in the sandboxed environment this firmware was written in
(no Android/iOS-style toolchain download either — see `README.md`'s
"Read this before trusting any of it blindly" section for exactly what
that environment couldn't do). Everything below is written for a real
Windows or Linux machine with normal internet access, where none of those
restrictions apply.

## What you'll need

- A Windows 10/11 or Linux (Ubuntu/Debian commands shown; Fedora/Arch
  equivalents noted) machine with internet access and a spare USB port.
- The board itself, OR — for first bring-up before committing to a
  fabricated PCB — an ESP32-WROOM-32 devkit + a PN532 breakout module (SPI
  mode) + (optionally) a W5500 Ethernet breakout, wired point-to-point per
  `schematic/pinout.md`. Prototyping on a breadboard first is genuinely
  the right call here, not just a hedge — it lets you catch firmware bugs
  before they're indistinguishable from board-fabrication bugs.
- A USB cable that actually carries data (not power-only — a real trap
  with generic phone cables).
- A MIFARE Classic and/or NTAG/Ultralight card or two to tap for testing.
  A MIFARE DESFire card is useful for confirming the "unsupported, not
  crashed" behavior (see `README.md`).
- If testing the battery subsystem: an 18650 Li-ion cell and a
  multimeter. See `schematic/BOM.md`/`schematic/pinout.md`'s "Battery
  power system" for the full circuit, and `PRODUCTION.md` before
  shipping any unit with a battery installed — Li-ion cells have real
  handling/shipping requirements that aren't optional.
- The RFID Optimus server running and reachable from the board's network
  (see the repo root `README.md`'s "Getting started" section) — you'll
  need this before step 4 below (registering the encoder to get an
  `agentKey`).

## Part 1 — Installing the toolchain

You need Python (PlatformIO Core is a Python package) and PlatformIO
itself. Two ways to get PlatformIO: the **VS Code extension** (easiest —
it manages its own Python/PlatformIO Core install for you) or the
**PlatformIO Core CLI** standalone (faster for scripting/CI, and what the
commands below assume unless noted). Either way ends up with the same
`pio` command available.

### Windows

1. Install Python 3.10+ from [python.org](https://www.python.org/downloads/windows/).
   **Check "Add python.exe to PATH"** on the first installer screen — easy
   to miss, and everything below silently fails without it.
2. Pick one:
   - **VS Code path (recommended if you're not already a PlatformIO CLI
     user):** install [VS Code](https://code.visualstudio.com/), open the
     Extensions panel (`Ctrl+Shift+X`), search "PlatformIO IDE", install
     it, restart VS Code when prompted. It downloads its own PlatformIO
     Core on first launch (takes a few minutes) — no manual pip install
     needed.
   - **CLI path:** open PowerShell and run:
     ```powershell
     pip install -U platformio
     ```
     Verify: `pio --version` should print something like `PlatformIO Core, version 6.x.x`.
3. Install the **CP210x USB-to-UART driver** (Silicon Labs) — this board's
   programming/console chip is a CP2102N, and Windows won't show a COM
   port for it without this driver. Download the "CP210x Universal Windows
   Driver" from
   [Silicon Labs' site](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers),
   run the installer, reboot if prompted.
4. Plug the board in via USB. Open Device Manager → Ports (COM & LPT) —
   you should see something like `Silicon Labs CP210x USB to UART Bridge
   (COM5)`. Note the COM number; you'll need it if auto-detection fails
   later.

### Linux (Ubuntu/Debian; see notes for other distros)

1. Install Python and pip if not already present:
   ```bash
   sudo apt update
   sudo apt install python3 python3-pip python3-venv
   ```
   (Fedora: `sudo dnf install python3 python3-pip`. Arch: `sudo pacman -S python python-pip`.)
2. Pick one:
   - **VS Code path:** install VS Code (`sudo snap install code --classic`,
     or download the `.deb` from code.visualstudio.com), then install the
     "PlatformIO IDE" extension the same way as Windows above.
   - **CLI path (recommended: use `pipx` so PlatformIO doesn't fight your
     system Python packages):**
     ```bash
     sudo apt install pipx
     pipx ensurepath
     pipx install platformio
     # open a new terminal so PATH picks up pipx's bin dir, then:
     pio --version
     ```
     Plain `pip install --user platformio` works too if you'd rather skip pipx.
3. **udev rules + serial permissions** — without this, `/dev/ttyUSB0`
   exists but your user can't open it, and uploads fail with a permission
   error that doesn't obviously say "udev":
   ```bash
   curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core/master/platformio/assets/system/99-platformio-udev.rules \
     | sudo tee /etc/udev/rules.d/99-platformio-udev.rules
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   sudo usermod -aG dialout "$USER"
   ```
   **Log out and back in** (group membership changes don't apply to
   already-open sessions) — a full reboot is the reliable option if a
   plain re-login doesn't seem to take.
4. The CP210x driver is built into the Linux kernel (`cp210x` module) —
   nothing to install. Plug the board in and check:
   ```bash
   ls /dev/ttyUSB*
   # or, more specifically:
   ls -l /dev/serial/by-id/
   dmesg | tail -20   # should show "cp210x converter now attached to ttyUSBx"
   ```
   If nothing shows up, try `sudo modprobe cp210x` and re-plug the board.

## Part 2 — Getting the firmware project set up

```bash
git clone <this repo's URL>
cd RFID-OPTIMUS-CODER-MANAGEMENT/hardware/firmware
cp src/Secrets.h.example src/Secrets.h
```

Edit `src/Secrets.h` with real values:

- `WIFI_SSID` / `WIFI_PASSWORD` — only used if Ethernet has no link (see
  `NetworkManager`'s Ethernet-preferred fallback logic).
- `AGENT_SERVER_HOST` / `AGENT_SERVER_PORT` — your server's LAN address,
  e.g. `192.168.1.50` / `4000`. Not `localhost` — that resolves to the
  board itself, not your dev machine.
- `AGENT_KEY` — **you don't have this yet.** Register the encoder in the
  dashboard first: sign in → Encoders → Add Encoder → pick type "Custom"/
  whatever fits — the `agentKey` is shown exactly once at creation time.
  Copy it into `Secrets.h` before moving on; there's no way to recover it
  from the dashboard afterward (the same one-time-reveal pattern the
  desktop agent's `agentKey` already uses).

`Secrets.h` is gitignored — this step doesn't touch anything tracked by
git.

## Part 3 — Compiling

This is the first time this code has actually been compiled, full stop —
worth internalizing before you run it. The authoring environment couldn't
reach PlatformIO's package registry at all (see `README.md`), so every
library API call in this firmware was written from confident recollection
and checked by careful manual re-reading, not by a compiler. Expect to
possibly need to fix something on the first `pio run` — that's normal
here, not a sign anything else in the project is untrustworthy.

**CLI:**
```bash
pio run
```
This downloads the ESP32 platform + all `lib_deps` from `platformio.ini`
(several hundred MB the first time — this is the exact step that hung
indefinitely in the authoring environment; on a normal connection it
should take a few minutes) and compiles without uploading anything.

**VS Code:** click the checkmark icon in the PlatformIO toolbar at the
bottom of the window (or `Ctrl+Alt+B`).

### If it doesn't compile

Read the actual error — don't assume it's the flagged risk point below
before checking. That said, the single most likely spot, already called
out in-code: `NetworkManager.cpp`'s `startEthernetHardware()` calls
`ETH.begin()` with a specific parameter list for arduino-esp32 core
~2.0.14's SPI-Ethernet overload. If the installed core resolved to a
different version (check `platformio.ini`'s `platform_packages` pin —
`framework-arduinoespressif32 @ ~3.20014.0`, or just check what actually
got installed under `~/.platformio/packages/framework-arduinoespressif32/`
on Linux or `%USERPROFILE%\.platformio\packages\...` on Windows), open
that package's `cores/esp32/ETH.h` and check the SPI `begin()` overload's
actual parameter order against what `NetworkManager.cpp` passes.

## Part 4 — Flashing

Connect the board, then:

```bash
pio run -t upload
```

PlatformIO usually auto-detects the port. If it picks the wrong one (or
you have multiple serial devices plugged in), specify it explicitly:

```bash
# Windows
pio run -t upload --upload-port COM5

# Linux
pio run -t upload --upload-port /dev/ttyUSB0
```

**If upload fails to enter the bootloader** (rare with this board's
auto-reset circuit — Q2 + R3/R4 driven from the CP2102N's DTR/RTS lines,
same pattern as a standard ESP32 devkit — but worth knowing): hold
`BOOT_SW`, tap `SW1` (reset) while still holding `BOOT_SW`, release
`BOOT_SW` once the upload starts.

**Permission denied on Linux:** you skipped the udev/dialout step above,
or haven't logged out and back in since running it.

## Part 5 — Serial monitor

```bash
pio device monitor -b 115200
# or, chained with the previous step:
pio run -t upload -t monitor
```

`main.cpp` logs every stage of startup and every subsequent event —
you should see something like:

```
[boot] RFID Optimus Encoder
[nfc] PN532 found, firmware v1.6
[net] ETH.begin() failed — W5500 not responding...      (fine if you're on WiFi-only for now)
[boot] network up via wifi, starting agent connection
[agent] websocket transport up, waiting for Engine.IO handshake
[agent] connected to /agent namespace
```

If you see `[agent] namespace connect rejected`, the `AGENT_KEY` in
`Secrets.h` doesn't match an active `Encoder` row — re-check it against
the dashboard, or that the encoder wasn't deactivated.

## Part 6 — Full bring-up / test checklist

No automated test suite exists for this firmware yet (see "Automated
testing status" below for why, and what a real one would need). This is
the manual equivalent — work through it in order; later tests assume
earlier ones passed. Have the dashboard open in a browser alongside the
serial monitor for the whole thing.

| # | Test | Steps | Expected result |
|---|------|-------|------------------|
| T1 | Power rails | Multimeter across test points / IC pins before seating any modules | 5V rail ≈5V, 3.3V rail ≈3.3V, both stable (no drift when the ESP32 briefly spikes current during WiFi TX) |
| T2 | Boot log | Power on, watch serial monitor | Boot banner appears within ~1s; no crash/reboot loop |
| T3 | PN532 init | Same boot, with the module plugged into J3 | `[nfc] PN532 found, firmware vX.X` logged. If instead `[nfc] PN532 not responding`, check the module's mode switches are set to SPI (see `pinout.md`) and J3's wiring |
| T4 | WiFi connect | No Ethernet cable plugged in | Within `WIFI_RETRY_MS`-ish, `[boot] network up via wifi` logs; `WiFi.localIP()` reachable (add a temporary `Serial.println(WiFi.localIP())` if you want to see it — not logged by default) |
| T5 | Ethernet connect + priority | Plug an Ethernet cable in (with WiFi also configured) | `[boot] network up via ethernet` — Ethernet wins even if WiFi would also work; unplug it and confirm the board falls back to WiFi within a few seconds |
| T6 | Agent registers | (Already done in Part 2) | Dashboard's Encoders page shows the encoder |
| T7 | Agent connects | After T4 or T5 | Serial: `[agent] connected to /agent namespace`. Dashboard: the encoder's status badge flips to **ONLINE** |
| T8 | Heartbeat keeps it alive | Leave it idle for a few minutes | Encoder stays ONLINE in the dashboard (backed by `lastSeenAt` updating every `APP_HEARTBEAT_MS` — see `agentNsp` in `server/src/websocket/index.ts`) |
| T9 | Tap a registered card | Open Attendance page, select this encoder's schedule/zone, tap a card whose UID is registered to a holder | Serial logs `[nfc] tap: <UID>`; dashboard's live feed shows a check-in/out; `GET /api/attendance` includes the new record |
| T10 | Tap an unrecognized card | Tap a card with no matching `Card.uid` in the system | Dashboard shows "Unrecognized card ... register it first" (from `AttendancePage.tsx`'s `onCardDetected`) — not a crash, not silently ignored |
| T11 | Debounce: resting card | Tap a card and **leave it sitting on the reader** for 10+ seconds | Exactly **one** `card:detected`/attendance record, not one every ~1.5s. This directly exercises the debounce bug that was found and fixed in review — if you see repeated records, something regressed |
| T12 | Debounce: quick re-tap | Tap a card, lift it, tap the **same** card again within ~1 second | Second tap is suppressed (no second record) — this is the bounce guard, distinct from T11 |
| T13 | Re-tap after debounce window | Tap a card, lift it, wait 2+ seconds, tap the same card again | Second tap **does** register — confirms the debounce is a bounce guard, not a lockout |
| T14 | MIFARE Classic read/write | From Live Encode's raw command console (or a registered card's template flow), send `READ_BLOCK`/`WRITE_BLOCK` targeting this encoder | Round-trips correctly; writing a protected block (manufacturer block / sector trailer) is rejected server-side before it ever reaches the agent (see `isProtectedMifareBlock` in `server/src/websocket/index.ts`) |
| T15 | NTAG/Ultralight read/write | Same, with `READ_NTAG`/`WRITE_NTAG` against an NTAG21x card | Round-trips correctly |
| T16 | DESFire command | Send any DESFire command (e.g. `GET_DESFIRE_VERSION`) to this encoder | Command result comes back `{success:false, error:"Unsupported command: GET_DESFIRE_VERSION"}` — no crash, no hang |
| T17 | Relay pulse | Tap any registered card | K1 audibly clicks; measure ~3s (`Timing::RELAY_PULSE_MS`) before it releases. Remember: this fires on every *reported* tap, not on an access-granted decision — see `README.md` |
| T18 | LED/buzzer states | Power on → WiFi/Ethernet connecting → connected → tap a card → tap again while disconnected (unplug network mid-test) | Dim white (boot) → pulsing blue (connecting) → solid blue (idle) → green flash + short beep (tap reported) → red flash + longer beep (tap while disconnected, or a failed command) |
| T19 | Tamper switch | Open/close the enclosure's tamper microswitch (or short/open the pin directly on a breadboard prototype) | Serial logs `[tamper] enclosure opened` / `closed` on each transition, not spammed continuously |
| T20 | BOOT_BTN restart | Hold `BOOT_SW` for 5+ seconds during normal operation (not during power-on) | Serial logs `[boot] BOOT_BTN held — restarting`, board reboots cleanly |
| T21 | Disconnect/reconnect | Stop the server process (or block the port) while the board is connected | Dashboard flips the encoder to **OFFLINE** (and, per `notifyCompanyAdmins`, a notification fires for company admins). Restart the server — board reconnects and dashboard flips back to ONLINE without a manual restart |
| T22 | Ethernet unplug mid-session | With Ethernet active and the agent connected, unplug the cable | `NetworkManager` falls back to WiFi within `ETH_LINK_CHECK_MS`-ish; the agent connection recovers (WebSocketsClient's own reconnect logic, since the underlying interface changed under it) |
| T23 | No NFC module attached | Boot with J3 unpopulated | Firmware doesn't crash — logs `[nfc] PN532 not responding` and `[boot] continuing without a working NFC reader`, network/agent still come up normally |
| T24 | Fuel gauge detected | Boot with BATT1 + U6 populated | Serial logs `[batt] MAX17048 found — NN%, X.XXV` |
| T25 | No battery populated | Boot on a board built without the battery subsystem (or with BATT1 removed) | Serial logs `[batt] MAX17048 not responding...` — firmware continues normally, no crash, `Status::LOW_BATTERY` never triggers (see `BatteryMonitor::isPresent()`) |
| T26 | Charges when input present | Plug in USB-C/DC power with BATT1 installed and at partial charge | Cell voltage rises over time (check via `[batt]` logs, or a multimeter on BATT1 directly) — confirms U8 (MCP73871) is actually charging, not just powering the load |
| T27 | Runs on battery alone | With BATT1 charged, unplug both USB-C and DC input | Board keeps running with no reboot/brownout — confirms U8's power-path switch-over and U9's boost to 5V are both working. Agent connection may briefly drop and recover if the momentary switch-over causes a network hiccup; a full reboot would indicate a real problem (see `README.md`'s "not built or run against real hardware" note — this specific transition is the least-tested part of the whole design) |
| T28 | Low-battery LED | Let BATT1 discharge (or, faster: temporarily lower `Battery::LOW_PERCENT` in `Config.h` to a value above your cell's actual charge, reflash, then revert) | LED goes solid amber (`Status::LOW_BATTERY`) once below threshold; reverts to blue/idle once charged back above it |
| T29 | Reverse-polarity protection (J2) | **Verify with a multimeter first — don't wire it backwards on a hunch.** With a current-limited bench supply if you have one, deliberately reverse J2's polarity at a safe low current | Board draws no current and shows no damage — Q5 blocks it. If you don't have a current-limited supply, skip the deliberate-reversal test and just trust the topology (a P-MOSFET reverse-polarity circuit is a standard, well-understood pattern) rather than risk the board to prove it |

## Automated testing status

**Mobile app:** yes — see `../mobile/TESTING.md`, `npm test` runs real
Jest unit tests today.

**This firmware:** none yet, and it's worth explaining why rather than
just leaving it absent. `Hex.h`'s encode/decode functions are the obvious
first candidate (pure logic, no hardware I/O) — but they're typed around
Arduino's `String` class, which isn't available when compiling for
PlatformIO's `native` platform (a plain host build with no Arduino core).
Getting a real `pio test -e native` working needs one of:

- A `String`-compatible shim/mock for native builds (the
  [`ArduinoFake`](https://github.com/FabioBatSilva/ArduinoFake) library is
  the standard tool for this), or
- Refactoring `Hex.h` (and its call sites in `NfcReader`/`AgentClient`/
  `main.cpp`) from Arduino `String` to `std::string`, which ESP32's
  Arduino core supports natively.

I didn't do either in this pass: the shim route pulls in a new dependency
I can't fetch or verify here at all (same blocked-registry problem as
everything else), and the `std::string` refactor cascades through several
already-reviewed-and-fixed files for the sake of one test — real, but not
worth the added risk in a change I can't compile-check. Either is a
legitimate, scoped follow-up for whoever has working PlatformIO registry
access to actually verify it compiles.
