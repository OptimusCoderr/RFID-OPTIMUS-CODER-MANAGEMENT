import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Building2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import type { Company } from "@/types";

interface CompanyFormState {
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

const EMPTY_FORM: CompanyFormState = { name: "", slug: "", contactEmail: "", contactPhone: "", address: "" };

export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM);

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
              <Badge tone={company.isActive ? "ACTIVE" : "BLOCKED"}>{company.isActive ? "Active" : "Inactive"}</Badge>
            </div>
            <h3 className="font-semibold">{company.name}</h3>
            <p className="text-xs text-slate-400">{company.slug}</p>
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
          <button type="submit" className="btn-primary w-full" disabled={createCompany.isPending}>
            Create company
          </button>
        </form>
      </Modal>
    </div>
  );
}
