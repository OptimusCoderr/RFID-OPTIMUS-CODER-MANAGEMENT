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
  { value: "INVENTORY", label: "Inventory / Asset tracking" },
  { value: "HEALTHCARE", label: "e-Healthcare" },
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
  { value: "VISITORS", label: "Visitors" },
  { value: "MAINTENANCE", label: "Maintenance" },
];

export function formatEnum(value: string) {
  return value.replace(/_/g, " ");
}

// A starting field list for an e-Government National ID card's encrypted
// citizen record (see CitizenRecordLayout) — covers the core identity
// fields plus the voter/driver/government-worker eligibility flags a
// national ID scheme typically needs. Deliberately excludes fingerprint
// data: this platform talks to RFID/NFC PC/SC encoders, not fingerprint
// scanners, so there's no hardware path to capture or verify a print. Fill
// that in yourself only once you've integrated dedicated biometric
// hardware — don't fake it with a placeholder value.
export const NATIONAL_ID_PRESET_FIELDS = [
  "Full name",
  "National Identity Number (NIN)",
  "Date of birth",
  "State of origin",
  "Licensed to vote",
  "Licensed to drive",
  "Government worker ID",
];

// A starting field list for an e-Healthcare patient ID card's encrypted
// citizen record. This is an identity/lookup card, not an on-card medical
// chart: it holds enough to identify the patient and handle an emergency
// (blood type, known allergies) fast and offline, while the actual clinical
// record stays in a real EHR system this platform doesn't touch — don't
// grow this preset into a full medical history on a physical card that can
// be lost or stolen.
export const PATIENT_ID_PRESET_FIELDS = [
  "Full name",
  "Patient ID",
  "Date of birth",
  "Blood type",
  "Known allergies",
  "Emergency contact",
];
