import { NATIONAL_ID_PRESET_FIELDS, PATIENT_ID_PRESET_FIELDS } from "@/lib/constants";
import type { CardType, CompanyIndustry, DesfireApplicationLayout, MifareSectorLayout, NtagPageLayout } from "@/types";

// Ready-made starting points for the "New card template" form, grouped by
// industry so a company can pick the closest match instead of building a
// sector/page layout from scratch. Applying one just pre-fills the same
// editable fields the form already has (name, card type, sectors/pages/
// applications, or an encrypted citizen record) — nothing about the
// resulting template is special or locked, it can be edited before creating
// and the created template can be edited or deleted like any other
// afterward.
//
// MIFARE Classic block numbers below are absolute across the card (see
// client/src/lib/mifare.ts) — sector 1's first data block is 4, not 0. Every
// preset here sticks to sector 1's three data blocks (4, 5, 6) and avoids
// block 7 (sector 1's trailer) and block 0 (the card-wide manufacturer
// block, inside sector 0) — both are enforced server-side too, but presets
// shouldn't need that enforcement to already be correct.
export interface CardTemplatePreset {
  id: string;
  industry: CompanyIndustry;
  name: string;
  description: string;
  cardType: CardType;
  sectors?: MifareSectorLayout[];
  pages?: NtagPageLayout[];
  applications?: DesfireApplicationLayout[];
  // When set, this preset writes an AES-256-GCM encrypted record (the same
  // mechanism as the National ID / Patient ID presets already in the
  // encrypted-record editor below) instead of plain readable blocks — only
  // offered when the company has the "National ID / citizen data" module
  // enabled, since that's what makes it usable afterward in Live Encode.
  citizenFields?: string[];
}

export const INDUSTRY_PRESET_LABELS: Record<CompanyIndustry, string> = {
  UNIVERSITY: "University / School",
  HOTEL: "Hotel",
  BUSINESS: "Business / Office",
  GOVERNMENT_ID: "e-Government — National ID",
  INVENTORY: "Inventory / Asset tracking",
  HEALTHCARE: "e-Healthcare",
};

const SECTOR_1_TRAILER_SAFE_KEY_A = "FFFFFFFFFFFF";

