import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Trash2, CreditCard } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import type { CardHolder } from "@/types";

interface HolderFormState {
  fullName: string;
  email: string;
  phone: string;
  employeeId: string;
  department: string;
}

const EMPTY_FORM: HolderFormState = { fullName: "", email: "", phone: "", employeeId: "", department: "" };

export default function HoldersPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<HolderFormState>(EMPTY_FORM);

  const { data: holders, isLoading } = useQuery({
    queryKey: ["holders"],
    queryFn: async () => (await api.get<CardHolder[]>("/holders")).data,
  });

  const createHolder = useMutation({
    mutationFn: async (payload: HolderFormState) =>
      (
        await api.post("/holders", {
          ...payload,
          email: payload.email || undefined,
          phone: payload.phone || undefined,
          employeeId: payload.employeeId || undefined,
          department: payload.department || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Card holder added");
      queryClient.invalidateQueries({ queryKey: ["holders"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create card holder")),
  });

  const deleteHolder = useMutation({
    mutationFn: async (id: string) => api.delete(`/holders/${id}`),
    onSuccess: () => {
      toast.success("Card holder removed");
      queryClient.invalidateQueries({ queryKey: ["holders"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createHolder.mutate(form);
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Card Holders"
        description="The people or assets your RFID/NFC cards get assigned to."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New holder
          </button>
        }
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Cards</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {holders?.map((h) => (
              <tr key={h.id}>
                <td className="px-4 py-3 font-medium">
                  <Link to={`/holders/${h.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                    {h.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{h.employeeId ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{h.department ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{h.email ?? h.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <CreditCard size={14} /> {h._count?.cards ?? 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => {
                      if (confirm(`Remove ${h.fullName}?`)) deleteHolder.mutate(h.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New card holder">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div>
            <label className="label">Employee ID</label>
            <input className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
          </div>
          <div>
            <label className="label">Department</label>
            <input className="input" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={createHolder.isPending}>
            Add card holder
          </button>
        </form>
      </Modal>
    </div>
  );
}
