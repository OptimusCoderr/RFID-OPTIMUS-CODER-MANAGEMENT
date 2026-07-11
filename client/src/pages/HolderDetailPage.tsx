import { FormEvent, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { formatEnum } from "@/lib/constants";
import type { CardHolder } from "@/types";

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: holder, isLoading } = useQuery({
    queryKey: ["holder", id],
    queryFn: async () => (await api.get<CardHolder>(`/holders/${id}`)).data,
    enabled: Boolean(id),
  });

  const [form, setForm] = useState({ fullName: "", email: "", phone: "", employeeId: "", department: "" });

  useEffect(() => {
    if (holder) {
      setForm({
        fullName: holder.fullName,
        email: holder.email ?? "",
        phone: holder.phone ?? "",
        employeeId: holder.employeeId ?? "",
        department: holder.department ?? "",
      });
    }
  }, [holder]);

  const updateHolder = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/holders/${id}`, {
          fullName: form.fullName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          employeeId: form.employeeId || undefined,
          department: form.department || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Card holder updated");
      queryClient.invalidateQueries({ queryKey: ["holder", id] });
      queryClient.invalidateQueries({ queryKey: ["holders"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update card holder")),
  });

  const toggleActive = useMutation({
    mutationFn: async () => api.patch(`/holders/${id}`, { isActive: !holder?.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holder", id] });
      queryClient.invalidateQueries({ queryKey: ["holders"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteHolder = useMutation({
    mutationFn: async () => api.delete(`/holders/${id}`),
    onSuccess: () => {
      toast.success("Card holder removed");
      queryClient.invalidateQueries({ queryKey: ["holders"] });
      navigate("/holders");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove card holder")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateHolder.mutate();
  }

  if (isLoading || !holder) return <FullPageSpinner />;

  return (
    <div>
      <Link to="/holders" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft size={15} /> Back to card holders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{holder.fullName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {holder.department ?? "No department"} {holder.employeeId && `· ${holder.employeeId}`}
          </p>
        </div>
        <Badge tone={holder.isActive ? "ACTIVE" : "BLOCKED"}>{holder.isActive ? "Active" : "Inactive"}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-slate-600 dark:text-slate-300">Details</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input className="input" required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Employee ID</label>
                <input className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
              </div>
              <div>
                <label className="label">Department</label>
                <input className="input" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={updateHolder.isPending}>
                Save changes
              </button>
              <button type="button" className="btn-secondary" onClick={() => toggleActive.mutate()}>
                {holder.isActive ? "Deactivate" : "Reactivate"}
              </button>
              <button
                type="button"
                className="btn-danger ml-auto"
                onClick={() => {
                  if (confirm(`Remove ${holder.fullName}? This cannot be undone.`)) deleteHolder.mutate();
                }}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </form>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Assigned cards</h3>
          <div className="space-y-2">
            {holder.cards?.map((card) => (
              <Link
                key={card.id}
                to={`/cards/${card.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <CreditCard size={15} className="text-slate-400" />
                  <div>
                    <div className="font-mono">{card.uid}</div>
                    <div className="text-xs text-slate-400">{formatEnum(card.cardType)}</div>
                  </div>
                </div>
                <Badge tone={card.status}>{formatEnum(card.status)}</Badge>
              </Link>
            ))}
            {(!holder.cards || holder.cards.length === 0) && <p className="text-sm text-slate-400">No cards assigned yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
