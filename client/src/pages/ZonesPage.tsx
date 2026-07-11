import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import type { AccessZone, Card, PaginatedResponse } from "@/types";

export default function ZonesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [grantZone, setGrantZone] = useState<AccessZone | null>(null);
  const [grantUid, setGrantUid] = useState("");

  const { data: zones, isLoading } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await api.get<AccessZone[]>("/zones")).data,
  });

  const createZone = useMutation({
    mutationFn: async () => (await api.post("/zones", { name, description: description || undefined })).data,
    onSuccess: () => {
      toast.success("Access zone created");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      setModalOpen(false);
      setName("");
      setDescription("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create zone")),
  });

  const deleteZone = useMutation({
    mutationFn: async (id: string) => api.delete(`/zones/${id}`),
    onSuccess: () => {
      toast.success("Access zone deleted");
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const grantAccess = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<PaginatedResponse<Card>>("/cards", { params: { search: grantUid, pageSize: 1 } });
      const card = data.data.find((c) => c.uid.toLowerCase() === grantUid.trim().toLowerCase());
      if (!card) throw new Error("No card found with that UID");
      await api.post(`/zones/${grantZone!.id}/grant`, { cardIds: [card.id] });
    },
    onSuccess: () => {
      toast.success(`Access granted to ${grantZone?.name}`);
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      setGrantUid("");
      setGrantZone(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : apiErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createZone.mutate();
  }

  function handleGrantSubmit(e: FormEvent) {
    e.preventDefault();
    grantAccess.mutate();
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Access Zones"
        description="Group cards by the physical areas or systems they unlock."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
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
              <button className="text-slate-400 hover:text-red-600" onClick={() => deleteZone.mutate(zone.id)}>
                <Trash2 size={15} />
              </button>
            </div>
            <h3 className="font-semibold">{zone.name}</h3>
            {zone.description && <p className="mt-1 text-sm text-slate-500">{zone.description}</p>}
            <p className="mt-2 text-xs text-slate-400">{zone._count?.cards ?? 0} cards with access</p>
            <button className="btn-secondary mt-3 w-full" onClick={() => setGrantZone(zone)}>
              Grant access to a card
            </button>
          </div>
        ))}
        {zones?.length === 0 && <p className="text-sm text-slate-400">No access zones yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New access zone">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={createZone.isPending}>
            Create zone
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(grantZone)} onClose={() => setGrantZone(null)} title={`Grant access to ${grantZone?.name ?? ""}`}>
        <form onSubmit={handleGrantSubmit} className="space-y-4">
          <div>
            <label className="label">Card UID</label>
            <input className="input font-mono" required placeholder="04A1B2C3D4" value={grantUid} onChange={(e) => setGrantUid(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={grantAccess.isPending}>
            Grant access
          </button>
        </form>
      </Modal>
    </div>
  );
}
