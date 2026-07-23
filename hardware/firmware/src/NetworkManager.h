#pragma once
#include <Arduino.h>

// Brings up whichever network interface is available — Ethernet (W5500,
// preferred when a cable is plugged in) or WiFi (fallback) — through the
// ESP32 core's own network stack (ETH.h + WiFi.h), NOT the classic
// arduino-libraries/Ethernet shield library. That distinction matters: the
// core's ETH.h shares the same underlying lwIP/socket stack that WiFi.h
// uses, which is what lets AgentClient's WebSocketsClient (built on
// WiFiClient) work unmodified over either interface. The classic Ethernet
// library runs its own separate stack on the W5500's hardware socket
// engine and doesn't interoperate with WiFiClient at all — using it here
// would have meant either two entirely separate AgentClient code paths, or
// Ethernet silently not working with the rest of this firmware.
class NetworkManager {
public:
  void begin();
  void loop();
  bool isConnected() const;
  const char *activeInterface() const; // "ethernet" | "wifi" | "none"

private:
  bool ethStarted = false;
  bool wifiConnecting = false;
  unsigned long lastEthLinkCheck = 0;
  unsigned long lastWifiAttempt = 0;

  void startEthernet();
  void maintainWifi();
};
