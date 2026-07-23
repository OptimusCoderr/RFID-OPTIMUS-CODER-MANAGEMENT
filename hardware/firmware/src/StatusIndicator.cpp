#include "StatusIndicator.h"
#include <Adafruit_NeoPixel.h>
#include "Config.h"

static Adafruit_NeoPixel pixel(1, Pins::LED_DATA, NEO_GRB + NEO_KHZ800);

void StatusIndicator::begin() {
  pixel.begin();
  pixel.setBrightness(60); // full brightness on a 5050 LED is uncomfortably bright this close to a reader
  pinMode(Pins::BUZZER, OUTPUT);
  digitalWrite(Pins::BUZZER, LOW);
  applyColor(20, 20, 20); // dim white while booting
}

void StatusIndicator::applyColor(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void StatusIndicator::set(Status status) {
  // BOOTING/CONNECTING/IDLE/LOW_BATTERY are persistent states; TAP_OK/
  // TAP_ERROR are transient flashes layered on top without replacing
  // whichever persistent state was active underneath them.
  if (status != Status::TAP_OK && status != Status::TAP_ERROR) {
    baseStatus = status;
  }
  applyStatus(status);
}

void StatusIndicator::applyStatus(Status status) {
  current = status;
  const unsigned long now = millis();
  switch (status) {
    case Status::BOOTING:
      applyColor(20, 20, 20);
      break;
    case Status::CONNECTING:
      applyColor(0, 0, 60); // steady-ish; loop() pulses it
      break;
    case Status::IDLE:
      applyColor(0, 0, 80);
      break;
    case Status::LOW_BATTERY:
      applyColor(200, 130, 0); // solid amber — not pulsed, not a flash: stays until BatteryMonitor says otherwise
      break;
    case Status::TAP_OK:
      applyColor(0, 180, 0);
      flashUntil = now + 400;
      beep(80);
      break;
    case Status::TAP_ERROR:
      applyColor(200, 0, 0);
      flashUntil = now + 600;
      beep(300);
      break;
  }
}

void StatusIndicator::beep(uint16_t durationMs) {
  tone(Pins::BUZZER, 2200);
  buzzerOffAt = millis() + durationMs;
}

void StatusIndicator::loop() {
  const unsigned long now = millis();

  if (buzzerOffAt && now >= buzzerOffAt) {
    noTone(Pins::BUZZER);
    buzzerOffAt = 0;
  }

  // A flash (tap result) reverts to whatever the real persistent state
  // (baseStatus) is once its hold time is up — not a guess, since main.cpp
  // may have changed the actual connection state while the flash was showing.
  if (flashUntil && now >= flashUntil) {
    flashUntil = 0;
    applyStatus(baseStatus);
    return;
  }

  // CONNECTING pulses slowly so it reads as "working," not "stuck." Only
  // while it's actually being shown — not muted by an in-progress flash,
  // and not still pulsing if baseStatus moved on to IDLE.
  if (current == Status::CONNECTING && now - lastPulseAt >= 500) {
    lastPulseAt = now;
    pulseOn = !pulseOn;
    applyColor(0, 0, pulseOn ? 80 : 15);
  }
}
