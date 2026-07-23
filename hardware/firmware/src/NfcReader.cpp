#include "NfcReader.h"
#include "Hex.h"

bool NfcReader::begin() {
  pinMode(Pins::PN532_RSTPDN, OUTPUT);
  digitalWrite(Pins::PN532_RSTPDN, HIGH); // idle high — active-low reset, per pinout.md
  pinMode(Pins::PN532_IRQ, INPUT_PULLUP);

  pn532.begin();
  uint32_t version = pn532.getFirmwareVersion();
  if (!version) {
    Serial.println("[nfc] PN532 not responding — check J3 wiring/module power/SPI mode switch");
    return false;
  }
  Serial.printf("[nfc] PN532 found, firmware v%d.%d\n", (version >> 16) & 0xFF, (version >> 8) & 0xFF);

  // SAMConfig() puts the PN532 into normal reader mode — required once
  // after every power-up/reset before readPassiveTargetID will work.
  pn532.SAMConfig();
  return true;
}

bool NfcReader::poll(DetectedCard &out) {
  const unsigned long now = millis();
  if (now - lastPollAt < Timing::NFC_POLL_MS) return false;
  lastPollAt = now;

  // IRQ is active-low "tag present" from the PN532 — cheap digitalRead
  // check to skip the (comparatively slow) SPI transaction most loop()
  // iterations when nothing's on the reader.
  if (digitalRead(Pins::PN532_IRQ) == HIGH) {
    hasCurrentCard = false; // card lifted since last poll
    return false;
  }

  // IRQ says a card is present. If we already know about it (hasCurrentCard
  // still true from a previous poll), this is the same ongoing tap — the
  // card hasn't been lifted, so there's nothing new to read or report.
  // This is the primary debounce: edge-triggered on presence, not
  // time-based, so a card left resting on the reader fires card:detected
  // exactly once, not every CARD_DEBOUNCE_MS for as long as it sits there
  // (a time-based re-fire would mean an access-control tap toggles
  // check-in/check-out repeatedly just from someone resting their badge on
  // the reader, which defeats the point of a debounce).
  if (hasCurrentCard) return false;

  DetectedCard card;
  uint8_t success = pn532.readPassiveTargetID(PN532_MIFARE_ISO14443A, card.uidBytes, &card.uidLength,
                                               /*timeout ms*/ 50);
  if (!success) return false;

  card.uidHex = Hex::encode(card.uidBytes, card.uidLength);

  // Secondary guard: IRQ chatter right at the edge of a lift-then-immediate-
  // retap of the SAME card (electrical/mechanical bounce), not a
  // continuously-resting card — that case is already handled by the
  // hasCurrentCard check above. Only suppresses a re-report if it's the
  // same UID as last time AND within the debounce window; a different card
  // tapped quickly after another is never suppressed.
  const bool bounceOfSameCard = card.uidHex == current.uidHex && now - lastDetectAt < Timing::CARD_DEBOUNCE_MS;
  current = card;
  hasCurrentCard = true;
  if (bounceOfSameCard) return false;

  lastDetectAt = now;
  out = card;
  return true;
}

const DetectedCard *NfcReader::currentCard() const { return hasCurrentCard ? &current : nullptr; }

bool NfcReader::authenticateBlock(uint8_t block, uint8_t keyType, const uint8_t key[6]) {
  if (!hasCurrentCard) return false;
  uint8_t keyTypeConst = (keyType == 1) ? 1 : 0; // Adafruit_PN532: 0 = Key A, 1 = Key B
  return pn532.mifareclassic_AuthenticateBlock(current.uidBytes, current.uidLength, block, keyTypeConst,
                                                const_cast<uint8_t *>(key));
}

bool NfcReader::readBlock(uint8_t block, uint8_t data[16]) { return pn532.mifareclassic_ReadDataBlock(block, data); }

bool NfcReader::writeBlock(uint8_t block, const uint8_t data[16]) {
  return pn532.mifareclassic_WriteDataBlock(block, const_cast<uint8_t *>(data));
}

bool NfcReader::readPage(uint8_t page, uint8_t data[4]) {
  // mifareultralight_ReadPage fills a 4-byte page but some PN532 firmware
  // returns 16 bytes (4 pages) per call — the library's own buffer
  // contract is "at least 4 bytes, only the first 4 are this page", which
  // is all callers here need.
  return pn532.mifareultralight_ReadPage(page, data);
}

bool NfcReader::writePage(uint8_t page, const uint8_t data[4]) {
  return pn532.ntag2xx_WritePage(page, const_cast<uint8_t *>(data));
}
