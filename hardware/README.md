# RFID Optimus Encoder — hardware + firmware

A custom ESP32-based NFC encoder board with WiFi + Ethernet, designed to
speak the same `/agent` protocol the desktop USB agent
(`server/src/agent/agent.ts`) already speaks — so it shows up in the
dashboard as an ordinary `Encoder`, and a tap on it drives attendance
check-in/out through the exact same flow a desktop PC/SC reader does
(`client/src/pages/AttendancePage.tsx`'s `card:detected` handler). No
server or client changes were needed for this — the protocol already
existed and didn't assume a desktop process was on the other end of it.

```
hardware/
  README.md                      — this file
  schematic/
    schematic-overview.svg       — board schematic (block/net level)
    pinout.md                    — exact ESP32 GPIO ↔ signal mapping
    BOM.md                       — bill of materials, real part numbers
  firmware/
    platformio.ini
    src/
      main.cpp                   — wires everything together
      Config.h / Secrets.h.example
      NetworkManager.h/.cpp      — WiFi + Ethernet (ETH.h, W5500)
      NfcReader.h/.cpp           — PN532: UID poll, MIFARE Classic, NTAG21x
      AgentClient.h/.cpp         — hand-built Socket.IO v4 client for /agent
      StatusIndicator.h/.cpp     — WS2812 LED + buzzer feedback
      RelayControl.h/.cpp        — door-strike/lock output
      Hex.h                      — hex encode/decode (matches the server's convention)
```

## Read this before trusting any of it blindly

Two honesty notes, consistent with how the rest of this project's hardware
integrations (the mobile app's NFC dev-client build) were handled — say
what was actually verified, not what "should" work:

**The schematic is a reference diagram, not a KiCad/Eagle export.** This
environment has no EDA tooling installed, and I wasn't going to fabricate a
`.kicad_sch` file I have no way to open or validate. `schematic-overview.svg`
is a hand-authored block/net-level diagram — accurate to the design
decisions and net connections described in `pinout.md`/`BOM.md`, but you
(or whoever lays this out) will redraw it in real EDA software using this
as the reference, not import it directly.

**The firmware was not compiled.** I installed PlatformIO in this
environment and tried to fetch the `espressif32` platform to actually
compile-check this code — `pio pkg install` hung/timed out reaching
PlatformIO's package registry, blocked by this environment's network
policy (the same class of restriction that blocked the mobile app's
Android/EAS builds earlier in this project). So: every library API call
here (`Adafruit_PN532`, `WebSocketsClient`, `ArduinoJson` v7, `ETH.h`) is
written from confident, specific knowledge of those libraries' stable
public APIs, and I did a careful manual read-through of every file
afterward looking for exactly the kind of bug a compiler would catch (and
found and fixed a real one — see below) — but "I read it carefully" is not
"it compiled," let alone "it ran." Treat this as implemented-not-verified.
The one specific spot flagged in-code as most likely to need adjustment
for your exact toolchain version is `NetworkManager.cpp`'s
`startEthernetHardware()` — arduino-esp32's SPI-Ethernet `ETH.begin()`
overload has changed shape across core releases.

One real bug *was* caught by manual review and fixed before this was
committed: the main loop's connectivity-status LED update was originally
unconditional, which meant it clobbered every tap-result flash (green/red)
before it was ever visible on screen. Fixed by only updating that LED state
on an actual connectivity change, not every `loop()` iteration — see
`main.cpp`/`StatusIndicator`'s `baseStatus` vs. `current` split. Flagging
this not to bury it, but because "manually reviewed, not compiled" code
having a real bug caught this way is exactly the kind of thing worth being
transparent about rather than implying the review was a substitute for
actually building it.

## Architecture decisions, and why

**ESP32-WROOM-32E**, not S3/C3 — widest documentation/example coverage,
plenty of GPIO for this pin count, WiFi+BT built in. See `pinout.md` for
the full GPIO map and which strapping pins were deliberately avoided.

**W5500 Ethernet via the ESP32 core's own `ETH.h`, not the classic
`arduino-libraries/Ethernet` shield library.** This mattered more than it
might look: the classic Ethernet library runs its own independent TCP/IP
stack on the W5500's hardware socket engine, completely separate from the
ESP32's own lwIP/WiFi stack — meaning `AgentClient`'s `WebSocketsClient`
(built on `WiFiClient`) simply wouldn't work over it without a second,
parallel implementation. `ETH.h`'s SPI-PHY support shares the same
underlying stack WiFi.h uses, so the exact same `WebSocketsClient` code
works over either interface with no branching in `AgentClient` at all —
`NetworkManager` only decides *which* interface is up, not how to talk
over it.

### Why a pluggable PN532 module, not an on-board antenna

The rest of this board (ESP32, W5500, power tree, relay/LED/buzzer,
programming circuit) is straightforward digital design, well within safe
hand-design territory. The PN532's RF antenna-matching network is not:
NXP's own reference design (AN133910) requires matching component values
tuned against the specific antenna geometry with a network analyzer — get
it wrong and you get anything from "short read range" to "damaged PN532 TX
output stage." I don't have lab equipment to tune that here, and asserting
specific capacitor/resistor values from memory for a step where getting it
wrong has real consequences (and no way for me to verify it) isn't a risk
worth taking silently. J3 (an 8-pin header) instead sockets a pre-tuned,
already-certified PN532 breakout module — a legitimate, common choice in
real hardware design specifically to avoid in-house RF/EMC engineering,
not a corner cut. If a fully-integrated on-board antenna is wanted later,
that's a distinct, focused piece of RF design work for someone with the
equipment to tune and verify it.

### DESFire is not implemented on this firmware

`NfcReader`/`main.cpp`'s command dispatch covers MIFARE Classic
(READ_BLOCK/WRITE_BLOCK, key-authenticated) and NTAG21x/Ultralight
(READ_NTAG/WRITE_NTAG) — the two families the PN532 supports natively
through simple, well-documented Adafruit_PN532 library calls. MIFARE
DESFire (GET_DESFIRE_VERSION, LIST_APPLICATIONS, CREATE_FILE, and the rest
of the application/file-partitioning command set — see
`server/src/agent/agent.ts`'s full list) needs AES authentication, session
key derivation, and CMAC — real embedded crypto engineering, not something
to bolt on as an afterthought. Every DESFire command reaching this
firmware returns `{success: false, error: "Unsupported command: <name>"}`,
the same graceful-unsupported shape the desktop agent's own `default:`
case already returns for anything it doesn't recognize — so a DESFire
command sent to one of these boards fails the same visible, non-crashing
way it already would against any other agent that doesn't support it.
Adding DESFire support here is a legitimate, scoped follow-up, not a gap
this pretends doesn't exist.

### What a tap actually triggers (and what it doesn't)

This board decides nothing about whether a tapped card is "known" or
"allowed" — it only reports a UID. `AttendancePage.tsx`'s existing
`card:detected` handler does the lookup and decides. That means:

- **The relay pulses on every reported tap**, not on an access-granted
  response — there's no such response in the `/agent` protocol today (the
  server never tells the agent whether the card it just reported turned
  out to be recognized). If you want the door strike gated on the actual
  attendance decision rather than "something was tapped," that needs a new
  server→agent command/event added to the protocol — a real, scoped
  extension, not something this firmware fakes by guessing.
- **The status LED's TAP_OK/TAP_ERROR distinguish "reported successfully"
  vs. "couldn't report it or a command failed,"** never "recognized" vs.
  "unrecognized" — see `StatusIndicator.h`'s comment for why that
  distinction doesn't exist at this layer.

### Other known gaps (documented, not silently missing)

- **WiFi/agent-key are compile-time only** (`Secrets.h`, gitignored, copy
  from `Secrets.h.example`) — no runtime provisioning flow (captive
  portal, NVS-backed config) exists yet. `BOOT_BTN`'s long-press today just
  triggers a clean restart, not reconfiguration — `pinout.md` used to claim
  otherwise before this was caught and corrected.
- **Tamper switch (SW2) is read and logged to serial**, but not yet wired
  into a dashboard-visible event — see `main.cpp`'s comment at the bottom
  of `loop()`.
- **TLS**: `AgentClient` connects over a plain (`ws://`) WebSocket, matching
  the desktop agent's own default `AGENT_SERVER_URL=http://localhost:4000`
  usage. If your server is only reachable over `https://`/`wss://`,
  terminate TLS at a reverse proxy on the same LAN as this board rather
  than pointing it at a public HTTPS host directly — `WebSocketsClient`'s
  TLS support requires certificate handling this firmware doesn't attempt.

## Bring-up checklist (for whoever has the actual hardware)

1. Verify 3V3/5V rails with a multimeter before seating any modules.
2. Set the PN532 breakout's own mode switches to **SPI** (see the specific
   module's silkscreen/datasheet — this board doesn't control that
   selection, see `pinout.md`).
3. `cp firmware/src/Secrets.h.example firmware/src/Secrets.h` and fill in
   real WiFi/server/agent-key values.
4. Register the encoder in the dashboard (Encoders → Add Encoder) to get a
   real `agentKey` first — the firmware won't connect without one that
   matches an active `Encoder` row (see the `agentNsp.use()` auth check in
   `server/src/websocket/index.ts`).
5. `pio run -t upload` (see `firmware/platformio.ini`) — and expect to hit
   (and fix) whatever this environment's lack of a real compile pass
   missed.
6. Watch the serial monitor (`pio device monitor`, 115200 baud) — `main.cpp`
   logs every stage: NFC init, network interface chosen, agent connection,
   every tap and command.
