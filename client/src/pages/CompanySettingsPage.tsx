import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { INDUSTRY_OPTIONS, MODULE_OPTIONS } from "@/lib/constants";
import type { Company } from "@/types";

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: company, isLoading } = useQuery({
    queryKey: ["company", user?.companyId],
    queryFn: async () => (await api.get<Company>(`/companies/${user!.companyId}`)).data,
    enabled: Boolean(user?.companyId),
  });

  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "", address: "", logoUrl: "" });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name,
        contactEmail: company.contactEmail ?? "",
        contactPhone: company.contactPhone ?? "",
        address: company.address ?? "",
        logoUrl: company.logoUrl ?? "",
      });
    }
  }, [company]);

  const updateCompany = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/companies/${user!.companyId}`, {
          name: form.name,
          contactEmail: form.contactEmail || undefined,
          contactPhone: form.contactPhone || undefined,
          address: form.address || undefined,
          logoUrl: form.logoUrl || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Company settings saved");
      queryClient.invalidateQueries({ queryKey: ["company", user?.companyId] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save company settings")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateCompany.mutate();
  }

  if (isLoading || !company) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader title="Company Settings" description={`Update details for ${company.name}.`} />

      <div className="card mb-5 max-w-xl p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Industry & modules</h3>
        <p className="mb-3 text-xs text-slate-400">
          {INDUSTRY_OPTIONS.find((o) => o.value === (company.industry ?? ""))?.label ?? "General"} — only a SUPER_ADMIN can
          change these.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(!company.enabledModules || company.enabledModules.length === 0
            ? MODULE_OPTIONS
            : MODULE_OPTIONS.filter((opt) => company.enabledModules!.includes(opt.value))
          ).map((opt) => (
            <Badge key={opt.value} tone="ACTIVE">
              {opt.label}
            </Badge>
          ))}
        </div>
      </div>

      <div className="card max-w-xl p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Company name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Contact email</label>
            <input
              type="email"
              className="input"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Contact phone</label>
            <input className="input" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <div>
            <label className="label">Logo URL</label>
            <input className="input" value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary" disabled={updateCompany.isPending}>
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
