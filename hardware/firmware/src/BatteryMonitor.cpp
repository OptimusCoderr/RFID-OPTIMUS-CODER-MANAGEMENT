#include "BatteryMonitor.h"
#include <Wire.h>

bool BatteryMonitor::begin() {
  Wire.begin(Pins::BATT_SDA, Pins::BATT_SCL);
  present = gauge.begin();
  if (!present) {
    Serial.println("[batt] MAX17048 not responding — no battery populated, or U6 not wired. Continuing without it.");
    return false;
  }
  lastPercent = gauge.cellPercent();
  lastVoltage = gauge.cellVoltage();
  Serial.printf("[batt] MAX17048 found — %.0f%%, %.2fV\n", lastPercent, lastVoltage);
  return true;
}

void BatteryMonitor::loop() {
  if (!present) return;
  const unsigned long now = millis();
  if (now - lastPollAt < Timing::BATTERY_POLL_MS) return;
  lastPollAt = now;

  lastPercent = gauge.cellPercent();
  lastVoltage = gauge.cellVoltage();
  if (isLow()) {
    Serial.printf("[batt] low: %.0f%%, %.2fV\n", lastPercent, lastVoltage);
  }
}
