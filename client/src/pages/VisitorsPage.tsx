import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { UserPlus, ShieldOff, Radio, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { useSocket } from "@/context/SocketContext";
import { useNow } from "@/hooks/useNow";
import { CARD_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Card, CardType, Encoder, PaginatedResponse } from "@/types";

const DURATION_PRESETS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "1 day", hours: 24 },
  { label: "1 week", hours: 24 * 7 },
];

interface FormState {
  uid: string;
  cardType: CardType;
  label: string;
  durationHours: number;
  customExpiresAt: string;
}

const EMPTY_FORM: FormState = { uid: "", cardType: "NTAG213", label: "", durationHours: 24, customExpiresAt: "" };

interface EditDurationState {
  durationHours: number;
  customExpiresAt: string;
}

const EMPTY_EDIT: EditDurationState = { durationHours: 24, customExpiresAt: "" };

export default function VisitorsPage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [scanEncoderId, setScanEncoderId] = useState("");
  const [scanning, setScanning] = useState(false);

  const { data: encoders } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
  });
  const onlineEncoders = encoders?.filter((e) => e.status === "ONLINE") ?? [];

  useEffect(() => {
    if (!socket || !scanning || !scanEncoderId) return;

    function onCardDetected(payload: { encoderId: string; uid?: string }) {
      if (payload.encoderId !== scanEncoderId) return;
      if (!payload.uid) {
        toast.error("Reader didn't report a UID for that tap — try again");
        return;
      }
      const uid = payload.uid.toUpperCase();
      setForm((f) => ({ ...f, uid }));
      setScanning(false);
      toast.success(`UID captured: ${uid}`);
    }

    socket.on("card:detected", onCardDetected);
    return () => {
      socket.off("card:detected", onCardDetected);
    };
  }, [socket, scanning, scanEncoderId]);

  const { data, isLoading } = useQuery({
    queryKey: ["cards", { hasExpiry: true }],
    queryFn: async () =>
      (await api.get<PaginatedResponse<Card>>("/cards", { params: { hasExpiry: true, pageSize: 100 } })).data,
  });

  const issuePass = useMutation({
    mutationFn: async () => {
      // A datetime-local input is timezone-less ("wall clock") text; parsing
      // it with `new Date(...)` interprets it in the browser's own timezone
      // (unambiguous here), and `.toISOString()` is what the server expects.
      const expiresAt = form.customExpiresAt
        ? new Date(form.customExpiresAt).toISOString()
        : new Date(Date.now() + form.durationHours * 60 * 60 * 1000).toISOString();

      return (
        await api.post<Card>("/cards", {
          uid: form.uid,
          cardType: form.cardType,
          label: form.label || undefined,
          expiresAt,
        })
      ).data;
    },
    onSuccess: () => {
      toast.success("Visitor pass issued");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not issue visitor pass")),
  });

  const endPassEarly = useMutation({
    mutationFn: async (cardId: string) => api.post(`/cards/${cardId}/block`),
    onSuccess: () => {
      toast.success("Pass ended");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not end pass")),
  });

  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editForm, setEditForm] = useState<EditDurationState>(EMPTY_EDIT);

  const editDuration = useMutation({
    mutationFn: async () => {
      if (!editingCard) return;
      const expiresAt = editForm.customExpiresAt
        ? new Date(editForm.customExpiresAt).toISOString()
        : new Date(Date.now() + editForm.durationHours * 60 * 60 * 1000).toISOString();
      return (await api.patch<Card>(`/cards/${editingCard.id}`, { expiresAt })).data;
    },
    onSuccess: () => {
      toast.success("Pass duration updated");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setEditingCard(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update pass duration")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    issuePass.mutate();
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    editDuration.mutate();
  }

  function openEdit(card: Card) {
    setEditingCard(card);
    setEditForm(EMPTY_EDIT);
  }

  const passes = data?.data ?? [];
  const now = useNow(1000);

  return (
    <div>
      <PageHeader
        title="Visitors"
        description="Quick-issue a temporary, auto-expiring pass for someone who isn't a full card holder — a guest, a day visitor, a contractor."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Issue a pass</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
              <label className="label">Scan from encoder (optional)</label>
              {onlineEncoders.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No encoders are online right now — enter the UID by hand below, or start a local agent and reopen this page.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    className="input"
                    value={scanEncoderId}
                    onChange={(e) => {
                      setScanEncoderId(e.target.value);
                      setScanning(false);
                    }}
                  >
                    <option value="">Select an encoder…</option>
                    {onlineEncoders.map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        {enc.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary whitespace-nowrap"
                    disabled={!scanEncoderId}
                    onClick={() => setScanning((s) => !s)}
                  >
                    <Radio size={14} className={scanning ? "animate-pulse text-emerald-500" : ""} />
                    {scanning ? "Waiting for tap…" : "Scan"}
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="label">Card UID</label>
              <input
                className="input font-mono"
                required
                placeholder="04A1B2C3D4"
                value={form.uid}
                onChange={(e) => setForm((f) => ({ ...f, uid: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className="label">Card type</label>
              <select
                className="input"
                value={form.cardType}
                onChange={(e) => setForm((f) => ({ ...f, cardType: e.target.value as CardType }))}
              >
                {CARD_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatEnum(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Visitor / purpose (optional)</label>
              <input
                className="input"
                placeholder="e.g. Jane Doe — vendor meeting"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Expires in</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={
                      !form.customExpiresAt && form.durationHours === p.hours ? "btn-primary" : "btn-secondary"
                    }
                    onClick={() => setForm((f) => ({ ...f, durationHours: p.hours, customExpiresAt: "" }))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Or a specific date/time (optional)</label>
              <input
                type="datetime-local"
                className="input"
                value={form.customExpiresAt}
                onChange={(e) => setForm((f) => ({ ...f, customExpiresAt: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={issuePass.isPending}>
              {issuePass.isPending ? <Spinner className="h-4 w-4 text-white" /> : <UserPlus size={16} />} Issue pass
            </button>
          </form>
        </div>

        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Active & recent passes</h3>
          {isLoading ? (
            <FullPageSpinner />
          ) : (
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">Pass</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {passes.map((card) => {
                    const expired = card.expiresAt ? new Date(card.expiresAt).getTime() <= now.getTime() : false;
                    return (
                      <tr key={card.id}>
                        <td className="py-2 pr-3">
                          <Link to={`/cards/${card.id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                            {card.label ?? card.uid}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={expired ? "EXPIRED" : card.status}>{expired ? "Expired" : card.status}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-slate-500">
                          {card.expiresAt ? (
                            <span title={format(new Date(card.expiresAt), "PPpp")}>
                              {expired ? "expired " : ""}
                              {formatDistanceToNow(new Date(card.expiresAt), { addSuffix: true })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {!expired && card.status !== "BLOCKED" && (
                            <div className="flex justify-end gap-2">
                              <button className="btn-secondary" title="Edit pass duration" onClick={() => openEdit(card)}>
                                <Pencil size={14} /> Edit
                              </button>
                              <button
                                className="btn-secondary"
                                title="End this pass now"
                                onClick={() => endPassEarly.mutate(card.id)}
                                disabled={endPassEarly.isPending}
                              >
                                <ShieldOff size={14} /> End now
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {passes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400">
                        No visitor passes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!editingCard} onClose={() => setEditingCard(null)} title={`Edit duration — ${editingCard?.label ?? editingCard?.uid ?? ""}`}>
        <form onSubmit={handleEditSubmit} className="space-y-3">
          <div>
            <label className="label">Expires in</label>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={!editForm.customExpiresAt && editForm.durationHours === p.hours ? "btn-primary" : "btn-secondary"}
                  onClick={() => setEditForm((f) => ({ ...f, durationHours: p.hours, customExpiresAt: "" }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Or a specific date/time (optional)</label>
            <input
              type="datetime-local"
              className="input"
              value={editForm.customExpiresAt}
              onChange={(e) => setEditForm((f) => ({ ...f, customExpiresAt: e.target.value }))}
            />
          </div>
          <p className="text-xs text-slate-400">Both options count from now — this replaces the pass's current expiry.</p>
          <button type="submit" className="btn-primary w-full" disabled={editDuration.isPending}>
            {editDuration.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Pencil size={16} />} Save new duration
          </button>
        </form>
      </Modal>
    </div>
  );
}
