import { CompanyIndustry, CompanyModule } from "@prisma/client";

// Every industry starts with the full core feature set — nothing about the
// existing app maps cleanly to "exclude this for hotels," so gating only
// bites where it's actually meaningful today: CITIZEN_DATA (National ID
// style records), which is e-Government-specific rather than universal.
const CORE_MODULES: CompanyModule[] = [
  "CARDS",
  "ENCODERS",
  "TEMPLATES",
  "HOLDERS",
  "ZONES",
  "ATTENDANCE",
  "LOGS",
];

export const INDUSTRY_DEFAULT_MODULES: Record<CompanyIndustry, CompanyModule[]> = {
  // Visitors: temporary, auto-expiring passes for people who aren't full
  // card holders (campus/office/hotel/hospital guests, front-desk sign-ins).
  UNIVERSITY: [...CORE_MODULES, "VISITORS"],
  HOTEL: [...CORE_MODULES, "VISITORS"],
  BUSINESS: [...CORE_MODULES, "VISITORS", "MAINTENANCE"],
  GOVERNMENT_ID: [...CORE_MODULES, "CITIZEN_DATA", "VISITORS"],
  // Asset tracking reuses the same Cards/Holders/Attendance/Zones model:
  // a tag on an item, the "holder" as the person/department currently
  // responsible for it, and Attendance's check-in/check-out as the
  // borrow/return record. See HOW-TO-USE.md §7.5 for the worked mapping.
  // Maintenance tracks service/repair tickets against those same item
  // cards.
  INVENTORY: [...CORE_MODULES, "MAINTENANCE"],
  // Patient records use the same encrypted citizen-record mechanism as
  // Government ID (CITIZEN_DATA), via the "Load Patient ID preset" field
  // set — see HOW-TO-USE.md §7.6. Visitors covers hospital visitor passes.
  HEALTHCARE: [...CORE_MODULES, "CITIZEN_DATA", "VISITORS"],
};
