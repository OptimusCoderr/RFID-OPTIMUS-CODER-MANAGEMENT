#pragma once

// Pin assignments — must match hardware/schematic/pinout.md exactly. If you
// change the board layout, change it there first, then here.
namespace Pins {
constexpr int SPI_SCK = 18;
constexpr int SPI_MISO = 19;
constexpr int SPI_MOSI = 23;

constexpr int PN532_CS = 4;
constexpr int PN532_IRQ = 33;
constexpr int PN532_RSTPDN = 25;

constexpr int ETH_CS = 5;
constexpr int ETH_RST = 26;
constexpr int ETH_INT = 27; // polled, not attached as a true interrupt

constexpr int LED_DATA = 16;
constexpr int BUZZER = 17;
constexpr int RELAY_DRIVE = 32;
constexpr int TAMPER_SW = 34;
constexpr int BOOT_BTN = 0;

constexpr int BATT_SDA = 21; // MAX17048 fuel gauge — see pinout.md's "Battery power system"
constexpr int BATT_SCL = 22;
} // namespace Pins

namespace Timing {
constexpr unsigned long APP_HEARTBEAT_MS = 30'000; // matches server/src/agent/agent.ts's own interval
constexpr unsigned long NFC_POLL_MS = 200;          // how often to ask the PN532 for a tag when IRQ is idle
constexpr unsigned long CARD_DEBOUNCE_MS = 1'500;   // suppress re-emitting card:detected for the same UID this often
constexpr unsigned long RELAY_PULSE_MS = 3'000;     // door-strike hold time after a granted tap
constexpr unsigned long FACTORY_RESET_HOLD_MS = 5'000; // BOOT_BTN long-press duration
constexpr unsigned long ETH_LINK_CHECK_MS = 2'000;
constexpr unsigned long WIFI_RETRY_MS = 5'000;
constexpr unsigned long BATTERY_POLL_MS = 10'000;   // how often to re-read the fuel gauge
} // namespace Timing

namespace Battery {
// Below this state-of-charge percentage, StatusIndicator shows LOW_BATTERY
// instead of whatever it would otherwise show. Not a hard cutoff — U7
// (DW01A) on the board is what actually disconnects the cell at a much
// lower, protection-grade threshold; this is just an earlier heads-up.
constexpr float LOW_PERCENT = 15.0f;
} // namespace Battery

// agentKey / WiFi credentials / server address are secrets, not something to
// commit — see Secrets.h.example. Copy it to Secrets.h (gitignored) and fill
// in real values before building.
#include "Secrets.h"
