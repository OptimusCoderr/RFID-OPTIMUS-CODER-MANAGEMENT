import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search, Download, Upload, ShieldOff, ShieldCheck, X, Radio } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage, downloadCsv } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { toCsv, downloadCsvString } from "@/lib/toCsv";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { useSocket } from "@/context/SocketContext";
import { CARD_STATUS_OPTIONS, CARD_TYPE_OPTIONS, formatEnum } from "@/lib/constants";
import type { Card, CardTemplate, CardType, Encoder, PaginatedResponse } from "@/types";

interface BulkImportResult {
  created: number;
  skipped: number;
  errors: { row: number; uid?: string; error: string }[];
}

interface RegisterFormState {
  uid: string;
  cardType: CardType;
  label: string;
  notes: string;
  templateId: string;
}

const EMPTY_FORM: RegisterFormState = { uid: "", cardType: "MIFARE_CLASSIC_1K", label: "", notes: "", templateId: "" };

export default function CardsPage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RegisterFormState>(EMPTY_FORM);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [cardType, setCardType] = useState("");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scanEncoderId, setScanEncoderId] = useState("");
  const [scanning, setScanning] = useState(false);

  const { data: encoders } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
    enabled: modalOpen,
  });
  const onlineEncoders = encoders?.filter((e) => e.status === "ONLINE") ?? [];

  useEffect(() => {
    if (!modalOpen) {
      setScanning(false);
      setScanEncoderId("");
    }
  }, [modalOpen]);

  useEffect(() => {
    if (!socket || !scanning || !scanEncoderId) return;

    function onCardDetected(payload: { encoderId: string; uid: string }) {
      if (payload.encoderId !== scanEncoderId) return;
      setForm((f) => ({ ...f, uid: payload.uid.toUpperCase() }));
      setScanning(false);
      toast.success(`UID captured: ${payload.uid.toUpperCase()}`);
    }

    socket.on("card:detected", onCardDetected);
    return () => {
      socket.off("card:detected", onCardDetected);
    };
  }, [socket, scanning, scanEncoderId]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["cards", { page, status, cardType, search }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<Card>>("/cards", {
          params: { page, pageSize: 20, status: status || undefined, cardType: cardType || undefined, search: search || undefined },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<CardTemplate[]>("/templates")).data,
  });

  // Selection is page/filter scoped — drop it whenever the visible set changes.
  useEffect(() => {
    setSelected(new Set());
  }, [page, status, cardType, search]);

  const registerCard = useMutation({
    mutationFn: async (payload: RegisterFormState) =>
      (
        await api.post("/cards", {
          ...payload,
          uid: payload.uid.trim().toUpperCase(),
          label: payload.label || undefined,
          notes: payload.notes || undefined,
          templateId: payload.templateId || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Card registered");
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not register card")),
  });

  const bulkImport = useMutation({
    mutationFn: async (rows: Record<string, string>[]) =>
      (
        await api.post<BulkImportResult>("/cards/bulk-import", {
          rows: rows.map((r) => ({
            uid: r.uid ?? r.UID,
            cardType: r.cardType ?? r.CardType ?? r["Card Type"],
            label: r.label ?? r.Label,
          })),
        })
      ).data,
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      if (result.created > 0) toast.success(`Imported ${result.created} card${result.created === 1 ? "" : "s"}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Import failed")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    registerCard.mutate(form);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    setImportRows(rows);
    setImportResult(null);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadCsv(
        "/cards/export",
        { status: status || undefined, cardType: cardType || undefined, search: search || undefined },
        `cards-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const pageIds = data?.data.map((c) => c.id) ?? [];
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(pageIds));
  }

  const bulkSetStatus = useMutation({
    mutationFn: async (action: "block" | "unblock") => {
      const ids = Array.from(selected);
      const results = await Promise.allSettled(ids.map((id) => api.post(`/cards/${id}/${action}`)));
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }, action) => {
      const succeeded = total - failed;
      if (succeeded > 0) toast.success(`${succeeded} card${succeeded === 1 ? "" : "s"} ${action}ed`);
      if (failed > 0) toast.error(`${failed} card${failed === 1 ? "" : "s"} failed to update`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: () => toast.error("Bulk update failed"),
  });

  function handleExportSelected() {
    const rows = data?.data.filter((c) => selected.has(c.id)) ?? [];
    const csv = toCsv(rows, [
      { header: "UID", value: (c: Card) => c.uid },
      { header: "Card Type", value: (c: Card) => c.cardType },
      { header: "Status", value: (c: Card) => c.status },
      { header: "Label", value: (c: Card) => c.label },
      { header: "Holder", value: (c: Card) => c.holder?.fullName },
    ]);
    downloadCsvString(csv, `selected-cards-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const availableTemplates = templates?.filter((t) => t.cardType === form.cardType) ?? [];

  return (
    <div>
      <PageHeader
        title="Cards"
        description="Every MIFARE, NTAG, or generic RFID tag registered to your organization."
        actions={
          <>
            <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
              {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} Export CSV
            </button>
            <button className="btn-secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import CSV
            </button>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>
              <Plus size={16} /> Register card
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-56 pl-9"
            placeholder="Search UID or label..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="input w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {CARD_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {formatEnum(s)}
            </option>
          ))}
        </select>
        <select
          className="input w-52"
          value={cardType}
          onChange={(e) => {
            setCardType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All card types</option>
          {CARD_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {formatEnum(t)}
            </option>
          ))}
        </select>
        {isFetching && <Spinner className="h-4 w-4" />}
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm dark:border-brand-900 dark:bg-brand-900/20">
          <span className="font-medium">{selected.size} selected</span>
          <button className="btn-secondary" onClick={() => bulkSetStatus.mutate("block")} disabled={bulkSetStatus.isPending}>
            <ShieldOff size={14} /> Block
          </button>
          <button className="btn-secondary" onClick={() => bulkSetStatus.mutate("unblock")} disabled={bulkSetStatus.isPending}>
            <ShieldCheck size={14} /> Unblock
          </button>
          <button className="btn-secondary" onClick={handleExportSelected}>
            <Download size={14} /> Export selected
          </button>
          <button className="ml-auto text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" onClick={() => setSelected(new Set())}>
            <X size={16} />
          </button>
        </div>
      )}

      {isLoading ? (
        <FullPageSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={(data?.data.length ?? 0) > 0 && data!.data.every((c) => selected.has(c.id))}
                    onChange={toggleSelectAllOnPage}
                  />
                </th>
                <th className="px-4 py-3">UID</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.data.map((card) => (
                <tr key={card.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(card.id)} onChange={() => toggleSelected(card.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/cards/${card.id}`} className="font-mono font-medium text-brand-600 hover:underline dark:text-brand-400">
                      {card.uid}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{card.label ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatEnum(card.cardType)}</td>
                  <td className="px-4 py-3 text-slate-500">{card.holder?.fullName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={card.status}>{formatEnum(card.status)}</Badge>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No cards match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              <span className="text-slate-400">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} cards)
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button
                  className="btn-secondary"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Register a card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <label className="label">Scan from encoder (optional)</label>
            {onlineEncoders.length === 0 ? (
              <p className="text-xs text-slate-400">
                No encoders are online right now — enter the UID by hand below, or start a local agent and reopen this form.
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
            <label className="label">UID (hex)</label>
            <input
              className="input font-mono"
              required
              placeholder="04A1B2C3D4"
              value={form.uid}
              onChange={(e) => setForm((f) => ({ ...f, uid: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Card type</label>
            <select
              className="input"
              value={form.cardType}
              onChange={(e) => setForm((f) => ({ ...f, cardType: e.target.value as CardType, templateId: "" }))}
            >
              {CARD_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {formatEnum(t)}
                </option>
              ))}
            </select>
          </div>
          {availableTemplates.length > 0 && (
            <div>
              <label className="label">Template (optional)</label>
              <select className="input" value={form.templateId} onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}>
                <option value="">No template</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Label</label>
            <input className="input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={registerCard.isPending}>
            Register card
          </button>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportRows([]);
          setImportResult(null);
        }}
        title="Import cards from CSV"
        wide
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            CSV with columns <code className="font-mono text-xs">uid, cardType, label</code> (header row required). Card type must
            match one of the supported types, e.g. <code className="font-mono text-xs">MIFARE_CLASSIC_1K</code>.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={handleFileSelected}
          />

          {importRows.length > 0 && !importResult && (
            <div>
              <p className="mb-2 text-sm text-slate-500">{importRows.length} row(s) ready to import.</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-100 text-xs dark:border-slate-800">
                <table className="w-full">
                  <thead className="bg-slate-50 text-left dark:bg-slate-900/50">
                    <tr>
                      <th className="px-3 py-2">UID</th>
                      <th className="px-3 py-2">Card Type</th>
                      <th className="px-3 py-2">Label</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {importRows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono">{r.uid ?? r.UID}</td>
                        <td className="px-3 py-1.5">{r.cardType ?? r.CardType ?? r["Card Type"]}</td>
                        <td className="px-3 py-1.5">{r.label ?? r.Label ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn-primary mt-3 w-full" onClick={() => bulkImport.mutate(importRows)} disabled={bulkImport.isPending}>
                {bulkImport.isPending ? <Spinner className="h-4 w-4 text-white" /> : `Import ${importRows.length} card(s)`}
              </button>
            </div>
          )}

          {importResult && (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-600">{importResult.created} created</span>
                <span className="text-slate-500">{importResult.skipped} skipped (already existed)</span>
                <span className="text-red-600">{importResult.errors.length} errors</span>
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-red-100 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                  {importResult.errors.map((e, i) => (
                    <div key={i}>
                      Row {e.row}
                      {e.uid ? ` (${e.uid})` : ""}: {e.error}
                    </div>
                  ))}
                </div>
              )}
              <button
                className="btn-secondary w-full"
                onClick={() => {
                  setImportOpen(false);
                  setImportRows([]);
                  setImportResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
