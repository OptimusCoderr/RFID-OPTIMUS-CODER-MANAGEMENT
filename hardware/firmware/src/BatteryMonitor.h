#pragma once
#include <Arduino.h>
#include <Adafruit_MAX1704X.h>
#include "Config.h"

// Wraps the MAX17048 fuel gauge (U6 — see pinout.md's "Battery power
// system"). This is a gauge only, not a safety device — U7 (DW01A) + Q4
// (FS8205A) on the board are what actually protect the cell from over-
// charge/over-discharge/overcurrent; this class exists purely to let the
// firmware show a low-battery warning before U7 ever needs to step in.
//
// Populating the battery subsystem at all is optional — a board built
// without BATT1/U6-U9 (mains/PoE-only deployment, say) simply won't have
// anything answer on the I2C bus, and begin() reports that rather than
// blocking the rest of the firmware on hardware that isn't there.
class BatteryMonitor {
public:
  bool begin();
  void loop();

  bool isPresent() const { return present; }
  float percent() const { return lastPercent; }
  float voltage() const { return lastVoltage; }
  bool isLow() const { return present && lastPercent < Battery::LOW_PERCENT; }

private:
  Adafruit_MAX17048 gauge;
  bool present = false;
  float lastPercent = 100.0f;
  float lastVoltage = 0.0f;
  unsigned long lastPollAt = 0;
};
