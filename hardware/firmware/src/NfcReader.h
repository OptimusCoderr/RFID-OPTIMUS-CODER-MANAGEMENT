#pragma once
#include <Arduino.h>
#include <Adafruit_PN532.h>
#include "Config.h"

struct DetectedCard {
  uint8_t uidBytes[7] = {0};
  uint8_t uidLength = 0;
  String uidHex; // Hex::encode(uidBytes, uidLength) — cached so callers don't recompute it
};

// Wraps Adafruit_PN532 for the two card families this app already knows how
// to template/encode: MIFARE Classic (block-based, key-authenticated) and
// NTAG21x/Ultralight (page-based, no key). DESFire is deliberately NOT
// implemented here — see ../../README.md's "DESFire is not implemented on
// this firmware" section. That's the same graceful-unsupported behavior the
// desktop agent falls back to for any command it doesn't recognize
// (server/src/agent/agent.ts's `default:` case), not a silent gap.
class NfcReader {
public:
  bool begin();

  // Call every loop(). Returns true at most once per physically-new tap
  // (debounced by Config::Timing::CARD_DEBOUNCE_MS so a card left sitting
  // on the reader doesn't re-fire every poll interval) and fills `out`.
  bool poll(DetectedCard &out);

  // The most recently detected card, or nullptr if none since boot / since
  // it was last removed. Commands like READ_BLOCK operate against whatever
  // is currently presented, same as the desktop agent's `lastCard`.
  const DetectedCard *currentCard() const;

  bool authenticateBlock(uint8_t block, uint8_t keyType /* 0=A, 1=B */, const uint8_t key[6]);
  bool readBlock(uint8_t block, uint8_t data[16]);
  bool writeBlock(uint8_t block, const uint8_t data[16]);

  bool readPage(uint8_t page, uint8_t data[4]);
  bool writePage(uint8_t page, const uint8_t data[4]);

private:
  Adafruit_PN532 pn532{Pins::PN532_CS, &SPI};
  DetectedCard current;
  bool hasCurrentCard = false;
  unsigned long lastPollAt = 0;
  unsigned long lastDetectAt = 0;
};
