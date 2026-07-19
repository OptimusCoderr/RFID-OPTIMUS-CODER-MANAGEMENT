import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Radio, Play, Square, RotateCcw, Plus, Pencil, Trash2, Save, UserCog, Eraser } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage, downloadCsv } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { useSocket } from "@/context/SocketContext";
import { useNow } from "@/hooks/useNow";
import { formatCountdown } from "@/lib/countdown";
import type {
  AccessZone,
  AttendanceMode,
  AttendanceRecord,
  AttendanceSession,
  Card,
  CardHolder,
  Encoder,
  ManualOverride,
  PaginatedResponse,
} from "@/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATE_LABELS: Record<AttendanceSession["state"]["reason"], string> = {
  manual_open: "Started manually",
  manual_closed: "Stopped manually",
  scheduled_open: "Within scheduled hours",
  scheduled_closed: "Outside scheduled hours",
  no_schedule: "No days/times set — always open",
};

const MODE_LABELS: Record<AttendanceMode, string> = {
  FREE: "Free (check in/out at will)",
  CHECK_IN_ONLY: "Check-in only, once",
  CHECK_OUT_ONLY: "Check-out only, once",
  ONCE: "Check in & out, once each",
};

const MODE_HELP: Record<AttendanceMode, string> = {
  FREE: "Every tap alternates check-in/check-out, with no limit — the original behavior.",
  CHECK_IN_ONLY: "Each card can only ever record a single check-in here. A repeat tap is rejected.",
  CHECK_OUT_ONLY: "Each card can only ever record a single check-out here. A repeat tap is rejected.",
  ONCE: "Each card gets exactly one check-in then one check-out. A third tap is rejected.",
};

interface ScheduleFormState {
  encoderId: string;
  zoneId: string;
  label: string;
  description: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  mode: AttendanceMode;
}

const EMPTY_SCHEDULE: ScheduleFormState = {
  encoderId: "",
  zoneId: "",
  label: "",
  description: "",
  daysOfWeek: [],
  startTime: "",
  endTime: "",
  mode: "FREE",
};

interface FeedEntry {
  id: string;
  at: Date;
  message: string;
  tone: "SUCCESS" | "FAILED";
}

