import type { CardStatus, CardType, CompanyIndustry, CompanyModule, EncoderConnectionType, EncoderType } from "@/types";

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

export const INDUSTRY_OPTIONS: { value: CompanyIndustry | ""; label: string }[] = [
  { value: "", label: "General (all features)" },
  { value: "UNIVERSITY", label: "University / School" },
  { value: "HOTEL", label: "Hotel" },
  { value: "BUSINESS", label: "Business / Office" },
  { value: "GOVERNMENT_ID", label: "e-Government — National ID" },
];

export const MODULE_OPTIONS: { value: CompanyModule; label: string }[] = [
  { value: "CARDS", label: "Cards" },
  { value: "ENCODERS", label: "Encoders + Live Encode" },
  { value: "TEMPLATES", label: "Templates" },
  { value: "HOLDERS", label: "Card Holders" },
  { value: "ZONES", label: "Access Zones" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "LOGS", label: "Audit Logs" },
  { value: "CITIZEN_DATA", label: "National ID / citizen data" },
];

export function formatEnum(value: string) {
  return value.replace(/_/g, " ");
}
