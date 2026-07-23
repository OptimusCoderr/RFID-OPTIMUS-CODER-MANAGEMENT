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
| 21 | — | `EXP_SDA` | Unused by this design (PN532 runs over SPI, not I2C) — broken out to J4 (expansion header) for future sensors. |
| 22 | — | `EXP_SCL` | Same as above. |
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