export const TEMPLATE_PRESETS: CardTemplatePreset[] = [
  // University / School
  {
    id: "university-student-id",
    industry: "UNIVERSITY",
    name: "Student ID",
    description: "Campus ID for a student — building access, attendance, and library lookups. Plain, human-readable fields.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Student ID Number" },
          { block: 5, purpose: "Full Name" },
          { block: 6, purpose: "Department / Major" },
        ],
      },
    ],
  },
  {
    id: "university-student-id-encrypted",
    industry: "UNIVERSITY",
    name: "Student ID (Encrypted)",
    description: "Same fields as Student ID, but combined and AES-256-GCM encrypted server-side before writing — the card only ever holds ciphertext.",
    cardType: "MIFARE_CLASSIC_1K",
    citizenFields: ["Full Name", "Student ID Number", "Department / Major"],
  },
  {
    id: "university-staff-id",
    industry: "UNIVERSITY",
    name: "Staff / Faculty ID",
    description: "ID badge for teaching staff and administrators.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Staff ID Number" },
          { block: 5, purpose: "Full Name" },
          { block: 6, purpose: "Department" },
        ],
      },
    ],
  },
  {
    id: "university-library-card",
    industry: "UNIVERSITY",
    name: "Library Card",
    description: "Lightweight tag for library checkout and lookups.",
    cardType: "NTAG213",
    pages: [
      { startPage: 4, endPage: 4, purpose: "Library Card Number" },
      { startPage: 5, endPage: 5, purpose: "Full Name" },
    ],
  },

  // Inventory / Asset tracking
  {
    id: "inventory-asset-tag",
    industry: "INVENTORY",
    name: "Asset Tag",
    description: "Tag a piece of equipment or stock item for lookup and maintenance tracking.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Asset ID" },
          { block: 5, purpose: "Category" },
          { block: 6, purpose: "Location" },
        ],
      },
    ],
  },
  {
    id: "inventory-checkout-tag",
    industry: "INVENTORY",
    name: "Equipment Check-out Tag",
    description: "For gear that's loaned out and returned — who currently has it.",
    cardType: "NTAG213",
    pages: [
      { startPage: 4, endPage: 4, purpose: "Asset ID" },
      { startPage: 5, endPage: 5, purpose: "Checked Out To" },
    ],
  },

  // Business / Office
  {
    id: "business-employee-badge",
    industry: "BUSINESS",
    name: "Employee Badge",
    description: "Standard office access badge.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Employee ID" },
          { block: 5, purpose: "Full Name" },
          { block: 6, purpose: "Department" },
        ],
      },
    ],
  },
  {
    id: "business-employee-badge-encrypted",
    industry: "BUSINESS",
    name: "Employee Badge (Encrypted)",
    description: "Same fields as Employee Badge, but combined and AES-256-GCM encrypted server-side before writing.",
    cardType: "MIFARE_CLASSIC_1K",
    citizenFields: ["Full Name", "Employee ID", "Department"],
  },
  {
    id: "business-visitor-badge",
    industry: "BUSINESS",
    name: "Visitor Badge",
    description: "Short-lived badge for a guest signing in at the front desk.",
    cardType: "NTAG213",
    pages: [
      { startPage: 4, endPage: 4, purpose: "Visitor Name" },
      { startPage: 5, endPage: 5, purpose: "Host / Purpose" },
    ],
  },
  {
    id: "business-desfire-ev1",
    industry: "BUSINESS",
    name: "Secure Access Card (DESFire EV1)",
    description:
      "Multi-application card with AES mutual authentication — stronger security than MIFARE Classic, usable for any industry (access control, cafeteria wallet, etc). File contents travel in DESFire's Plain communication mode after authentication, since this platform doesn't implement DESFire's Enciphered comm mode — for data that also needs encryption at rest and on the wire, use one of the \"(Encrypted)\" MIFARE Classic presets instead.",
    cardType: "MIFARE_DESFIRE_EV1",
    applications: [
      {
        aid: "F00001",
        name: "Access Control",
        keyCount: 1,
        keyType: "AES",
        files: [
          { fileId: 0, type: "STANDARD_DATA", purpose: "Holder ID", size: 32 },
          { fileId: 1, type: "STANDARD_DATA", purpose: "Full Name", size: 32 },
        ],
      },
    ],
  },
  {
    id: "business-desfire-ev2",
    industry: "BUSINESS",
    name: "Secure Access Card (DESFire EV2)",
    description:
      "Same layout as the EV1 preset, for cards using DESFire EV2 hardware. File contents travel in Plain communication mode after AES authentication — see the EV1 preset's note for why, and use an \"(Encrypted)\" MIFARE Classic preset instead where at-rest/on-wire encryption matters.",
    cardType: "MIFARE_DESFIRE_EV2",
    applications: [
      {
        aid: "F00001",
        name: "Access Control",
        keyCount: 1,
        keyType: "AES",
        files: [
          { fileId: 0, type: "STANDARD_DATA", purpose: "Holder ID", size: 32 },
          { fileId: 1, type: "STANDARD_DATA", purpose: "Full Name", size: 32 },
        ],
      },
    ],
  },
  {
    id: "business-desfire-ev3",
    industry: "BUSINESS",
    name: "Secure Access Card (DESFire EV3)",
    description:
      "Same layout as the EV1 preset, for cards using DESFire EV3 hardware. File contents travel in Plain communication mode after AES authentication — see the EV1 preset's note for why, and use an \"(Encrypted)\" MIFARE Classic preset instead where at-rest/on-wire encryption matters.",
    cardType: "MIFARE_DESFIRE_EV3",
    applications: [
      {
        aid: "F00001",
        name: "Access Control",
        keyCount: 1,
        keyType: "AES",
        files: [
          { fileId: 0, type: "STANDARD_DATA", purpose: "Holder ID", size: 32 },
          { fileId: 1, type: "STANDARD_DATA", purpose: "Full Name", size: 32 },
        ],
      },
    ],
  },

  // Hotel
  {
    id: "hotel-room-key",
    industry: "HOTEL",
    name: "Room Key Card",
    description: "Guest room key — pair with a time-limited encoder allocation for auto-expiry at checkout.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Room Number" },
          { block: 5, purpose: "Guest Name" },
        ],
      },
    ],
  },
  {
    id: "hotel-staff-master-key",
    industry: "HOTEL",
    name: "Staff Master Key",
    description: "Housekeeping / maintenance staff key with broader access.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Staff ID" },
          { block: 5, purpose: "Access Level" },
        ],
      },
    ],
  },

  // e-Government — National ID
  {
    id: "government-worker-id",
    industry: "GOVERNMENT_ID",
    name: "Government Worker ID",
    description: "Plain-field agency ID badge for staff, not citizens. For a citizen-facing National ID, use the encrypted preset below.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Employee/Agency ID" },
          { block: 5, purpose: "Full Name" },
          { block: 6, purpose: "Agency / Department" },
        ],
      },
    ],
  },
  {
    id: "government-national-id-encrypted",
    industry: "GOVERNMENT_ID",
    name: "National ID Card (Encrypted)",
    description: "Citizen-facing National ID — the standard identity field set, combined and AES-256-GCM encrypted server-side before writing.",
    cardType: "MIFARE_CLASSIC_1K",
    citizenFields: NATIONAL_ID_PRESET_FIELDS,
  },

  // e-Healthcare
  {
    id: "healthcare-staff-badge",
    industry: "HEALTHCARE",
    name: "Hospital Staff Badge",
    description: "Plain-field staff badge for clinical/non-clinical staff. For a patient ID with encrypted medical fields, use the encrypted preset below.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: SECTOR_1_TRAILER_SAFE_KEY_A,
        blocks: [
          { block: 4, purpose: "Staff ID" },
          { block: 5, purpose: "Full Name" },
          { block: 6, purpose: "Role / Ward" },
        ],
      },
    ],
  },
  {
    id: "healthcare-visitor-pass",
    industry: "HEALTHCARE",
    name: "Hospital Visitor Pass",
    description: "Short-lived pass for a hospital visitor.",
    cardType: "NTAG213",
    pages: [
      { startPage: 4, endPage: 4, purpose: "Visitor Name" },
      { startPage: 5, endPage: 5, purpose: "Patient / Ward Visiting" },
    ],
  },
  {
    id: "healthcare-patient-id-encrypted",
    industry: "HEALTHCARE",
    name: "Patient ID Card (Encrypted)",
    description: "Identity/lookup card for a patient — combined and AES-256-GCM encrypted server-side before writing. Not a full medical chart; keep clinical detail in a real EHR system.",
    cardType: "MIFARE_CLASSIC_1K",
    citizenFields: PATIENT_ID_PRESET_FIELDS,
  },
];
