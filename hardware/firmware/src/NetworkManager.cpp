#include "NetworkManager.h"
#include <ETH.h>
#include <WiFi.h>
#include "Config.h"

// --- A known risk point, flagged rather than hidden ---
//
// arduino-esp32's ETH.begin() overload for SPI-attached PHYs (W5500,
// DM9051, KSZ8851) has changed shape across core releases as SPI-Ethernet
// support matured. Against core ~2.0.14 (the version this project pins in
// platformio.ini) it takes the form used below — explicit SCK/MISO/MOSI
// pins plus a SPI clock, rather than assuming a pre-configured global SPI
// instance. If this doesn't compile against whatever core version actually
// gets pulled in, check the installed <ETH.h> for the exact SPI overload's
// parameter order before assuming the logic here is wrong — this is the
// single least-certain line in this firmware (see ../../README.md).
static bool startEthernetHardware() {
  return ETH.begin(
      ETH_PHY_W5500,        // type
      1,                    // phy_addr — W5500 ignores this, but the API requires one
      Pins::ETH_CS,         // cs
      Pins::ETH_INT,        // irq
      Pins::ETH_RST,        // rst
      SPI3_HOST,            // use VSPI's underlying SPI peripheral, not the default HSPI
      Pins::SPI_SCK, Pins::SPI_MISO, Pins::SPI_MOSI
  );
}

void NetworkManager::begin() {
  pinMode(Pins::ETH_RST, OUTPUT);
  digitalWrite(Pins::ETH_RST, HIGH); // idle high per pinout.md

  startEthernet();

  // WiFi is only actually started once loop() decides Ethernet isn't
  // coming up (see maintainWifi()) — no point radiating WiFi if a cable's
  // plugged in.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
}

void NetworkManager::startEthernet() {
  ethStarted = startEthernetHardware();
  if (!ethStarted) {
    Serial.println("[net] ETH.begin() failed — W5500 not responding (check wiring/CS/RST) or this core's ETH.h "
                    "SPI overload doesn't match what this code calls; see the comment above startEthernetHardware()");
  }
}

void NetworkManager::maintainWifi() {
  // Ethernet has priority: if it's up, don't bother starting WiFi at all.
  if (ethStarted && ETH.linkUp()) {
    if (WiFi.status() == WL_CONNECTED) WiFi.disconnect(true);
    wifiConnecting = false;
    return;
  }

  if (WiFi.status() == WL_CONNECTED) return;

  const unsigned long now = millis();
  if (wifiConnecting && now - lastWifiAttempt < Timing::WIFI_RETRY_MS) return;

  wifiConnecting = true;
  lastWifiAttempt = now;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void NetworkManager::loop() {
  const unsigned long now = millis();
  if (now - lastEthLinkCheck >= Timing::ETH_LINK_CHECK_MS) {
    lastEthLinkCheck = now;
    if (!ethStarted) startEthernet(); // retry — e.g. a W5500 that wasn't ready yet at boot
  }
  maintainWifi();
}

bool NetworkManager::isConnected() const {
  return (ethStarted && ETH.linkUp() && ETH.localIP() != IPAddress(0, 0, 0, 0)) || WiFi.status() == WL_CONNECTED;
}

const char *NetworkManager::activeInterface() const {
  if (ethStarted && ETH.linkUp() && ETH.localIP() != IPAddress(0, 0, 0, 0)) return "ethernet";
  if (WiFi.status() == WL_CONNECTED) return "wifi";
  return "none";
}
