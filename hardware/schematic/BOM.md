# Bill of materials — RFID Optimus Encoder board

Reference designators match `schematic-overview.svg`. Quantities are per
board. Parts are real, commonly-stocked components (Mouser/DigiKey/LCSC) —
substitute pin-compatible equivalents freely; nothing here is single-sourced
except where noted.

| Ref | Part | Description | Qty |
|---|---|---|---|
| U1 | ESP32-WROOM-32E (4MB) | Main MCU module, WiFi + BT | 1 |
| U2 | WIZnet W5500 | SPI-to-Ethernet MAC+PHY | 1 |
| U3 | AMS1117-3.3 | 3.3V 1A LDO regulator | 1 |
| U4 | MP1584EN module (or equiv. adjustable buck) | 12-24V → 5V, for the DC-jack power path | 1 |
| U5 | CP2102N-A02-GQFN28 | USB-to-UART bridge (programming/console) | 1 |
| J1 | USB-C receptacle (USB 2.0, power+data only) | Power + programming | 1 |
| J2 | 2-pin 5.08mm screw terminal | 12-24V DC input (alternative to USB-C) | 1 |
| J3 | 2.54mm 8-pin header (female) | PN532 NFC module socket — see `pinout.md` | 1 |
| J4 | 2.54mm 6-pin header | Expansion (I2C + 2 spare GPIO + 3V3/GND) | 1 |
| J5 | RJ45 with integrated magnetics — HanRun HR911105A | Ethernet jack for W5500 | 1 |
| J6 | 3-pin 5.08mm screw terminal | Relay NO/COM/NC — external lock/strike circuit | 1 |
| K1 | SRD-05VDC-SL-C (or equiv. 5V-coil SPDT relay) | Door-strike/lock switching | 1 |
| D1, D2 | SS14 (Schottky, 1A) | OR-ing diodes: USB-C 5V vs. buck-converter 5V | 2 |
| D3 | 1N4148 | Flyback diode across K1's coil | 1 |
| Q1 | 2N7002 (N-channel MOSFET, SOT-23) | Relay coil driver, gate from `RELAY_DRIVE` | 1 |
| Q2 | 2N7002 | Auto-reset: CP2102N DTR → EN | 1 |
| Q3 | BC847 (NPN, SOT-23) | Buzzer driver, base from `BUZZER` | 1 |
| BZ1 | Passive piezo buzzer, 3.3V-tolerant | Tap/error feedback tone | 1 |
| LED1 | WS2812B-2020 (or -5050) | Status LED (green/red/blue via one data pin) | 1 |
| SW1 | 6mm tactile switch | Manual EN reset | 1 |
| SW2 | Enclosure tamper microswitch (normally-closed) | `TAMPER_SW` input | 1 |
| BOOT_SW | 6mm tactile switch | `BOOT_BTN` (GPIO0) — flashing + runtime long-press reset | 1 |
| R1 | 10kΩ | EN pull-up | 1 |
| R2 | 10kΩ | GPIO0 pull-up (BOOT_SW) | 1 |
| R3, R4 | 10kΩ | CP2102N DTR/RTS auto-reset network (with Q2) | 2 |
| R5 | 10kΩ | `TAMPER_SW` external pull-up (GPIO34 has none internal) | 1 |
| R6 | 10kΩ | `ETH_RST` pull-up (idle high) | 1 |
| R7 | 10kΩ | `PN532_RSTPDN` pull-up (idle high) | 1 |
| R8, R9 | 5.1kΩ | USB-C CC1/CC2 (declares this as a 5V/default-current sink per USB-C spec) | 2 |
| R10 | 330Ω | LED1 data-line series resistor | 1 |
| R11 | 1kΩ | Q1 base/gate series resistor | 1 |
| R12 | 10kΩ | Q1 gate pull-down (keeps relay off during MCU boot/reset) | 1 |
| R13 | 1kΩ | Q3 base series resistor | 1 |
| C1 | 100nF | EN power-on delay cap | 1 |
| C2, C3 | 10µF ceramic | 3V3 rail decoupling (U3 in/out) | 2 |
| C4 | 22µF ceramic/tantalum | 5V rail bulk decoupling | 1 |
| C5-C8 | 100nF ceramic | Local decoupling: U1, U2, U5, K1-driver area (one each) | 4 |
| — | 2.54mm pin headers, various | J3/J4 mating headers, not populated on this board | — |

## Explicitly not on this BOM

- **PN532 module itself** — sourced separately as a pre-tuned breakout
  (e.g. "PN532 NFC/RFID module V3", widely available), plugged into J3. See
  `../README.md`.
- **Ethernet transformer** — integrated into J5 (HR911105A already contains
  it), so no separate part is needed.
- **Enclosure** — out of scope for the schematic; SW2 (tamper) assumes
  whatever enclosure is used has a lid-actuated microswitch point.
