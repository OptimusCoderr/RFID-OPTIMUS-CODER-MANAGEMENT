export interface CompanyGroup<T> {
  companyId: string | null;
  companyName: string;
  items: T[];
}

// Buckets a list already sorted by company name (every list endpoint sorts
// this way server-side for a SUPER_ADMIN viewing across every company —
// see e.g. userController.ts's listUsers) into one group per company, in
// that same order — a Map preserves insertion order, so no re-sort needed
// here. A null/missing companyId (a SUPER_ADMIN user, for instance) lands
// in its own "No company" group rather than being dropped.
export function groupByCompany<T extends { companyId?: string | null; company?: { id: string; name: string } | null }>(
  items: T[]
): CompanyGroup<T>[] {
  const groups = new Map<string, CompanyGroup<T>>();
  for (const item of items) {
    const key = item.companyId ?? "none";
    if (!groups.has(key)) {
      groups.set(key, { companyId: item.companyId ?? null, companyName: item.company?.name ?? "No company", items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  return Array.from(groups.values());
}
