import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldOff, ShieldCheck, UserRound, UserX, AlertTriangle, Archive, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { formatEnum } from "@/lib/constants";
import type { Card, CardHolder, Encoder, OperationLog, PaginatedResponse } from "@/types";

const MIFARE_CLASSIC_TYPES = new Set(["MIFARE_CLASSIC_1K", "MIFARE_CLASSIC_4K", "MIFARE_CLASSIC_MINI"]);
const KEY_MANAGER_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]);

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [holderId, setHolderId] = useState("");
  const [encoderToGrant, setEncoderToGrant] = useState("");
  const [encoderExpiryInput, setEncoderExpiryInput] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string> | null>(null);

  const { data: card, isLoading } = useQuery({
    queryKey: ["card", id],
    queryFn: async () => (await api.get<Card>(`/cards/${id}`)).data,
    enabled: Boolean(id),
  });

  const { data: holders } = useQuery({
    queryKey: ["holders"],
    queryFn: async () => (await api.get<CardHolder[]>("/holders")).data,
  });

  const { data: logs } = useQuery({
    queryKey: ["logs", { cardId: id }],
    queryFn: async () => (await api.get<PaginatedResponse<OperationLog>>("/logs", { params: { cardId: id, pageSize: 20 } })).data,
    enabled: Boolean(id),
  });

  const { data: encoders } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["card", id] });
    queryClient.invalidateQueries({ queryKey: ["logs", { cardId: id }] });
    queryClient.invalidateQueries({ queryKey: ["cards"] });
  }

  const grantEncoder = useMutation({
    mutationFn: async ({ encoderId, expiresAt }: { encoderId: string; expiresAt?: string }) =>
      // `expiresAt` comes from a <input type="datetime-local"> — a
      // timezone-less "wall clock" string. Converting it via `new Date(...)`
      // here (in the browser, so it's interpreted in the browser's own
      // timezone) and sending `.toISOString()` keeps it unambiguous;
      // sending the raw string would have the server parse it in its own
      // timezone instead, which is wrong whenever the two differ.
      api.post(`/cards/${id}/encoders/grant`, {
        encoderIds: [encoderId],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success("Card restricted to encoder");
      setEncoderToGrant("");
      setEncoderExpiryInput("");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const revokeEncoder = useMutation({
    mutationFn: async (encoderId: string) => api.post(`/cards/${id}/encoders/revoke`, { encoderIds: [encoderId] }),
    onSuccess: () => {
      toast.success("Encoder allocation removed");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const assign = useMutation({
    mutationFn: async () => api.post(`/cards/${id}/assign`, { holderId }),
    onSuccess: () => {
      toast.success("Card assigned");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const action = useMutation({
    mutationFn: async (path: string) => api.post(`/cards/${id}/${path}`),
    onSuccess: (_res, path) => {
      toast.success(`Card ${path.replace("un", "un-")}${path === "unassign" ? "ed" : "ed"}`);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const viewKeys = useMutation({
    mutationFn: async () => (await api.get<{ keys: Record<string, string> | null }>(`/cards/${id}/keys`)).data.keys,
    onSuccess: (keys) => setRevealedKeys(keys ?? {}),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const generateKeys = useMutation({
    mutationFn: async () => (await api.post<{ keys: Record<string, string> }>(`/cards/${id}/keys/generate`)).data.keys,
    onSuccess: (keys) => {
      setRevealedKeys(keys);
      toast.success("Generated new random keys for this card");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (isLoading || !card) return <FullPageSpinner />;

  return (
    <div>
      <Link to="/cards" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft size={15} /> Back to cards
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{card.uid}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatEnum(card.cardType)} {card.label && `· ${card.label}`}
          </p>
        </div>
        <Badge tone={card.status}>{formatEnum(card.status)}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card space-y-4 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Card holder</h3>
          {card.holder ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                  <UserRound size={16} />
                </div>
                <div>
                  <div className="font-medium">{card.holder.fullName}</div>
                  <div className="text-xs text-slate-400">{card.holder.department ?? card.holder.employeeId}</div>
                </div>
              </div>
              <button className="btn-secondary" onClick={() => action.mutate("unassign")}>
                <UserX size={15} /> Unassign
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select className="input" value={holderId} onChange={(e) => setHolderId(e.target.value)}>
                <option value="">Select a card holder</option>
                {holders?.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.fullName}
                  </option>
                ))}
              </select>
              <button className="btn-primary whitespace-nowrap" disabled={!holderId} onClick={() => assign.mutate()}>
                Assign
              </button>
            </div>
          )}

          <h3 className="pt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Lifecycle</h3>
          <div className="flex flex-wrap gap-2">
            {card.status !== "BLOCKED" && (
              <button className="btn-secondary" onClick={() => action.mutate("block")}>
                <ShieldOff size={15} /> Block
              </button>
            )}
            {card.status === "BLOCKED" && (
              <button className="btn-secondary" onClick={() => action.mutate("unblock")}>
                <ShieldCheck size={15} /> Unblock
              </button>
            )}
            <button className="btn-secondary" onClick={() => action.mutate("lost")}>
              <AlertTriangle size={15} /> Mark lost
            </button>
            <button className="btn-danger" onClick={() => action.mutate("retire")}>
              <Archive size={15} /> Retire
            </button>
          </div>

          {card.accessZones && card.accessZones.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Access zones</h3>
              <div className="flex flex-wrap gap-2">
                {card.accessZones.map((z) => (
                  <Badge key={z.zone.id} tone="ACTIVE">
                    {z.zone.name}
                  </Badge>
                ))}
              </div>
            </>
          )}

          <h3 className="pt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Allowed encoders</h3>
          <p className="text-xs text-slate-400">
            {card.encoderAllocations && card.encoderAllocations.length > 0
              ? "This card can only be used with the encoder(s) below."
              : "Unrestricted — this card can be used with any encoder in the company."}
          </p>
          {card.encoderAllocations && card.encoderAllocations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {card.encoderAllocations.map((a) => {
                const expired = a.expiresAt && new Date(a.expiresAt) <= new Date();
                return (
                  <span
                    key={a.encoder.id}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                      expired
                        ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                    title={a.expiresAt ? new Date(a.expiresAt).toLocaleString() : undefined}
                  >
                    {a.encoder.name}
                    {a.expiresAt && (
                      <span className={expired ? "" : "text-slate-400"}>
                        {expired ? "· expired" : `· until ${formatDistanceToNow(new Date(a.expiresAt), { addSuffix: true })}`}
                      </span>
                    )}
                    <button
                      className="text-slate-400 hover:text-red-600"
                      onClick={() => revokeEncoder.mutate(a.encoder.id)}
                      aria-label={`Remove ${a.encoder.name} allocation`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select className="input" value={encoderToGrant} onChange={(e) => setEncoderToGrant(e.target.value)}>
              <option value="">Restrict to an encoder…</option>
              {encoders
                ?.filter((enc) => !card.encoderAllocations?.some((a) => a.encoder.id === enc.id))
                .map((enc) => (
                  <option key={enc.id} value={enc.id}>
                    {enc.name}
                  </option>
                ))}
            </select>
            <input
              type="datetime-local"
              className="input"
              title="Access expires at (optional — e.g. guest checkout time)"
              value={encoderExpiryInput}
              onChange={(e) => setEncoderExpiryInput(e.target.value)}
            />
            <button
              className="btn-secondary whitespace-nowrap"
              disabled={!encoderToGrant}
              onClick={() => grantEncoder.mutate({ encoderId: encoderToGrant, expiresAt: encoderExpiryInput })}
            >
              Add
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Leave the date/time blank for access that never expires — for a hotel, set it to the guest's checkout time.
          </p>
        </div>

        <div className="card space-y-2 p-5 text-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Details</h3>
          <Row label="Template" value={card.template?.name ?? "—"} />
          <Row label="Registered by" value={card.registeredByEncoder?.name ?? "—"} />
          <Row label="Keys stored" value={card.hasStoredKeys ? "Yes (encrypted)" : "No"} />
          <Row label="Issued" value={card.issuedAt ? new Date(card.issuedAt).toLocaleDateString() : "—"} />
          <Row label="Expires" value={card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : "—"} />
          <Row label="Notes" value={card.notes ?? "—"} />

          {user && KEY_MANAGER_ROLES.has(user.role) && MIFARE_CLASSIC_TYPES.has(card.cardType) && (
            <>
              <h3 className="pt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Sector keys</h3>
              <p className="text-xs text-slate-400">
                Random per-card keys mean a lost card doesn't expose every other card's key. Generating replaces the
                stored keys — commands sent from Live Encode will need the new values.
              </p>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={viewKeys.isPending} onClick={() => viewKeys.mutate()}>
                  View keys
                </button>
                <button
                  className="btn-secondary"
                  disabled={generateKeys.isPending}
                  onClick={() => {
                    if (confirm("Generate new random keys for this card? Any previously stored key stops working.")) {
                      generateKeys.mutate();
                    }
                  }}
                >
                  Generate random keys
                </button>
              </div>
              {revealedKeys && (
                <div className="rounded-lg border border-slate-100 p-3 font-mono text-xs dark:border-slate-800">
                  {Object.keys(revealedKeys).length === 0 ? (
                    <p className="text-slate-400">No keys stored yet.</p>
                  ) : (
                    Object.entries(revealedKeys).map(([name, value]) => (
                      <div key={name} className="flex justify-between gap-4 py-0.5">
                        <span className="text-slate-400">Sector {name.slice(0, -1)}, Key {name.slice(-1)}</span>
                        <span>{value}</span>
                      </div>
                    ))
                  )}
                  <button className="mt-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" onClick={() => setRevealedKeys(null)}>
                    Hide
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">History</h3>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {logs?.data.map((log) => (
            <div key={log.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div>
                <span className="font-medium">{formatEnum(log.operationType)}</span>
                {log.user && <span className="text-slate-500"> · by {log.user.fullName}</span>}
                {log.encoder && <span className="text-slate-500"> · via {log.encoder.name}</span>}
              </div>
              <div className="flex items-center gap-3 whitespace-nowrap">
                <Badge tone={log.status}>{log.status}</Badge>
                <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(log.performedAt), { addSuffix: true })}</span>
              </div>
            </div>
          ))}
          {(!logs || logs.data.length === 0) && <p className="text-sm text-slate-400">No activity recorded yet.</p>}
        </div>
      </div>
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
