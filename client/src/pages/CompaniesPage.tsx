import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Building2, Settings } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { INDUSTRY_OPTIONS, MODULE_OPTIONS } from "@/lib/constants";
import type { Company, CompanyIndustry, CompanyModule } from "@/types";

interface CompanyFormState {
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  industry: CompanyIndustry | "";
}

const EMPTY_FORM: CompanyFormState = { name: "", slug: "", contactEmail: "", contactPhone: "", address: "", industry: "" };

function industryLabel(industry?: CompanyIndustry | null): string {
  return INDUSTRY_OPTIONS.find((o) => o.value === (industry ?? ""))?.label ?? "General";
}

export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM);
  const [moduleEditCompany, setModuleEditCompany] = useState<Company | null>(null);

  const { data: companies, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/companies")).data,
  });

  const createCompany = useMutation({
    mutationFn: async (payload: CompanyFormState) =>
      (
        await api.post("/companies", {
          ...payload,
          contactEmail: payload.contactEmail || undefined,
          contactPhone: payload.contactPhone || undefined,
          address: payload.address || undefined,
          industry: payload.industry || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Company created");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create company")),
  });

  function handleNameChange(name: string) {
    setForm((f) => ({
      ...f,
      name,
      slug: f.slug === slugify(f.name) || f.slug === "" ? slugify(name) : f.slug,
    }));
  }

  function slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createCompany.mutate(form);
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every tenant is fully isolated — their users, cards, encoders, and holders never mix."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New company
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companies?.map((company) => (
          <div key={company.id} className="card p-5">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                <Building2 size={18} />
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={company.isActive ? "ACTIVE" : "BLOCKED"}>{company.isActive ? "Active" : "Inactive"}</Badge>
                <button
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  title="Manage industry & modules"
                  onClick={() => setModuleEditCompany(company)}
                >
                  <Settings size={15} />
                </button>
              </div>
            </div>
            <h3 className="font-semibold">{company.name}</h3>
            <p className="text-xs text-slate-400">{company.slug}</p>
            <p className="mt-1 text-xs text-slate-400">{industryLabel(company.industry)}</p>
            {company.contactEmail && <p className="mt-2 text-sm text-slate-500">{company.contactEmail}</p>}
            <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs text-slate-500">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{company._count?.cards ?? 0}</div>
                Cards
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{company._count?.encoders ?? 0}</div>
                Encoders
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{company._count?.holders ?? 0}</div>
                Holders
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{company._count?.users ?? 0}</div>
                Users
              </div>
            </div>
          </div>
        ))}
        {companies?.length === 0 && <p className="text-sm text-slate-400">No companies yet — create the first one.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New company">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Company name</label>
            <input className="input" required value={form.name} onChange={(e) => handleNameChange(e.target.value)} />
          </div>
          <div>
            <label className="label">Slug</label>
            <input
              className="input"
              required
              pattern="[a-z0-9-]+"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            />
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
            <input
              className="input"
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <div>
            <label className="label">Industry</label>
            <select
              className="input"
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value as CompanyIndustry | "" }))}
            >
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Sets the starting module set — adjustable per company afterward.</p>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={createCompany.isPending}>
            Create company
          </button>
        </form>
      </Modal>

      <ModuleEditModal company={moduleEditCompany} onClose={() => setModuleEditCompany(null)} />
    </div>
  );
}

// Industry presets a company could start with — used here purely as a
// one-click convenience to fill the checkboxes below; the checkboxes
// themselves are the source of truth that actually gets saved.
const INDUSTRY_DEFAULT_MODULES: Record<CompanyIndustry, CompanyModule[]> = {
  UNIVERSITY: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"],
  HOTEL: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"],
  BUSINESS: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"],
  GOVERNMENT_ID: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS", "CITIZEN_DATA"],
  INVENTORY: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"],
  HEALTHCARE: ["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS", "CITIZEN_DATA"],
};

function ModuleEditModal({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [industry, setIndustry] = useState<CompanyIndustry | "">("");
  const [modules, setModules] = useState<CompanyModule[]>([]);

  useEffect(() => {
    if (company) {
      setIndustry(company.industry ?? "");
      setModules(company.enabledModules ?? []);
    }
  }, [company]);

  const save = useMutation({
    mutationFn: async () => {
      if (!company) return;
      // Explicit modules list — including an empty array, which means
      // "unrestricted" (see Company.enabledModules) — always wins over
      // whatever the industry's own defaults would be.
      return (await api.patch(`/companies/${company.id}`, { industry: industry || null, enabledModules: modules })).data;
    },
    onSuccess: () => {
      toast.success("Modules updated");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update modules")),
  });

  function toggleModule(module: CompanyModule) {
    setModules((prev) => (prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]));
  }

  if (!company) return null;

  return (
    <Modal open onClose={onClose} title={`Modules — ${company.name}`}>
      <div className="space-y-4">
        <div>
          <label className="label">Industry</label>
          <select
            className="input"
            value={industry}
            onChange={(e) => {
              const value = e.target.value as CompanyIndustry | "";
              setIndustry(value);
              setModules(value ? INDUSTRY_DEFAULT_MODULES[value] : []);
            }}
          >
            {INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">Picking an industry fills in its defaults below — adjust freely after.</p>
        </div>
        <div>
          <label className="label">Enabled modules</label>
          <div className="grid grid-cols-2 gap-2">
            {MODULE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modules.includes(opt.value)} onChange={() => toggleModule(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
          {modules.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">No modules checked — this company is unrestricted (every module visible).</p>
          )}
        </div>
        <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          Save modules
        </button>
      </div>
    </Modal>
  );
}
