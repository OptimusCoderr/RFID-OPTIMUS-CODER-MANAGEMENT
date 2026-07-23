#pragma once
#include <Arduino.h>

// No "access granted/denied" states here on purpose — this firmware only
// ever knows "reported a tap to the server" (TAP_OK) or "couldn't"
// (TAP_ERROR: not connected, or a command from the server failed). Whether
// the tapped card was actually recognized is decided server/dashboard-side
// (see main.cpp's file header comment) and never comes back down to this
// device today, so there's nothing here to color amber for.
//
// LOW_BATTERY is a different kind of state from the other four: it's not
// about the agent connection at all, and unlike a TAP_* flash it doesn't
// self-clear — it's driven by BatteryMonitor's real fuel-gauge reading
// (see main.cpp) and stays up for as long as the condition is true.
enum class Status {
  BOOTING,     // dim white
  CONNECTING,  // pulsing blue — network or agent handshake not up yet
  IDLE,        // solid blue — connected, waiting for a tap
  LOW_BATTERY, // solid amber — persistent, not a flash; see BatteryMonitor
  TAP_OK,      // brief green flash
  TAP_ERROR,   // brief red flash — command/network error, or a tap while disconnected
};

// One WS2812 LED (Pins::LED_DATA) is the whole feedback story here — no
// buzzer tone catalog, just on/off — see RelayControl for the other half
// of tap feedback (the actual door-strike pulse).
class StatusIndicator {
public:
  void begin();
  void loop();
  void set(Status status);
  void beep(uint16_t durationMs = 80);

private:
  // baseStatus is the persistent state (BOOTING/CONNECTING/IDLE/LOW_BATTERY)
  // — what the LED reverts to once a flash ends. current is whatever's actually being
  // shown right now, which during a flash is a TAP_* status baseStatus
  // itself never takes. Keeping these separate (rather than one field doing
  // both jobs) means a flash always reverts to the real current connection
  // state, not a guess about what it probably still is.
  Status baseStatus = Status::BOOTING;
  Status current = Status::BOOTING;
  unsigned long flashUntil = 0;
  unsigned long lastPulseAt = 0;
  bool pulseOn = false;
  unsigned long buzzerOffAt = 0;

  void applyColor(uint8_t r, uint8_t g, uint8_t b);
  void applyStatus(Status status);
};
