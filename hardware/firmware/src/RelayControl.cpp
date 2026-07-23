#include "RelayControl.h"
#include "Config.h"

void RelayControl::begin() {
  pinMode(Pins::RELAY_DRIVE, OUTPUT);
  digitalWrite(Pins::RELAY_DRIVE, LOW);
}

void RelayControl::pulse() {
  digitalWrite(Pins::RELAY_DRIVE, HIGH);
  engaged = true;
  releaseAt = millis() + Timing::RELAY_PULSE_MS;
}

void RelayControl::loop() {
  if (engaged && millis() >= releaseAt) {
    digitalWrite(Pins::RELAY_DRIVE, LOW);
    engaged = false;
  }
}