export default function AttendancePage() {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();

  const { data: encoders } = useQuery({
    queryKey: ["encoders"],
    queryFn: async () => (await api.get<Encoder[]>("/encoders")).data,
  });
  const { data: zones } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await api.get<AccessZone[]>("/zones")).data,
  });

  const [encoderId, setEncoderId] = useState("");
  const [sessionZoneId, setSessionZoneId] = useState("");
  const [feed, setFeed] = useState<FeedEntry[]>([]);

  const [page, setPage] = useState(1);
  const [filterZoneId, setFilterZoneId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSessionId, setFilterSessionId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!encoders || encoders.length === 0) return;
    if (!encoderId) setEncoderId(encoders[0].id);
  }, [encoders, encoderId]);

  // One encoder can host many independent schedules — like a lecture hall
  // with several different courses through the week. This list is the
  // single source of truth for both the "Take attendance" closed-banner and
  // the "Saved schedules" table below.
  const { data: allSessions } = useQuery({
    queryKey: ["attendance-sessions"],
    queryFn: async () => (await api.get<AttendanceSession[]>("/attendance-sessions")).data,
    // Re-fetches itself right around the next schedule to flip open/closed
    // anywhere in the list, so badges/countdowns stay correct without
    // polling constantly.
    refetchInterval: (query) => {
      const sessions = query.state.data;
      if (!sessions || sessions.length === 0) return false;
      const boundaries = sessions
        .map((s) => s.state.nextBoundaryAt)
        .filter((b): b is string => Boolean(b))
        .map((b) => new Date(b).getTime());
      if (boundaries.length === 0) return false;
      const ms = Math.min(...boundaries) - Date.now();
      return ms > 0 ? ms + 250 : 500;
    },
  });

  const encoderSessions = useMemo(() => allSessions?.filter((s) => s.encoderId === encoderId) ?? [], [allSessions, encoderId]);
  const encoderClosed = encoderSessions.length > 0 && !encoderSessions.some((s) => s.state.isOpen);

  // --- Schedule CRUD (New schedule / Edit modal) ---
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE);

  function openCreateModal() {
    setEditingId(null);
    setScheduleForm({ ...EMPTY_SCHEDULE, encoderId });
    setModalOpen(true);
  }

  function openEditModal(s: AttendanceSession) {
    setEditingId(s.id);
    setScheduleForm({
      encoderId: s.encoderId,
      zoneId: s.zoneId ?? "",
      label: s.label,
      description: s.description ?? "",
      daysOfWeek: s.daysOfWeek,
      startTime: s.startTime ?? "",
      endTime: s.endTime ?? "",
      mode: s.mode,
    });
    setModalOpen(true);
  }

  const saveSchedule = useMutation({
    mutationFn: async () => {
      const body = {
        encoderId: scheduleForm.encoderId,
        zoneId: scheduleForm.zoneId || null,
        label: scheduleForm.label.trim(),
        description: scheduleForm.description.trim() || null,
        daysOfWeek: scheduleForm.daysOfWeek,
        startTime: scheduleForm.startTime || null,
        endTime: scheduleForm.endTime || null,
        mode: scheduleForm.mode,
      };
      return editingId
        ? (await api.patch<AttendanceSession>(`/attendance-sessions/${editingId}`, body)).data
        : (await api.post<AttendanceSession>("/attendance-sessions", body)).data;
    },
    onSuccess: () => {
      toast.success(editingId ? "Schedule updated" : "Schedule created");
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save schedule")),
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => api.delete(`/attendance-sessions/${id}`),
    onSuccess: () => {
      toast.success("Schedule deleted");
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete schedule")),
  });

  const setOverride = useMutation({
    mutationFn: async ({ id, manualOverride }: { id: string; manualOverride: ManualOverride }) =>
      (await api.patch<AttendanceSession>(`/attendance-sessions/${id}/override`, { manualOverride })).data,
    onSuccess: (_data, { manualOverride }) => {
      toast.success(
        manualOverride === "FORCE_OPEN" ? "Schedule started" : manualOverride === "FORCE_CLOSED" ? "Schedule stopped" : "Schedule resumed"
      );
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the schedule")),
  });

  function handleScheduleSubmit(e: FormEvent) {
    e.preventDefault();
    saveSchedule.mutate();
  }

  function toggleDay(day: number) {
    setScheduleForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day) ? f.daysOfWeek.filter((d) => d !== day) : [...f.daysOfWeek, day].sort((a, b) => a - b),
    }));
  }

  const now = useNow(1000);

  function pushFeed(message: string, tone: FeedEntry["tone"]) {
    setFeed((prev) => [{ id: crypto.randomUUID(), at: new Date(), message, tone }, ...prev].slice(0, 50));
  }

  const record = useMutation({
    mutationFn: async (cardId: string) =>
      (
        await api.post<AttendanceRecord>("/attendance", {
          cardId,
          zoneId: sessionZoneId || undefined,
          encoderId: encoderId || undefined,
        })
      ).data,
    onSuccess: (rec) => {
      const name = rec.holder?.fullName ?? rec.card?.label ?? rec.card?.uid ?? "Unknown";
      pushFeed(`${name} — ${rec.type === "CHECK_IN" ? "checked in" : "checked out"}`, "SUCCESS");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => pushFeed(apiErrorMessage(err, "Could not record attendance"), "FAILED"),
  });

  // --- Manual entry (lost/unavailable physical card) ---
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualHolderSearch, setManualHolderSearch] = useState("");
  const [manualHolderSearchDebounced, setManualHolderSearchDebounced] = useState("");
  const [manualHolderId, setManualHolderId] = useState("");
  const [manualZoneId, setManualZoneId] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setManualHolderSearchDebounced(manualHolderSearch), 250);
    return () => clearTimeout(timeout);
  }, [manualHolderSearch]);

  const { data: manualHolderResults } = useQuery({
    queryKey: ["holders-search", manualHolderSearchDebounced],
    queryFn: async () =>
      (await api.get<CardHolder[]>("/holders", { params: { search: manualHolderSearchDebounced || undefined, limit: 8 } })).data,
    enabled: manualModalOpen,
  });

  function openManualModal() {
    setManualHolderSearch("");
    setManualHolderId("");
    setManualZoneId("");
    setManualModalOpen(true);
  }

  const recordManual = useMutation({
    mutationFn: async () =>
      (
        await api.post<AttendanceRecord>("/attendance/manual", {
          holderId: manualHolderId,
          zoneId: manualZoneId || undefined,
        })
      ).data,
    onSuccess: (rec) => {
      toast.success(`${rec.holder?.fullName ?? "Holder"} manually ${rec.type === "CHECK_IN" ? "checked in" : "checked out"}`);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setManualModalOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not record manual attendance")),
  });

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    recordManual.mutate();
  }

  useEffect(() => {
    if (!socket) return;

    async function onCardDetected(payload: { encoderId: string; uid?: string }) {
      if (payload.encoderId !== encoderId) return;
      if (!payload.uid) {
        pushFeed("Card detected but the reader didn't report a UID — try tapping again", "FAILED");
        return;
      }
      try {
        const { data } = await api.get<PaginatedResponse<Card>>("/cards", { params: { search: payload.uid, pageSize: 1 } });
        const card = data.data.find((c) => c.uid.toLowerCase() === payload.uid!.toLowerCase());
        if (!card) {
          pushFeed(`Unrecognized card ${payload.uid.toUpperCase()} — register it first`, "FAILED");
          return;
        }
        record.mutate(card.id);
      } catch {
        pushFeed("Could not look up the tapped card", "FAILED");
      }
    }

    socket.on("card:detected", onCardDetected);
    return () => {
      socket.off("card:detected", onCardDetected);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, encoderId, sessionZoneId]);

  const selectedEncoder = encoders?.find((e) => e.id === encoderId);

  const attendanceFilterParams = {
    zoneId: filterZoneId || undefined,
    type: filterType || undefined,
    sessionId: filterSessionId || undefined,
    // "To" is a whole-day picker — push it to the end of that day so the
    // filter includes everything recorded on it, not just up to midnight.
    from: filterFrom ? `${filterFrom}T00:00:00.000` : undefined,
    to: filterTo ? `${filterTo}T23:59:59.999` : undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", { page, ...attendanceFilterParams }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<AttendanceRecord>>("/attendance", {
          params: { page, pageSize: 25, ...attendanceFilterParams },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadCsv("/attendance/export", attendanceFilterParams, `attendance-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Exports one saved schedule's history as its own file, filtered by
  // sessionId — separate from the "Export CSV" button above, which exports
  // whatever the on-screen filters currently select.
  async function handleExportSchedule(s: AttendanceSession) {
    const filename = `attendance-${s.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      await downloadCsv("/attendance/export", { sessionId: s.id }, filename);
    } catch {
      toast.error("Export failed");
    }
  }

  // --- Edit a single record ---
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editType, setEditType] = useState<"CHECK_IN" | "CHECK_OUT">("CHECK_IN");
  const [editRecordedAt, setEditRecordedAt] = useState("");

  function openRecordEditModal(r: AttendanceRecord) {
    setEditingRecord(r);
    setEditType(r.type);
    // datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not the ISO/UTC
    // string the API returns.
    const d = new Date(r.recordedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditRecordedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }

  const updateRecord = useMutation({
    mutationFn: async () =>
      (
        await api.patch<AttendanceRecord>(`/attendance/${editingRecord!.id}`, {
          type: editType,
          recordedAt: editRecordedAt ? new Date(editRecordedAt).toISOString() : undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Attendance record updated");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setEditingRecord(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the record")),
  });

  // --- Clear whatever the current filters match ---
  const hasActiveFilter = Boolean(filterSessionId || filterZoneId || filterType || filterFrom || filterTo);

  const clearFiltered = useMutation({
    mutationFn: async () => (await api.delete<{ deleted: number }>("/attendance", { params: attendanceFilterParams })).data,
    onSuccess: ({ deleted }) => {
      toast.success(`Cleared ${deleted} attendance record${deleted === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setPage(1);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not clear attendance records")),
  });

  function handleClearFiltered() {
    const count = data?.pagination.total ?? 0;
    if (
      confirm(
        `Permanently delete ${count} attendance record${count === 1 ? "" : "s"} matching the current filters? This cannot be undone.`
      )
    ) {
      clearFiltered.mutate();
    }
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Tap cards to check holders in/out — for lecture attendance, shift tracking, or event entry."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Take attendance</h3>
          <label className="label">Encoder</label>
          <select className="input mb-3" value={encoderId} onChange={(e) => setEncoderId(e.target.value)}>
            {encoders?.map((enc) => (
              <option key={enc.id} value={enc.id}>
                {enc.name}
              </option>
            ))}
          </select>
          <label className="label">Zone / session (optional)</label>
          <select className="input mb-3" value={sessionZoneId} onChange={(e) => setSessionZoneId(e.target.value)}>
            <option value="">General (no zone)</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <Badge tone={selectedEncoder?.status}>{selectedEncoder?.status ?? "—"}</Badge>
            <span className="text-xs text-slate-400">{connected ? "Live updates connected" : "Connecting..."}</span>
          </div>
          {encoderClosed && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              None of this encoder's schedules are currently open — taps will be rejected until one opens or you start one manually below.
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Radio size={15} className={record.isPending ? "animate-pulse text-brand-500" : "text-slate-300"} />
            Waiting for a tap...
          </div>
          <p className="mt-3 text-xs text-slate-400">
            By default each tap alternates check-in/check-out for that holder, tracked independently per zone — set a
            stricter mode on a schedule below to limit repeat taps.
          </p>
          <button type="button" className="btn-secondary mt-4 w-full" onClick={openManualModal}>
            <UserCog size={16} /> Manual entry (lost card)
          </button>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Live feed</h3>
          <div className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
            {feed.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <span className="text-slate-400">{entry.at.toLocaleTimeString()}</span>
                <span className={entry.tone === "SUCCESS" ? "text-emerald-600" : "text-red-600"}>{entry.message}</span>
              </div>
            ))}
            {feed.length === 0 && <p className="text-slate-400">No taps yet.</p>}
          </div>
        </div>
      </div>

      <div className="card mb-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Saved schedules</h3>
            <p className="text-xs text-slate-400">
              One encoder can host several independent schedules — like a lecture hall with different courses through
              the week.
            </p>
          </div>
          <button className="btn-primary whitespace-nowrap" onClick={openCreateModal}>
            <Plus size={16} /> New schedule
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-ink-800/60">
            <tr>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Encoder</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {allSessions?.map((s) => {
              const countdownMs = s.state.nextBoundaryAt ? new Date(s.state.nextBoundaryAt).getTime() - now.getTime() : null;
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.label}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-500" title={s.description ?? undefined}>
                    {s.description || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{s.encoder?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.daysOfWeek.length > 0 ? s.daysOfWeek.map((d) => DAY_LABELS[d]).join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500" title={MODE_HELP[s.mode]}>
                    {MODE_LABELS[s.mode]}
                  </td>
                  <td className="px-4 py-3">
                    <span title={STATE_LABELS[s.state.reason]}>
                      <Badge tone={s.state.isOpen ? "ACTIVE" : "BLOCKED"}>{s.state.isOpen ? "Open" : "Closed"}</Badge>
                    </span>
                    {countdownMs !== null && countdownMs > 0 && (
                      <div className="mt-0.5 font-mono text-xs text-slate-400">
                        {formatCountdown(countdownMs)} {s.state.isOpen ? "left" : "to open"}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.manualOverride !== "FORCE_OPEN" && (
                        <button
                          className="text-slate-400 hover:text-emerald-600"
                          title="Start now"
                          disabled={setOverride.isPending}
                          onClick={() => setOverride.mutate({ id: s.id, manualOverride: "FORCE_OPEN" })}
                        >
                          <Play size={15} />
                        </button>
                      )}
                      {s.manualOverride !== "FORCE_CLOSED" && (
                        <button
                          className="text-slate-400 hover:text-red-600"
                          title="Stop now"
                          disabled={setOverride.isPending}
                          onClick={() => setOverride.mutate({ id: s.id, manualOverride: "FORCE_CLOSED" })}
                        >
                          <Square size={15} />
                        </button>
                      )}
                      {s.manualOverride !== "NONE" && (
                        <button
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          title="Resume schedule"
                          disabled={setOverride.isPending}
                          onClick={() => setOverride.mutate({ id: s.id, manualOverride: "NONE" })}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      <button
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        title="Export this schedule's attendance as its own CSV"
                        onClick={() => handleExportSchedule(s)}
                      >
                        <Download size={15} />
                      </button>
                      <button
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        title="Edit schedule"
                        onClick={() => openEditModal(s)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="text-slate-400 hover:text-red-600"
                        title="Delete schedule"
                        onClick={() => {
                          if (confirm(`Delete "${s.label}"? This cannot be undone.`)) deleteSchedule.mutate(s.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {allSessions?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No schedules saved yet — click "New schedule" to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input w-52"
            value={filterSessionId}
            onChange={(e) => {
              setFilterSessionId(e.target.value);
              setPage(1);
            }}
            title="Filter by which saved schedule the attendance was taken under"
          >
            <option value="">All schedules</option>
            {allSessions?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} {s.encoder?.name ? `(${s.encoder.name})` : ""}
              </option>
            ))}
          </select>
          <select
            className="input w-52"
            value={filterZoneId}
            onChange={(e) => {
              setFilterZoneId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All zones</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <select
            className="input w-40"
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Check-in & out</option>
            <option value="CHECK_IN">Check-in only</option>
            <option value="CHECK_OUT">Check-out only</option>
          </select>
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="date"
              className="input w-40"
              title="From date"
              value={filterFrom}
              onChange={(e) => {
                setFilterFrom(e.target.value);
                setPage(1);
              }}
            />
            <span>–</span>
            <input
              type="date"
              className="input w-40"
              title="To date"
              value={filterTo}
              onChange={(e) => {
                setFilterTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {(filterSessionId || filterZoneId || filterType || filterFrom || filterTo) && (
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={() => {
                setFilterSessionId("");
                setFilterZoneId("");
                setFilterType("");
                setFilterFrom("");
                setFilterTo("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-red-600"
            onClick={handleClearFiltered}
            disabled={!hasActiveFilter || clearFiltered.isPending}
            title={hasActiveFilter ? "Permanently delete every record matching the current filters" : "Select at least one filter to clear"}
          >
            {clearFiltered.isPending ? <Spinner className="h-4 w-4" /> : <Eraser size={16} />} Clear filtered
          </button>
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} Export CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-ink-800/60">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">ID number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Card</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-slate-500">{format(new Date(r.recordedAt), "MMM d, HH:mm:ss")}</td>
                  <td className="px-4 py-3 font-medium">{r.holder?.fullName ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{r.holder?.employeeId ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.type === "CHECK_IN" ? "ACTIVE" : undefined}>{r.type === "CHECK_IN" ? "Check-in" : "Check-out"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.sessionLabel ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.zone?.name ?? "General"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.manualEntry ? (
                      <span
                        title={r.recordedByUser ? `Manually entered by ${r.recordedByUser.fullName} — card was lost/unavailable` : "Manually entered"}
                      >
                        <Badge tone="PENDING">Manual</Badge>
                      </span>
                    ) : (
                      r.card?.label ?? r.card?.uid ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="Edit this record"
                      onClick={() => openRecordEditModal(r)}
                    >
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No attendance records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              <span className="text-slate-400">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} entries)
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit schedule" : "New schedule"}>
        <form onSubmit={handleScheduleSubmit} className="space-y-3">
          <div>
            <label className="label">Encoder</label>
            <select
              className="input"
              required
              value={scheduleForm.encoderId}
              onChange={(e) => setScheduleForm((f) => ({ ...f, encoderId: e.target.value }))}
            >
              <option value="">Select an encoder…</option>
              {encoders?.map((enc) => (
                <option key={enc.id} value={enc.id}>
                  {enc.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Label</label>
            <input
              className="input"
              required
              placeholder="e.g. CS101 Lecture, or Front Desk Shift"
              value={scheduleForm.label}
              onChange={(e) => setScheduleForm((f) => ({ ...f, label: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-400">
              Required — identifies this schedule, e.g. the subject or department taking attendance.
            </p>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. Room 204, Tuesdays/Thursdays only during exam weeks"
              value={scheduleForm.description}
              onChange={(e) => setScheduleForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Zone / session (optional)</label>
            <select className="input" value={scheduleForm.zoneId} onChange={(e) => setScheduleForm((f) => ({ ...f, zoneId: e.target.value }))}>
              <option value="">General (no zone)</option>
              {zones?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select
              className="input"
              value={scheduleForm.mode}
              onChange={(e) => setScheduleForm((f) => ({ ...f, mode: e.target.value as AttendanceMode }))}
            >
              {(Object.keys(MODE_LABELS) as AttendanceMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">{MODE_HELP[scheduleForm.mode]}</p>
          </div>
          <div>
            <label className="label">Days</label>
            <div className="flex flex-wrap gap-1">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className={scheduleForm.daysOfWeek.includes(i) ? "btn-primary px-2 py-1 text-xs" : "btn-secondary px-2 py-1 text-xs"}
                  onClick={() => toggleDay(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="label">Start time</label>
              <input
                type="time"
                className="input"
                value={scheduleForm.startTime}
                onChange={(e) => setScheduleForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className="flex-1">
              <label className="label">End time</label>
              <input
                type="time"
                className="input"
                value={scheduleForm.endTime}
                onChange={(e) => setScheduleForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={saveSchedule.isPending || !scheduleForm.encoderId || !scheduleForm.label.trim()}
          >
            {saveSchedule.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Save size={16} />}
            {editingId ? "Save changes" : "Create schedule"}
          </button>
          <p className="text-xs text-slate-400">
            Leave days and times blank for a schedule that's always open until you stop it manually.
          </p>
        </form>
      </Modal>

      <Modal open={manualModalOpen} onClose={() => setManualModalOpen(false)} title="Manual attendance entry">
        <form onSubmit={handleManualSubmit} className="space-y-3">
          <p className="text-xs text-slate-400">
            For when a holder's physical card is lost or unavailable — records a check-in/check-out directly against
            them, no card needed, until a replacement card is issued.
          </p>
          <div>
            <label className="label">Card holder</label>
            <input
              className="input"
              placeholder="Search by name, ID number, or email…"
              value={manualHolderSearch}
              onChange={(e) => {
                setManualHolderSearch(e.target.value);
                setManualHolderId("");
              }}
            />
            {manualHolderSearch && !manualHolderId && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                {manualHolderResults?.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-ink-800"
                    onClick={() => {
                      setManualHolderId(h.id);
                      setManualHolderSearch(h.fullName);
                    }}
                  >
                    <span className="font-medium">{h.fullName}</span>
                    {h.employeeId && <span className="ml-2 text-xs text-slate-400">{h.employeeId}</span>}
                  </button>
                ))}
                {manualHolderResults?.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-400">No matching card holders.</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="label">Zone / session (optional)</label>
            <select className="input" value={manualZoneId} onChange={(e) => setManualZoneId(e.target.value)}>
              <option value="">General (no zone)</option>
              {zones?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={recordManual.isPending || !manualHolderId}>
            {recordManual.isPending ? <Spinner className="h-4 w-4 text-white" /> : <UserCog size={16} />}
            Record manual attendance
          </button>
        </form>
      </Modal>

      <Modal open={Boolean(editingRecord)} onClose={() => setEditingRecord(null)} title="Edit attendance record">
        {editingRecord && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateRecord.mutate();
            }}
            className="space-y-3"
          >
            <p className="text-xs text-slate-400">
              {editingRecord.holder?.fullName ?? "This holder"} —{" "}
              {editingRecord.manualEntry ? "manually entered" : editingRecord.card?.label ?? editingRecord.card?.uid ?? "no card"}
            </p>
            <div>
              <label className="label">Type</label>
              <select className="input" value={editType} onChange={(e) => setEditType(e.target.value as "CHECK_IN" | "CHECK_OUT")}>
                <option value="CHECK_IN">Check-in</option>
                <option value="CHECK_OUT">Check-out</option>
              </select>
            </div>
            <div>
              <label className="label">Recorded at</label>
              <input
                type="datetime-local"
                className="input"
                value={editRecordedAt}
                onChange={(e) => setEditRecordedAt(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={updateRecord.isPending}>
              {updateRecord.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Save size={16} />}
              Save changes
            </button>
            <p className="text-xs text-slate-400">
              This corrects the record directly — it doesn't re-run check-in/check-out alternation, so make sure the
              new type still makes sense next to this holder's other records in this zone.
            </p>
          </form>
        )}
      </Modal>
    </div>
  );
}
