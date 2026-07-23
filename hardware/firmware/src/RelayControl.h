#pragma once
#include <Arduino.h>

// Pulses K1 (the door-strike/lock relay) for Timing::RELAY_PULSE_MS, then
// releases automatically — non-blocking, so main.cpp's loop() (and the
// agent websocket connection) keeps running while a strike is held open.
// R12's gate pull-down (see BOM.md) keeps this off during boot/reset
// regardless of what firmware does, so a power-cycle can't itself unlock
// anything.
class RelayControl {
public:
  void begin();
  void loop();
  void pulse();
  bool isEngaged() const { return engaged; }

private:
  bool engaged = false;
  unsigned long releaseAt = 0;
};
