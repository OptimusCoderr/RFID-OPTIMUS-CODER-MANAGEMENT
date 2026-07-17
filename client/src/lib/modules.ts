import type { CompanyModule, User } from "@/types";

// A user with no company (SUPER_ADMIN) or a company with no enabledModules
// set (unrestricted — every pre-existing company, or one created without
// picking an industry) can see every module. Only once a company has an
// explicit, non-empty enabledModules list does gating actually apply.
export function hasModule(user: User | null, module: CompanyModule): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  const enabledModules = user.company?.enabledModules;
  if (!enabledModules || enabledModules.length === 0) return true;
  return enabledModules.includes(module);
}
