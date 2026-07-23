// RFID Optimus Encoder firmware — see ../README.md before flashing this.
//
// Wires together:
//   NetworkManager  — Ethernet (preferred) or WiFi
//   AgentClient     — the /agent Socket.IO protocol (same one the desktop
//                      agent speaks — server/src/agent/agent.ts)
//   NfcReader       — PN532: UID polling, MIFARE Classic block auth/RW,
//                      NTAG21x page RW
//   StatusIndicator — WS2812 LED + piezo buzzer feedback
//   RelayControl    — door-strike/lock output, pulsed on a successful tap
//
// What a tap actually does: this firmware only reports a UID
// (`card:detected`) — it does not itself decide "known card, let them in."
// That decision is made server/dashboard-side (see client/src/pages/
// AttendancePage.tsx's onCardDetected, which looks the UID up and calls
// POST /api/attendance) exactly the same way it already works for the
// desktop PC/SC agent. This board's relay pulses on every tap it reports,
// not on a "granted" response — there is no such response in this
// protocol today. Gating the door strike on the actual attendance
// decision would need a new command type from server to agent, which
// doesn't exist yet; see the README's limitations section.

#include <Arduino.h>
#include <SPI.h>
#include "Config.h"
#include "NetworkManager.h"
#include "NfcReader.h"
#include "AgentClient.h"
#include "StatusIndicator.h"
#include "RelayControl.h"
#include "BatteryMonitor.h"
#include "Hex.h"

static NetworkManager network;
static NfcReader nfc;
static AgentClient agent;
static StatusIndicator led;
static RelayControl relay;
static BatteryMonitor battery;

static bool agentStarted = false;
static unsigned long bootBtnPressedAt = 0;
static bool tamperOpen = false; // last-reported state, so this only logs on change

// Tracks the persistent LED state we last actually applied, so the
// idle/connecting/low-battery LED only updates on a real change instead of
// stomping a TAP_OK/TAP_ERROR flash every single loop() — computed fresh
// each iteration from network+battery state, then compared here rather
// than driven by a single boolean edge-trigger, since it now depends on
// two independent conditions (connectivity, battery) instead of one.
static Status lastPersistentStatus = Status::BOOTING;

static void handleCommand(const String &commandId, const String &command, JsonObjectConst args) {
  JsonDocument resultDoc;
  JsonVariant data; // stays null for error results
  bool ok = false;
  String error;

  if (command == "READ_UID") {
    const DetectedCard *card = nfc.currentCard();
    if (!card) {
      error = "No card present on the reader";
    } else {
      JsonObject obj = resultDoc.to<JsonObject>();
      obj["uid"] = card->uidHex;
      data = obj;
      ok = true;
    }
  } else if (command == "READ_BLOCK") {
    const int block = args["block"] | -1;
    const String keyHex = args["key"] | "";
    const char *keyType = args["keyType"] | "A";
    const bool keyB = String(keyType) == "B";
    uint8_t key[6];
    uint8_t blockData[16];
    if (block < 0 || !Hex::decode(keyHex, key, 6)) {
      error = "Invalid block/key";
    } else if (!nfc.authenticateBlock(block, keyB ? 1 : 0, key)) {
      error = "Authentication failed";
    } else if (!nfc.readBlock(block, blockData)) {
      error = "Read failed";
    } else {
      JsonObject obj = resultDoc.to<JsonObject>();
      obj["block"] = block;
      obj["data"] = Hex::encode(blockData, 16);
      data = obj;
      ok = true;
    }
  } else if (command == "WRITE_BLOCK") {
    const int block = args["block"] | -1;
    const String dataHex = args["data"] | "";
    const String keyHex = args["key"] | "";
    const char *keyType = args["keyType"] | "A";
    const bool keyB = String(keyType) == "B";
    uint8_t key[6];
    uint8_t blockData[16];
    if (block < 0 || !Hex::decode(keyHex, key, 6) || !Hex::decode(dataHex, blockData, 16)) {
      error = "Invalid block/key/data";
    } else if (!nfc.authenticateBlock(block, keyB ? 1 : 0, key)) {
      error = "Authentication failed";
    } else if (!nfc.writeBlock(block, blockData)) {
      error = "Write failed";
    } else {
      JsonObject obj = resultDoc.to<JsonObject>();
      obj["block"] = block;
      obj["written"] = true;
      data = obj;
      ok = true;
    }
  } else if (command == "READ_NTAG") {
    const int page = args["page"] | -1;
    uint8_t pageData[4];
    if (page < 0) {
      error = "Invalid page";
    } else if (!nfc.readPage(page, pageData)) {
      error = "Read failed";
    } else {
      JsonObject obj = resultDoc.to<JsonObject>();
      obj["page"] = page;
      obj["data"] = Hex::encode(pageData, 4);
      data = obj;
      ok = true;
    }
  } else if (command == "WRITE_NTAG") {
    const int page = args["page"] | -1;
    const String dataHex = args["data"] | "";
    uint8_t pageData[4];
    if (page < 0 || !Hex::decode(dataHex, pageData, 4)) {
      error = "Invalid page/data";
    } else if (!nfc.writePage(page, pageData)) {
      error = "Write failed";
    } else {
      JsonObject obj = resultDoc.to<JsonObject>();
      obj["page"] = page;
      obj["written"] = true;
      data = obj;
      ok = true;
    }
  } else {
    // MIFARE DESFire commands (GET_DESFIRE_VERSION, LIST_APPLICATIONS,
    // CREATE_FILE, etc — see server/src/agent/agent.ts's full list) fall
    // through to here, same as any other command this firmware doesn't
    // implement. Not a bug: see README.md's "DESFire is not implemented"
    // section for why.
    error = "Unsupported command: " + command;
  }

  agent.emitCommandResult(commandId, command, ok, data, error);
  led.set(ok ? Status::TAP_OK : Status::TAP_ERROR);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] RFID Optimus Encoder");

  led.begin();
  relay.begin();

  pinMode(Pins::TAMPER_SW, INPUT); // external pull-up (R5) — see pinout.md, GPIO34 has no internal pull
  pinMode(Pins::BOOT_BTN, INPUT_PULLUP);

  SPI.begin(Pins::SPI_SCK, Pins::SPI_MISO, Pins::SPI_MOSI);

  if (!nfc.begin()) {
    Serial.println("[boot] continuing without a working NFC reader — check J3 (see README's bring-up checklist)");
  }

  battery.begin(); // fine if absent — see BatteryMonitor.h

  network.begin();
  agent.onCommand(handleCommand);

  led.set(Status::CONNECTING);
}

