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
  UNIVERSITY: [...CORE_MODULES],
  HOTEL: [...CORE_MODULES],
  BUSINESS: [...CORE_MODULES],
  GOVERNMENT_ID: [...CORE_MODULES, "CITIZEN_DATA"],
};
