import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Trash2, Copy, Download } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import toast from "react-hot-toast";
import { api, apiErrorMessage, downloadPost } from "@/lib/api";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatEnum } from "@/lib/constants";
import { useSocket } from "@/context/SocketContext";
import type { Encoder, EncoderStatus, OperationLog, PaginatedResponse } from "@/types";

export default function EncoderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [liveStatus, setLiveStatus] = useState<EncoderStatus | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [agentServerUrl, setAgentServerUrl] = useState(window.location.origin);
  const [downloadingAgent, setDownloadingAgent] = useState(false);

  const { data: encoder, isLoading } = useQuery({
    queryKey: ["encoder", id],
    queryFn: async () => (await api.get<Encoder>(`/encoders/${id}`)).data,
    enabled: Boolean(id),
  });

  const { data: logs } = useQuery({
    queryKey: ["logs", { encoderId: id }],
    queryFn: async () => (await api.get<PaginatedResponse<OperationLog>>("/logs", { params: { encoderId: id, pageSize: 20 } })).data,
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!socket) return;
    function onStatus(payload: { encoderId: string; status: EncoderStatus }) {
      if (payload.encoderId === id) setLiveStatus(payload.status);
    }
    socket.on("encoder:status", onStatus);
    return () => {
      socket.off("encoder:status", onStatus);
    };
  }, [socket, id]);

  const rotateKey = useMutation({
    mutationFn: async () => (await api.post<Encoder>(`/encoders/${id}/rotate-key`)).data,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["encoder", id] });
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      setRevealedKey(updated.agentKey!);
      setAgentServerUrl(window.location.origin);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  async function handleDownloadAgent() {
    if (!revealedKey || !encoder) return;
    setDownloadingAgent(true);
    try {
      const filename = `rfid-agent-${encoder.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      await downloadPost("/agent-package/download", { agentKey: revealedKey, serverUrl: agentServerUrl }, filename);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not download the agent package"));
    } finally {
      setDownloadingAgent(false);
    }
  }

  const deleteEncoder = useMutation({
    mutationFn: async () => api.delete(`/encoders/${id}`),
    onSuccess: () => {
      toast.success("Encoder removed");
      queryClient.invalidateQueries({ queryKey: ["encoders"] });
      navigate("/encoders");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (isLoading || !encoder) return <FullPageSpinner />;

  const status = liveStatus ?? encoder.status;

  return (
    <div>
      <Link to="/encoders" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft size={15} /> Back to encoders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{encoder.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatEnum(encoder.type)} · {formatEnum(encoder.connectionType)}
            {encoder.location && ` · ${encoder.location}`}
          </p>
        </div>
        <Badge tone={status}>{status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card space-y-2 p-5 text-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Details</h3>
          <Row label="Serial number" value={encoder.serialNumber ?? "—"} />
          <Row label="Firmware" value={encoder.firmwareVersion ?? "—"} />
          <Row
            label="Last seen"
            value={encoder.lastSeenAt ? formatDistanceToNow(new Date(encoder.lastSeenAt), { addSuffix: true }) : "Never"}
          />
          <Row label="Registered" value={format(new Date(encoder.createdAt), "MMM d, yyyy")} />

          <div className="flex gap-2 pt-3">
            <button className="btn-secondary flex-1" onClick={() => rotateKey.mutate()} disabled={rotateKey.isPending}>
              <KeyRound size={14} /> Rotate agent key
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(`Remove encoder "${encoder.name}"?`)) deleteEncoder.mutate();
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Recent activity</h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {logs?.data.map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <span className="font-medium">{formatEnum(log.operationType)}</span>
                  {log.card && <span className="text-slate-500"> · card {log.card.label ?? log.card.uid}</span>}
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <Badge tone={log.status}>{log.status}</Badge>
                  <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(log.performedAt), { addSuffix: true })}</span>
                </div>
              </div>
            ))}
            {(!logs || logs.data.length === 0) && <p className="text-sm text-slate-400">No activity recorded for this encoder yet.</p>}
          </div>
        </div>
      </div>

      <Modal open={Boolean(revealedKey)} onClose={() => setRevealedKey(null)} title="New agent key generated">
        {revealedKey && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Download a fresh, ready-to-run agent package for <strong>{encoder.name}</strong> with this new key
              already filled in — no need for this platform's source code.
            </p>

            <div>
              <label className="label">Agent server URL</label>
              <input
                className="input font-mono text-xs"
                value={agentServerUrl}
                onChange={(e) => setAgentServerUrl(e.target.value)}
              />
            </div>

            <button type="button" className="btn-primary w-full" onClick={handleDownloadAgent} disabled={downloadingAgent}>
              {downloadingAgent ? <Spinner className="h-4 w-4 text-white" /> : <Download size={15} />}
              Download agent for {encoder.name}
            </button>
            <p className="text-xs text-slate-400">
              Unzip on the machine with the reader, run <code className="font-mono">npm install</code> once, then{" "}
              <code className="font-mono">npm start</code>.
            </p>

            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">Advanced: run it from source instead</summary>
              <div className="mt-2 space-y-2">
                <p className="text-slate-400">Copy this key now — it won't be shown again outside this package download.</p>
                <div className="flex items-center gap-2">
                  <input readOnly className="input font-mono text-xs" value={revealedKey} />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(revealedKey);
                      toast.success("Copied to clipboard");
                    }}
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  AGENT_SERVER_URL={agentServerUrl} AGENT_KEY={revealedKey} npm run agent
                </pre>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-50 py-1.5 last:border-0 dark:border-slate-800/60">
      <span className="text-slate-400">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
