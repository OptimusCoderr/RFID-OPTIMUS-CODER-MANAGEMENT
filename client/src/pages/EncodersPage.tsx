import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound, Trash2, Copy, Wifi, Download } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage, downloadPost } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { ENCODER_CONNECTION_OPTIONS, ENCODER_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Company, Encoder, EncoderConnectionType, EncoderType } from "@/types";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/context/AuthContext";

interface EncoderFormState {
  name: string;
  type: EncoderType;
  connectionType: EncoderConnectionType;
  location: string;
  serialNumber: string;
  companyId: string;
}

const EMPTY_FORM: EncoderFormState = {
  name: "",
  type: "ACR122U",
  connectionType: "USB",
  location: "",
  serialNumber: "",
  companyId: "",
};

export default function EncodersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EncoderFormState>(EMPTY_FORM);
  const [revealedKey, setRevealedKey] = useState<{ name: string; agentKey: string } | null>(null);
  const [agentServerUrl, setAgentServerUrl] = useState(window.location.origin);
  const [downloadingAgent, setDownloadingAgent] = useState(false);

  const { data: encoders, isLoading } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
    refetchInterval: 15_000,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/companies")).data,
    enabled: currentUser?.role === "SUPER_ADMIN",
  });

  const createEncoder = useMutation({
    mutationFn: async (payload: EncoderFormState) =>
      (
        await api.post<Encoder>("/encoders", {
          ...payload,
          location: payload.location || undefined,
          serialNumber: payload.serialNumber || undefined,
          companyId: currentUser?.role === "SUPER_ADMIN" ? payload.companyId : undefined,
        })
      ).data,
    onSuccess: (encoder) => {
      toast.success("Encoder registered");
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setRevealedKey({ name: encoder.name, agentKey: encoder.agentKey! });
      setAgentServerUrl(window.location.origin);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not register encoder")),
  });

  const rotateKey = useMutation({
    mutationFn: async (encoder: Encoder) => (await api.post<Encoder>(`/encoders/${encoder.id}/rotate-key`)).data,
    onSuccess: (encoder) => {
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      setRevealedKey({ name: encoder.name, agentKey: encoder.agentKey! });
      setAgentServerUrl(window.location.origin);
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

  async function handleDownloadAgent() {
    if (!revealedKey) return;
    setDownloadingAgent(true);
    try {
      const filename = `rfid-agent-${revealedKey.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      await downloadPost("/agent-package/download", { agentKey: revealedKey.agentKey, serverUrl: agentServerUrl }, filename);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not download the agent package"));
    } finally {
      setDownloadingAgent(false);
    }
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
          {currentUser?.role === "SUPER_ADMIN" && (
            <div>
              <label className="label">Company</label>
              <select
                className="input"
                required
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
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
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={createEncoder.isPending}>
            Register encoder
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(revealedKey)} onClose={() => setRevealedKey(null)} title="Set up the local agent">
        {revealedKey && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              <strong>{revealedKey.name}</strong> is registered. Set up its local agent on the machine with the
              physical reader plugged in — download a ready-to-run package below, no need for this platform's
              source code or a development setup.
            </p>

            <div>
              <label className="label">Agent server URL</label>
              <input
                className="input font-mono text-xs"
                value={agentServerUrl}
                onChange={(e) => setAgentServerUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">
                The address the agent connects to. Defaults to this page's address — change it if the reader's
                machine reaches this server through a different URL (e.g. a different public hostname).
              </p>
            </div>

            <button type="button" className="btn-primary w-full" onClick={handleDownloadAgent} disabled={downloadingAgent}>
              {downloadingAgent ? <Spinner className="h-4 w-4 text-white" /> : <Download size={15} />}
              Download agent for {revealedKey.name}
            </button>
            <p className="text-xs text-slate-400">
              Unzip it on that machine, run <code className="font-mono">npm install</code> once, then{" "}
              <code className="font-mono">npm start</code> — the server URL and key above are already filled in.
            </p>

            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Advanced: run it from source instead</summary>
              <div className="mt-2 space-y-2">
                <p className="text-slate-400">
                  Copy this key now — it won't be shown again outside this package download.
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
                  AGENT_SERVER_URL={agentServerUrl} AGENT_KEY={revealedKey.agentKey} npm run agent
                </pre>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </div>
  );
}
