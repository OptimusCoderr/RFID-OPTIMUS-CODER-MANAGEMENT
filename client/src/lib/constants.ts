import type { CardStatus, CardType, EncoderConnectionType, EncoderType } from "@/types";

export const CARD_TYPE_OPTIONS: CardType[] = [
  "MIFARE_CLASSIC_1K",
  "MIFARE_CLASSIC_4K",
  "MIFARE_CLASSIC_MINI",
  "MIFARE_ULTRALIGHT",
  "MIFARE_ULTRALIGHT_C",
  "MIFARE_DESFIRE_EV1",
  "MIFARE_DESFIRE_EV2",
  "MIFARE_DESFIRE_EV3",
  "MIFARE_PLUS",
  "NTAG213",
  "NTAG215",
  "NTAG216",
  "EM4100_125KHZ",
  "HID_PROX_125KHZ",
  "T5577_125KHZ",
  "GENERIC_ISO14443A",
  "GENERIC_ISO15693",
  "OTHER",
];

export const CARD_STATUS_OPTIONS: CardStatus[] = [
  "UNASSIGNED",
  "ACTIVE",
  "ASSIGNED",
  "BLOCKED",
  "LOST",
  "EXPIRED",
  "RETIRED",
];

export const ENCODER_TYPE_OPTIONS: EncoderType[] = [
  "ACR122U",
  "ACR1252U",
  "ACR1281U",
  "PN532",
  "OMNIKEY_5022",
  "OMNIKEY_5427",
  "GENERIC_PCSC",
  "SERIAL_125KHZ",
  "OTHER",
];

export const ENCODER_CONNECTION_OPTIONS: EncoderConnectionType[] = ["USB", "SERIAL", "NETWORK", "BLUETOOTH"];

export function formatEnum(value: string) {
  return value.replace(/_/g, " ");
}
