# ESP32 pin map — RFID Optimus Encoder board

Target module: **ESP32-WROOM-32E** (4MB flash). Any WROOM-32/32D/32E variant
works — the plan below avoids the flash-strapped pins (GPIO6-11, internal to
the module) and respects every boot-strapping pin's constraints.

| GPIO | Direction | Signal | Notes |
|---|---|---|---|
| 1 (TX0) | out | `UART0_TX` | To CP2102N RXD. Console/programming only. |
| 3 (RX0) | in | `UART0_RX` | From CP2102N TXD. |
| 4 | out | `PN532_CS` | SPI chip-select, NFC module header pin 6. |
| 5 | out | `ETH_CS` | SPI chip-select, W5500. GPIO5 is VSPI's default CS0 and safe to drive post-boot (it's sampled at boot for timing of the boot log baud rate only, not boot mode). |
| 16 | out | `LED_DATA` | WS2812 status LED, single-wire data. |
| 17 | out | `BUZZER` | Base of Q3 (buzzer driver transistor) via R13. |
| 18 | out | `SPI_SCK` | Shared bus — PN532 header + W5500. |
| 19 | in | `SPI_MISO` | Shared bus. |
| 21 | out/in | `BATT_SDA` | I2C to U6 (MAX17048 fuel gauge) — previously an unused expansion pin; now dedicated (see "Battery power system" below). |
| 22 | out | `BATT_SCL` | I2C clock, same bus. |
| 23 | out | `SPI_MOSI` | Shared bus. |
| 25 | out | `PN532_RSTPDN` | NFC module header pin 8 — drive low ≥100ms to hard-reset the PN532; idle high. |
| 26 | out | `ETH_RST` | W5500 reset, active low. |
| 27 | in | `ETH_INT` | W5500 interrupt (link state / RX pending) — polled, not required to be a true ISR pin. |
| 32 | out | `RELAY_DRIVE` | Base of Q1 (relay driver transistor) via R11. |
| 33 | in | `PN532_IRQ` | NFC module header pin 7 — active-low "tag ready" signal from the PN532; polled in `NfcReader`, avoids blind SPI polling every loop. |
| 34 | in | `TAMPER_SW` | Input-only pin (no internal pull — SW2 has its own external pull-up R14). Enclosure tamper microswitch, normally closed. |
| 0 | in | `BOOT_BTN` | Standard ESP32 boot-mode strap. Doubles at runtime as a "hold 5s to force a clean restart" button (firmware only samples it well after boot completes, never during the boot-mode window, so it's never confused with a flash-mode request). WiFi SSID/password and the agent key are compile-time-only in this firmware (`Secrets.h`) — there's no runtime provisioning flow yet for this button to trigger; see `../README.md`'s limitations section. |
| EN | in | `RESET` | Hardware reset. R1 pull-up to 3V3, C1 100nF to GND (power-on delay), SW1 (manual reset), and Q2 (auto-reset transistor from CP2102N's DTR line, standard ESP32-devkit auto-program circuit). |

## Fixed/reserved pins (not repurposed)

| Pin(s) | Reason |
|---|---|
| GPIO6-11 | Wired internally to the module's SPI flash — never expose these. |
| GPIO2, 12, 15 | Boot-strapping pins (GPIO12 in particular sets flash voltage — pulling it high at boot can select the wrong voltage and brick a 3.3V flash chip). Left unconnected/NC on this design to avoid any risk of an external pull fighting the strap. |
| GPIO34-39 | Input-only, no internal pull resistors. GPIO34 is the only one used here (`TAMPER_SW`, with its own external pull-up); 35/36/39 are broken out to J4 for future use. |

## NFC front-end: pluggable module, not an on-board antenna

The PN532 connects through **J3, an 8-pin header**, not as a bare IC with a
hand-tuned antenna-matching network on this board. That's a deliberate
choice, not a shortcut — see `../README.md`'s "Why a pluggable PN532 module"
section for the reasoning. J3's pinout:

| J3 pin | Signal | To PN532 module's pin (standard PN532-V3-style breakout) |
|---|---|---|
| 1 | 3V3 | VCC |
| 2 | GND | GND |
| 3 | `SPI_SCK` | SCK |
| 4 | `SPI_MISO` | MISO |
| 5 | `SPI_MOSI` | MOSI |
| 6 | `PN532_CS` | SS |
| 7 | `PN532_IRQ` | IRQ |
| 8 | `PN532_RSTPDN` | RSTPDN |

The module's own onboard DIP switches (or solder jumpers, depending on the
specific board) must be set to **SPI mode** before it's plugged in — the
exact switch positions are printed on the module itself; this board doesn't
control that selection.

## Ethernet: W5500 + integrated-magnetics RJ45

`ETH_CS`/`ETH_RST`/`ETH_INT` above plus the shared `SPI_SCK`/`SPI_MISO`/
`SPI_MOSI` bus connect to a W5500 IC (see BOM). Its RJ45 jack is a
magnetics-integrated part (HanRun HR911105A or equivalent) so no separate
Ethernet transformer is needed on this board.

## Battery power system

Added so the board can run untethered (or ride through a power cut on an
access-control install where that matters). Four blocks, cell-to-load:

1. **BATT1** — a single replaceable 18650 Li-ion cell in a holder with
   spring contacts, not soldered in. Deliberately not a sealed/glued-in
   pouch cell: a product being sold to other people needs its battery to
   be field-serviceable without disassembling the enclosure or touching a
   soldering iron near a lithium cell — see `../PRODUCTION.md`.
2. **U7 (DW01A) + Q4 (FS8205A dual MOSFET)** — the actual cell-level
   protection circuit (overcharge, over-discharge, overcurrent/short).
   This lives on the board regardless of whether the 18650 you source
   already has its own protection PCB at the base — for a product shipped
   to someone else, this board never assumes the end user sourced a
   protected cell.
3. **U8 (MCP73871)** — charge management + power-path control in one IC:
   charges BATT1 from the existing 5V rail (whichever of USB-C/DC-buck is
   present) while simultaneously powering the system's `SYS_OUT` from
   whichever of {input, battery} is actually available, switching
   automatically with no glitch when one is removed. This is what makes
   "always on, charges when plugged in, keeps running when unplugged"
   work without extra firmware logic.
4. **U9 (MT3608 boost)** — `SYS_OUT` above tracks close to whichever
   source is feeding it, which on battery alone is 3.0–4.2V — too low to
   feed the existing AMS1117 3.3V LDO (needs roughly 4.3V+ in to hold a
   clean 3.3V out). U9 boosts `SYS_OUT` back up to a steady 5V, which then
   joins the existing 5V rail through one more diode (D4) alongside D1/D2
   — same OR-ing pattern as the USB-C/DC-buck sources, just a third leg.
5. **U6 (MAX17048)** — a fuel-gauge IC on its own dedicated I2C bus
   (`BATT_SDA`/`BATT_SCL` — GPIO21/22 above), reporting state-of-charge
   percentage and cell voltage to the firmware (`BatteryMonitor` — see
   `../firmware/src/BatteryMonitor.h`). This is a fuel gauge, not a
   protection device — U7/Q4 above are what actually keep the cell safe;
   U6 only tells the firmware (and, through it, a low-battery LED state)
   what's left.

No new GPIO is spent on the charger/protection/boost stage itself — it's
autonomous analog/power circuitry between the cell and the existing 5V
rail, transparent to firmware except through U6's I2C readout.

## Input protection (added for a product that isn't just for the builder)

A prototype board on your own bench can get away without this; a board
that ships to someone else's install, wired by someone who isn't you,
can't. All of the below sit ahead of everything already described —
nothing downstream changes:

- **Q5 (P-channel MOSFET reverse-polarity protection)** on the J2 12–24V
  DC input. A series diode would also block reverse polarity but wastes
  power as heat proportional to load current, forever, on every unit, for
  as long as it's plugged in — the MOSFET version's voltage drop is
  negligible by comparison. Standard topology: source to the input pin,
  drain to the protected rail, gate referenced to ground through R15 —
  conducts (near-zero drop) when polarity is correct, stays off (blocking)
  when it's reversed.
- **F1 (resettable PTC fuse)** in series on the same input, sized to the
  board's actual maximum draw (ESP32 WiFi TX peaks + relay coil + charging
  current, with headroom) — protects against a wiring fault or a shorted
  downstream connector without needing a truck roll to replace a
  blown-fuse-and-a-visit; it just resets once the fault clears.
- **D5, D6 (TVS diodes)** across the DC input and the USB-C VBUS/GND
  respectively — absorb ESD and short transients (a lock's power supply
  sharing a run with other equipment, a cable getting statically
  discharged during install) before they reach anything else on the
  board.

None of this is optional polish for a board other people will wire up
without you standing there — see `../PRODUCTION.md` for the fuller case
(and for what these additions do *not* cover, like actual regulatory
certification).
