import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound, Trash2, Copy, Wifi } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { ENCODER_CONNECTION_OPTIONS, ENCODER_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Encoder, EncoderConnectionType, EncoderType } from "@/types";
import { formatDistanceToNow } from "date-fns";

interface EncoderFormState {
  name: string;
  type: EncoderType;
  connectionType: EncoderConnectionType;
  location: string;
  serialNumber: string;
}

const EMPTY_FORM: EncoderFormState = { name: "", type: "ACR122U", connectionType: "USB", location: "", serialNumber: "" };

export default function EncodersPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EncoderFormState>(EMPTY_FORM);
  const [revealedKey, setRevealedKey] = useState<{ name: string; agentKey: string } | null>(null);

  const { data: encoders, isLoading } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
    refetchInterval: 15_000,
  });

  const createEncoder = useMutation({
    mutationFn: async (payload: EncoderFormState) =>
      (
        await api.post<Encoder>("/encoders", {
          ...payload,
          location: payload.location || undefined,
          serialNumber: payload.serialNumber || undefined,
        })
      ).data,
    onSuccess: (encoder) => {
      toast.success("Encoder registered");
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setRevealedKey({ name: encoder.name, agentKey: encoder.agentKey! });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not register encoder")),
  });

  const rotateKey = useMutation({
    mutationFn: async (encoder: Encoder) => (await api.post<Encoder>(`/encoders/${encoder.id}/rotate-key`)).data,
    onSuccess: (encoder) => {
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      setRevealedKey({ name: encoder.name, agentKey: encoder.agentKey! });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteEncoder = useMutation({
    mutationFn: async (id: string) => api.delete(`/encoders/${id}`),
    onSuccess: () => {
      toast.success("Encoder removed");
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createEncoder.mutate(form);
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Encoders"
        description="Physical readers/writers. Each one runs the local agent (npm run agent) to bridge hardware to this dashboard."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> Register encoder
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {encoders?.map((enc) => (
          <div key={enc.id} className="card p-5">
            <div className="mb-2 flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                <Wifi size={18} />
              </div>
              <Badge tone={enc.status}>{enc.status}</Badge>
            </div>
            <Link to={`/encoders/${enc.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
              {enc.name}
            </Link>
            <p className="text-xs text-slate-400">
              {formatEnum(enc.type)} · {formatEnum(enc.connectionType)}
            </p>
            {enc.location && <p className="mt-1 text-sm text-slate-500">{enc.location}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {enc.lastSeenAt ? `Last seen ${formatDistanceToNow(new Date(enc.lastSeenAt), { addSuffix: true })}` : "Never connected"}
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => rotateKey.mutate(enc)}>
                <KeyRound size={14} /> Rotate key
              </button>
              <button
                className="btn-secondary text-red-600"
                onClick={() => {
                  if (confirm(`Remove encoder "${enc.name}"?`)) deleteEncoder.mutate(enc.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {encoders?.length === 0 && <p className="text-sm text-slate-400">No encoders registered yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Register an encoder">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Device type</label>
              <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as EncoderType }))}>
                {ENCODER_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatEnum(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Connection</label>
              <select
                className="input"
                value={form.connectionType}
                onChange={(e) => setForm((f) => ({ ...f, connectionType: e.target.value as EncoderConnectionType }))}
              >
                {ENCODER_CONNECTION_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatEnum(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          </div>
          <div>
            <label className="label">Serial number</label>
            <input className="input" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={createEncoder.isPending}>
            Register encoder
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(revealedKey)} onClose={() => setRevealedKey(null)} title="Agent key generated">
        {revealedKey && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Copy this key now — it won't be shown again. Set it as <code className="font-mono">AGENT_KEY</code> when running the
              local agent for <strong>{revealedKey.name}</strong>.
            </p>
            <div className="flex items-center gap-2">
              <input readOnly className="input font-mono text-xs" value={revealedKey.agentKey} />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey.agentKey);
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy size={15} />
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              AGENT_SERVER_URL=https://your-server AGENT_KEY={revealedKey.agentKey} npm run agent
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
