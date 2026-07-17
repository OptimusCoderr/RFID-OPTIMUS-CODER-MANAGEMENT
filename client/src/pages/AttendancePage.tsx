import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Radio, Play, Square, RotateCcw, Save } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage, downloadCsv } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { useSocket } from "@/context/SocketContext";
import { useNow } from "@/hooks/useNow";
import { formatCountdown } from "@/lib/countdown";
import type { AccessZone, AttendanceRecord, AttendanceSession, Card, Encoder, ManualOverride, PaginatedResponse } from "@/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATE_LABELS: Record<AttendanceSession["state"]["reason"], string> = {
  manual_open: "Started manually",
  manual_closed: "Stopped manually",
  scheduled_open: "Within scheduled hours",
  scheduled_closed: "Outside scheduled hours",
  no_schedule: "No schedule set — always open",
};

interface ScheduleFormState {
  zoneId: string;
  label: string;
  description: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

const EMPTY_SCHEDULE: ScheduleFormState = { zoneId: "", label: "", description: "", daysOfWeek: [], startTime: "", endTime: "" };

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
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!encoders || encoders.length === 0) return;
    if (!encoderId) setEncoderId(encoders[0].id);
  }, [encoders, encoderId]);

  const { data: session } = useQuery({
    queryKey: ["attendance-session", encoderId],
    queryFn: async () => (await api.get<AttendanceSession | null>(`/attendance-sessions/${encoderId}`)).data,
    enabled: !!encoderId,
    // Re-fetches itself right around the next open/close boundary so the
    // isOpen/reason/badge stay correct without polling constantly.
    refetchInterval: (query) => {
      const boundary = query.state.data?.state.nextBoundaryAt;
      if (!boundary) return false;
      const ms = new Date(boundary).getTime() - Date.now();
      return ms > 0 ? ms + 250 : 500;
    },
  });

  const { data: allSessions } = useQuery({
    queryKey: ["attendance-sessions"],
    queryFn: async () => (await api.get<AttendanceSession[]>("/attendance-sessions")).data,
  });

  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE);

  useEffect(() => {
    if (session) {
      setScheduleForm({
        zoneId: session.zoneId ?? "",
        label: session.label,
        description: session.description ?? "",
        daysOfWeek: session.daysOfWeek,
        startTime: session.startTime ?? "",
        endTime: session.endTime ?? "",
      });
    } else {
      setScheduleForm(EMPTY_SCHEDULE);
    }
  }, [session, encoderId]);

  const saveSchedule = useMutation({
    mutationFn: async () =>
      (
        await api.put<AttendanceSession>(`/attendance-sessions/${encoderId}`, {
          zoneId: scheduleForm.zoneId || null,
          label: scheduleForm.label.trim(),
          description: scheduleForm.description.trim() || null,
          daysOfWeek: scheduleForm.daysOfWeek,
          startTime: scheduleForm.startTime || null,
          endTime: scheduleForm.endTime || null,
        })
      ).data,
    onSuccess: () => {
      toast.success("Session schedule saved");
      queryClient.invalidateQueries({ queryKey: ["attendance-session", encoderId] });
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save schedule")),
  });

  const setOverride = useMutation({
    mutationFn: async (manualOverride: ManualOverride) =>
      (await api.patch<AttendanceSession>(`/attendance-sessions/${encoderId}/override`, { manualOverride })).data,
    onSuccess: (_data, manualOverride) => {
      toast.success(
        manualOverride === "FORCE_OPEN"
          ? "Attendance started"
          : manualOverride === "FORCE_CLOSED"
            ? "Attendance stopped"
            : "Resumed the saved schedule"
      );
      queryClient.invalidateQueries({ queryKey: ["attendance-session", encoderId] });
      queryClient.invalidateQueries({ queryKey: ["attendance-sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the session")),
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
  const countdownMs = session?.state.nextBoundaryAt ? new Date(session.state.nextBoundaryAt).getTime() - now.getTime() : null;

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

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", { page, filterZoneId, filterType }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<AttendanceRecord>>("/attendance", {
          params: { page, pageSize: 25, zoneId: filterZoneId || undefined, type: filterType || undefined },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadCsv(
        "/attendance/export",
        { zoneId: filterZoneId || undefined, type: filterType || undefined },
        `attendance-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Tap cards to check holders in/out — for lecture attendance, shift tracking, or event entry."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
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
          {session && !session.state.isOpen && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Attendance is currently closed for this encoder — taps will be rejected until it opens or you start it manually.
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Radio size={15} className={record.isPending ? "animate-pulse text-brand-500" : "text-slate-300"} />
            Waiting for a tap...
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Each tap alternates check-in/check-out for that holder, tracked independently per zone.
          </p>
        </div>

        <div className="card p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Session schedule</h3>
          {!encoderId ? (
            <p className="text-sm text-slate-400">Select an encoder to configure its schedule.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone={session?.state.isOpen ? "ACTIVE" : "BLOCKED"}>{session?.state.isOpen ? "Open" : "Closed"}</Badge>
                <span className="text-xs text-slate-400">{session ? STATE_LABELS[session.state.reason] : "No schedule set — always open"}</span>
              </div>
              {countdownMs !== null && countdownMs > 0 && (
                <p className="mb-3 font-mono text-lg text-slate-700 dark:text-slate-200">
                  {formatCountdown(countdownMs)}
                  <span className="ml-2 text-xs font-sans text-slate-400">until {session?.state.isOpen ? "close" : "open"}</span>
                </p>
              )}

              <div className="mb-3 flex flex-wrap gap-2">
                {session?.manualOverride !== "FORCE_OPEN" && (
                  <button className="btn-secondary" onClick={() => setOverride.mutate("FORCE_OPEN")} disabled={setOverride.isPending}>
                    <Play size={14} /> Start now
                  </button>
                )}
                {session?.manualOverride !== "FORCE_CLOSED" && (
                  <button className="btn-secondary" onClick={() => setOverride.mutate("FORCE_CLOSED")} disabled={setOverride.isPending}>
                    <Square size={14} /> Stop now
                  </button>
                )}
                {session && session.manualOverride !== "NONE" && (
                  <button className="btn-secondary" onClick={() => setOverride.mutate("NONE")} disabled={setOverride.isPending}>
                    <RotateCcw size={14} /> Resume schedule
                  </button>
                )}
              </div>

              <form onSubmit={handleScheduleSubmit} className="space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
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
                    Required — this is what identifies the schedule below, e.g. the subject or department taking
                    attendance.
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
                <button type="submit" className="btn-primary w-full" disabled={saveSchedule.isPending || !scheduleForm.label.trim()}>
                  {saveSchedule.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Save size={16} />} Save schedule
                </button>
                <p className="text-xs text-slate-400">
                  Leave days and times blank for an always-open encoder. Start/Stop above overrides the schedule until resumed.
                </p>
              </form>
            </>
          )}
        </div>

        <div className="card p-5 lg:col-span-1">
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
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
          Saved schedules
        </h3>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
            <tr>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Encoder</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {allSessions?.map((s) => (
              <tr
                key={s.id}
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                onClick={() => setEncoderId(s.encoderId)}
              >
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
                <td className="px-4 py-3">
                  <Badge tone={s.state.isOpen ? "ACTIVE" : "BLOCKED"}>{s.state.isOpen ? "Open" : "Closed"}</Badge>
                </td>
              </tr>
            ))}
            {allSessions?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No schedules saved yet — configure one for an encoder above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
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
        </div>
        <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} Export CSV
        </button>
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-slate-500">{format(new Date(r.recordedAt), "MMM d, HH:mm:ss")}</td>
                  <td className="px-4 py-3 font-medium">{r.holder?.fullName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.type === "CHECK_IN" ? "ACTIVE" : undefined}>{r.type === "CHECK_IN" ? "Check-in" : "Check-out"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.zone?.name ?? "General"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.card?.label ?? r.card?.uid ?? "—"}</td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
    </div>
  );
}
