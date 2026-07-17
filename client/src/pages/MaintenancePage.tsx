import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Wrench, CheckCircle2, PlayCircle, RotateCcw } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import type { Card, MaintenanceRecord, MaintenanceStatus, PaginatedResponse } from "@/types";

const STATUS_TONE: Record<MaintenanceStatus, string> = {
  OPEN: "PENDING",
  IN_PROGRESS: "BUSY",
  RESOLVED: "SUCCESS",
};

export default function MaintenancePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cardSearch, setCardSearch] = useState("");
  const [debouncedCardSearch, setDebouncedCardSearch] = useState("");
  const [cardId, setCardId] = useState("");
  const [description, setDescription] = useState("");
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | "">("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedCardSearch(cardSearch), 250);
    return () => clearTimeout(timeout);
  }, [cardSearch]);

  const { data: cardOptions } = useQuery({
    queryKey: ["cards", "maintenance-picker", debouncedCardSearch],
    queryFn: async () =>
      (await api.get<PaginatedResponse<Card>>("/cards", { params: { search: debouncedCardSearch || undefined, pageSize: 25 } })).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["maintenance", { statusFilter }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<MaintenanceRecord>>("/maintenance", {
          params: { status: statusFilter || undefined, pageSize: 100 },
        })
      ).data,
  });

  const openTicket = useMutation({
    mutationFn: async () => {
      const companyId = user?.role === "SUPER_ADMIN" ? cardOptions?.data.find((c) => c.id === cardId)?.companyId : undefined;
      return (await api.post<MaintenanceRecord>("/maintenance", { cardId, description, companyId })).data;
    },
    onSuccess: () => {
      toast.success("Maintenance ticket opened");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      setCardId("");
      setDescription("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not open ticket")),
  });

  const updateTicket = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: MaintenanceStatus }) =>
      (await api.patch<MaintenanceRecord>(`/maintenance/${id}`, { status })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update ticket")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cardId) {
      toast.error("Pick an item first");
      return;
    }
    openTicket.mutate();
  }

  const records = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Maintenance"
        description="Track service and repair tickets against an item's card — useful for Inventory asset tracking, or any equipment you've tagged."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Open a ticket</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Find item</label>
              <input
                className="input mb-2"
                placeholder="Search by UID or label..."
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
              />
              <select className="input" required value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">Select item...</option>
                {cardOptions?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label ?? c.uid}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">What's wrong?</label>
              <textarea
                className="input"
                rows={3}
                required
                placeholder="e.g. Won't power on, missing accessory..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={openTicket.isPending}>
              {openTicket.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Wrench size={16} />} Open ticket
            </button>
          </form>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Tickets</h3>
            <select
              className="input w-40"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as MaintenanceStatus | "")}
            >
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {isLoading ? (
            <FullPageSpinner />
          ) : (
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Issue</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 font-medium">{r.card?.label ?? r.card?.uid ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-500">{r.description}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-500">{format(new Date(r.openedAt), "MMM d, HH:mm")}</td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === "OPEN" && (
                            <button
                              className="btn-secondary"
                              title="Start progress"
                              onClick={() => updateTicket.mutate({ id: r.id, status: "IN_PROGRESS" })}
                              disabled={updateTicket.isPending}
                            >
                              <PlayCircle size={14} /> Start
                            </button>
                          )}
                          {r.status !== "RESOLVED" && (
                            <button
                              className="btn-secondary"
                              title="Mark resolved"
                              onClick={() => updateTicket.mutate({ id: r.id, status: "RESOLVED" })}
                              disabled={updateTicket.isPending}
                            >
                              <CheckCircle2 size={14} /> Resolve
                            </button>
                          )}
                          {r.status === "RESOLVED" && (
                            <button
                              className="btn-secondary"
                              title="Reopen"
                              onClick={() => updateTicket.mutate({ id: r.id, status: "OPEN" })}
                              disabled={updateTicket.isPending}
                            >
                              <RotateCcw size={14} /> Reopen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No maintenance tickets match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
