import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { format } from "date-fns";
import { Pencil, Plus, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import type { AccessZone, AttendanceRecord, Card, Company, Encoder, PaginatedResponse } from "@/types";

export default function ZonesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [manageZoneId, setManageZoneId] = useState<string | null>(null);
  const [grantUid, setGrantUid] = useState("");
  const [grantEncoderId, setGrantEncoderId] = useState("");

  const { data: zones, isLoading } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await api.get<AccessZone[]>("/zones")).data,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/companies")).data,
    enabled: user?.role === "SUPER_ADMIN",
  });

  const { data: manageZone, isLoading: manageLoading } = useQuery({
    queryKey: ["zones", manageZoneId],
    queryFn: async () => (await api.get<AccessZone>(`/zones/${manageZoneId}`)).data,
    enabled: Boolean(manageZoneId),
  });

  const { data: encoders } = useQuery({
    queryKey: ["encoders", manageZone?.companyId],
    queryFn: async () => (await api.get<Encoder[]>("/encoders", { params: { companyId: manageZone!.companyId } })).data,
    enabled: Boolean(manageZone),
  });

  // Which card was tapped at which of this zone's encoders, and when — like
  // a hotel door-lock's access log. Reuses Attendance's existing records
  // (CHECK_IN reads as "opened/entered", CHECK_OUT as "closed/exited")
  // rather than a separate log, since a zone tap already creates one.
  // Polled rather than pushed over the websocket — good enough for a
  // recent-activity glance, and avoids wiring up a second live feed.
  const { data: zoneActivity } = useQuery({
    queryKey: ["zone-attendance", manageZoneId],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<AttendanceRecord>>("/attendance", {
          params: { zoneId: manageZoneId, pageSize: 15 },
        })
      ).data.data,
    enabled: Boolean(manageZoneId),
    refetchInterval: manageZoneId ? 5000 : false,
  });

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setCompanyId("");
  }

  function openCreate() {
    resetForm();
    setModalOpen(true);
  }

  function openEdit(zone: AccessZone) {
    setEditingId(zone.id);
    setName(zone.name);
    setDescription(zone.description ?? "");
    setCompanyId(zone.companyId);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  const createZone = useMutation({
    mutationFn: async () =>
      (
        await api.post("/zones", {
          name,
          description: description || undefined,
          companyId: user?.role === "SUPER_ADMIN" ? companyId : undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Access zone created");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create zone")),
  });

  const updateZone = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/zones/${editingId}`, {
          name,
          description: description || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Access zone updated");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update zone")),
  });

  const deleteZone = useMutation({
    mutationFn: async (id: string) => api.delete(`/zones/${id}`),
    onSuccess: () => {
      toast.success("Access zone deleted");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const grantCardAccess = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<PaginatedResponse<Card>>("/cards", {
        params: { search: grantUid, pageSize: 1, companyId: manageZone!.companyId },
      });
      const card = data.data.find((c) => c.uid.toLowerCase() === grantUid.trim().toLowerCase());
      if (!card) throw new Error("No card found with that UID");
      await api.post(`/zones/${manageZoneId}/grant`, { cardIds: [card.id] });
    },
    onSuccess: () => {
      toast.success("Card access granted");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      setGrantUid("");
    },
    onError: (err) => toast.error(axios.isAxiosError(err) ? apiErrorMessage(err) : err instanceof Error ? err.message : "Something went wrong"),
  });

  const revokeCardAccess = useMutation({
    mutationFn: async (cardId: string) => api.post(`/zones/${manageZoneId}/revoke`, { cardIds: [cardId] }),
    onSuccess: () => {
      toast.success("Card access revoked");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const grantEncoderAccess = useMutation({
    mutationFn: async () => api.post(`/zones/${manageZoneId}/grant-encoders`, { encoderIds: [grantEncoderId] }),
    onSuccess: () => {
      toast.success("Encoder tied to zone");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      setGrantEncoderId("");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const revokeEncoderAccess = useMutation({
    mutationFn: async (encoderId: string) => api.post(`/zones/${manageZoneId}/revoke-encoders`, { encoderIds: [encoderId] }),
    onSuccess: () => {
      toast.success("Encoder untied from zone");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (editingId) {
      updateZone.mutate();
    } else {
      createZone.mutate();
    }
  }

  function handleGrantCardSubmit(e: FormEvent) {
    e.preventDefault();
    grantCardAccess.mutate();
  }

  function handleGrantEncoderSubmit(e: FormEvent) {
    e.preventDefault();
    if (!grantEncoderId) return;
    grantEncoderAccess.mutate();
  }

  const manageableEncoders = encoders?.filter(
    (e) => !manageZone?.encoders?.some((g) => g.encoder.id === e.id)
  ) ?? [];

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Access Zones"
        description="Group cards and encoders by the physical areas or systems they unlock."
        actions={
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={16} /> New zone
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {zones?.map((zone) => (
          <div key={zone.id} className="card p-5">
            <div className="mb-2 flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                <ShieldCheck size={18} />
              </div>
              <div className="flex items-center gap-2">
                <button className="text-slate-400 hover:text-blue-600" onClick={() => openEdit(zone)}>
                  <Pencil size={15} />
                </button>
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    if (confirm(`Permanently delete access zone "${zone.name}"? This cannot be undone.`)) deleteZone.mutate(zone.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <h3 className="font-semibold">{zone.name}</h3>
            {zone.description && <p className="mt-1 text-sm text-slate-500">{zone.description}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {zone._count?.cards ?? 0} card(s) &middot; {zone._count?.encoders ?? 0} encoder(s)
            </p>
            <button className="btn-secondary mt-3 w-full" onClick={() => setManageZoneId(zone.id)}>
              <Settings size={14} /> Manage access
            </button>
          </div>
        ))}
        {zones?.length === 0 && <p className="text-sm text-slate-400">No access zones yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editingId ? "Edit access zone" : "New access zone"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {user?.role === "SUPER_ADMIN" && (
            <div>
              <label className="label">Company</label>
              <select
                className="input"
                required
                disabled={!!editingId}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="" disabled>
                  Select a company
                </option>
                {companies?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {editingId && <p className="mt-1 text-xs text-slate-400">A zone's company can't be changed after creation.</p>}
            </div>
          )}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={editingId ? updateZone.isPending : createZone.isPending}
          >
            {editingId ? "Save changes" : "Create zone"}
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(manageZoneId)} onClose={() => setManageZoneId(null)} title={`Manage ${manageZone?.name ?? "zone"}`} wide>
        {manageLoading || !manageZone ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h4 className="mb-2 text-sm font-semibold">Cards with access</h4>
              <div className="space-y-1.5">
                {manageZone.cards?.map((g) => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <span>
                      <span className="font-mono">{g.card.uid}</span>
                      {g.card.label && <span className="text-slate-400"> &middot; {g.card.label}</span>}
                      {g.card.holder && <span className="text-slate-400"> &middot; {g.card.holder.fullName}</span>}
                    </span>
                    <button className="text-slate-400 hover:text-red-600" onClick={() => revokeCardAccess.mutate(g.card.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {(manageZone.cards?.length ?? 0) === 0 && <p className="text-xs text-slate-400">No cards have access yet.</p>}
              </div>
              <form onSubmit={handleGrantCardSubmit} className="mt-3 flex gap-2">
                <input
                  className="input flex-1 font-mono"
                  placeholder="Card UID, e.g. 04A1B2C3D4"
                  value={grantUid}
                  onChange={(e) => setGrantUid(e.target.value)}
                />
                <button type="submit" className="btn-secondary" disabled={!grantUid || grantCardAccess.isPending}>
                  <Plus size={14} /> Grant
                </button>
              </form>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Encoders tied to this zone</h4>
              <p className="mb-2 text-xs text-slate-400">
                Informational only — this records which physical reader(s) are installed in this zone. It doesn't
                restrict which cards an encoder accepts (see Restricting a card to specific encoders on a card's
                detail page for that).
              </p>
              <div className="space-y-1.5">
                {manageZone.encoders?.map((g) => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <span>
                      {g.encoder.name}
                      {g.encoder.location && <span className="text-slate-400"> &middot; {g.encoder.location}</span>}
                    </span>
                    <button className="text-slate-400 hover:text-red-600" onClick={() => revokeEncoderAccess.mutate(g.encoder.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {(manageZone.encoders?.length ?? 0) === 0 && <p className="text-xs text-slate-400">No encoders tied to this zone yet.</p>}
              </div>
              <form onSubmit={handleGrantEncoderSubmit} className="mt-3 flex gap-2">
                <select className="input flex-1" value={grantEncoderId} onChange={(e) => setGrantEncoderId(e.target.value)}>
                  <option value="">Select an encoder&hellip;</option>
                  {manageableEncoders.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.location ? ` (${e.location})` : ""}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-secondary" disabled={!grantEncoderId || grantEncoderAccess.isPending}>
                  <Plus size={14} /> Tie
                </button>
              </form>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Recent access activity</h4>
              <p className="mb-2 text-xs text-slate-400">
                Which card was used at which of this zone's encoders, and when — like a hotel door lock's access log.
                Check-in reads as opened/entered, check-out as closed/exited.
              </p>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {zoneActivity?.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <span className="flex items-center gap-2">
                      <Badge tone={r.type === "CHECK_IN" ? "ACTIVE" : undefined}>{r.type === "CHECK_IN" ? "Opened" : "Closed"}</Badge>
                      <span>
                        {r.holder?.fullName ?? r.card?.label ?? r.card?.uid ?? "Unknown card"}
                        {r.encoder && <span className="text-slate-400"> &middot; {r.encoder.name}</span>}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">{format(new Date(r.recordedAt), "MMM d, HH:mm:ss")}</span>
                  </div>
                ))}
                {zoneActivity?.length === 0 && <p className="text-xs text-slate-400">No access activity recorded for this zone yet.</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
