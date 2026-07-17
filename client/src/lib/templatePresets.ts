import type { CardType, CompanyIndustry, MifareSectorLayout, NtagPageLayout } from "@/types";

// Ready-made starting points for the "New card template" form, grouped by
// industry so a company can pick the closest match instead of building a
// sector/page layout from scratch. Applying one just pre-fills the same
// editable fields the form already has (name, card type, sectors/pages) —
// nothing about the resulting template is special or locked, it can be
// edited before creating and the created template can be edited or deleted
// like any other afterward.
export interface CardTemplatePreset {
  id: string;
  industry: CompanyIndustry;
  name: string;
  description: string;
  cardType: CardType;
  sectors?: MifareSectorLayout[];
  pages?: NtagPageLayout[];
}

export const INDUSTRY_PRESET_LABELS: Record<CompanyIndustry, string> = {
  UNIVERSITY: "University / School",
  HOTEL: "Hotel",
  BUSINESS: "Business / Office",
  GOVERNMENT_ID: "e-Government — National ID",
  INVENTORY: "Inventory / Asset tracking",
  HEALTHCARE: "e-Healthcare",
};

export const TEMPLATE_PRESETS: CardTemplatePreset[] = [
  // University / School
  {
    id: "university-student-id",
    industry: "UNIVERSITY",
    name: "Student ID",
    description: "Campus ID for a student — building access, attendance, and library lookups.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Student ID Number" },
          { block: 1, purpose: "Full Name" },
          { block: 2, purpose: "Department / Major" },
        ],
      },
    ],
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
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Staff ID Number" },
          { block: 1, purpose: "Full Name" },
          { block: 2, purpose: "Department" },
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
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Asset ID" },
          { block: 1, purpose: "Category" },
          { block: 2, purpose: "Location" },
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
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Employee ID" },
          { block: 1, purpose: "Full Name" },
          { block: 2, purpose: "Department" },
        ],
      },
    ],
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
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Room Number" },
          { block: 1, purpose: "Guest Name" },
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
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Staff ID" },
          { block: 1, purpose: "Access Level" },
        ],
      },
    ],
  },

  // e-Government — National ID
  {
    id: "government-worker-id",
    industry: "GOVERNMENT_ID",
    name: "Government Worker ID",
    description: "Plain-field agency ID badge. For a citizen-facing National ID with encrypted personal data, use the citizen-record preset below instead.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Employee/Agency ID" },
          { block: 1, purpose: "Full Name" },
          { block: 2, purpose: "Agency / Department" },
        ],
      },
    ],
  },

  // e-Healthcare
  {
    id: "healthcare-staff-badge",
    industry: "HEALTHCARE",
    name: "Hospital Staff Badge",
    description: "Plain-field staff badge for clinical/non-clinical staff. For a patient ID with encrypted medical fields, use the citizen-record preset below instead.",
    cardType: "MIFARE_CLASSIC_1K",
    sectors: [
      {
        sector: 1,
        keyA: "FFFFFFFFFFFF",
        blocks: [
          { block: 0, purpose: "Staff ID" },
          { block: 1, purpose: "Full Name" },
          { block: 2, purpose: "Role / Ward" },
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
];