void loop() {
  network.loop();
  led.loop();
  relay.loop();
  battery.loop();

  // AgentClient needs an active network link before ws.begin()'s internal
  // reconnect logic can do anything useful — starting it before then just
  // means its first several reconnect attempts fail fast, which is
  // harmless, but we hold off entirely for a cleaner boot log.
  if (!agentStarted && network.isConnected()) {
    agent.begin();
    agentStarted = true;
    Serial.printf("[boot] network up via %s, starting agent connection\n", network.activeInterface());
  }
  if (agentStarted) agent.loop();

  // Recomputed fresh every loop() from current network+battery state, and
  // only re-applied to the LED when it actually changed — see
  // lastPersistentStatus's declaration. Not connected takes priority over
  // low battery (a device that isn't even talking to the server has the
  // more fundamental problem); a flash from a tap below still briefly
  // overrides whichever of these was last set, and StatusIndicator::loop()
  // reverts to it once the flash ends.
  const Status wantPersistent = !agent.isConnected()                    ? Status::CONNECTING
                                 : (battery.isPresent() && battery.isLow()) ? Status::LOW_BATTERY
                                                                            : Status::IDLE;
  if (wantPersistent != lastPersistentStatus) {
    lastPersistentStatus = wantPersistent;
    led.set(wantPersistent);
  }

  DetectedCard card;
  if (nfc.poll(card)) {
    Serial.printf("[nfc] tap: %s\n", card.uidHex.c_str());
    if (agent.isConnected()) {
      agent.emitCardDetected(card.uidHex);
      relay.pulse(); // see the file header comment — this is "tap reported," not "access granted"
      led.set(Status::TAP_OK);
    } else {
      Serial.println("[nfc] tap ignored — agent not connected, nothing to report it to");
      led.set(Status::TAP_ERROR);
    }
  }

  // Long-press BOOT_BTN at runtime = clean restart. (Not the ESP32's own
  // boot-mode function — that only applies during the very start of power-
  // on/reset, which this check runs well after.)
  if (digitalRead(Pins::BOOT_BTN) == LOW) {
    if (bootBtnPressedAt == 0) bootBtnPressedAt = millis();
    else if (millis() - bootBtnPressedAt >= Timing::FACTORY_RESET_HOLD_MS) {
      Serial.println("[boot] BOOT_BTN held — restarting");
      ESP.restart();
    }
  } else {
    bootBtnPressedAt = 0;
  }

  // SW2 is normally-closed to GND with an external pull-up (R5) — LOW means
  // the enclosure is intact, HIGH means it's open. Edge-triggered so this
  // logs once per state change, not once per loop() while open. Wiring
  // this into the dashboard (a new "encoder:tamper" websocket event) is a
  // natural next step — not yet implemented, so today it only reaches the
  // serial console.
  const bool tamperNow = digitalRead(Pins::TAMPER_SW) == HIGH;
  if (tamperNow != tamperOpen) {
    tamperOpen = tamperNow;
    Serial.println(tamperOpen ? "[tamper] enclosure opened" : "[tamper] enclosure closed");
  }
}
