import type { AttendanceMode, AttendanceType, ManualOverride } from "@prisma/client";

export interface SessionScheduleInput {
  // 0 = Sunday .. 6 = Saturday.
  daysOfWeek: number[];
  // "HH:mm", 24-hour, server-local time.
  startTime: string | null;
  endTime: string | null;
  manualOverride: ManualOverride;
  // "YYYY-MM-DD", inclusive bounds on the days/time above — null means no
  // bound on that side (see the schema.prisma comment on AttendanceSession).
  startDate: string | null;
  endDate: string | null;
}

export interface SessionState {
  isOpen: boolean;
  reason: "manual_open" | "manual_closed" | "scheduled_open" | "scheduled_closed" | "no_schedule";
  // When the current state will next flip on its own — null while a manual
  // override holds (it lasts until explicitly cleared back to NONE) or when
  // there's no schedule configured at all.
  nextBoundaryAt: Date | null;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function atMinutesOnDate(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

// Local-time parse of a "YYYY-MM-DD" string — deliberately not `new
// Date(dateStr)`, which parses a bare date as UTC midnight and can land on
// the wrong calendar day once converted to server-local time for comparison.
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function endOfDate(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Pure function: given a session's schedule/override fields and the current
// time, is attendance currently accepted? Computed live on every call rather
// than by a background job flipping a stored flag, so a manual Start/Stop
// click takes effect immediately and can never be raced or clobbered by a
// cron tick — the same reasoning behind the live Card.expiresAt checks in
// attendanceService.ts and the websocket command handler.
export function computeSessionState(session: SessionScheduleInput, now: Date = new Date()): SessionState {
  if (session.manualOverride === "FORCE_OPEN") {
    return { isOpen: true, reason: "manual_open", nextBoundaryAt: null };
  }
  if (session.manualOverride === "FORCE_CLOSED") {
    return { isOpen: false, reason: "manual_closed", nextBoundaryAt: null };
  }

  // Google-Calendar-style "repeat weekly until <date>" bound on top of the
  // days/time recurrence below — e.g. a semester's worth of a course,
  // instead of recurring forever. Once past endDate there is no future
  // occurrence ever again, so (like the misconfigured-window case below)
  // nextBoundaryAt is null rather than a countdown to something that will
  // never actually open.
  const startDate = session.startDate ? parseDateOnly(session.startDate) : null;
  const endDate = session.endDate ? endOfDate(parseDateOnly(session.endDate)) : null;
  if (endDate && now > endDate) {
    return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null };
  }
  const beforeStart = startDate !== null && now < startDate;

  const hasSchedule = session.daysOfWeek.length > 0 && !!session.startTime && !!session.endTime;
  if (!hasSchedule) {
    if (beforeStart) return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: startDate };
    return { isOpen: true, reason: "no_schedule", nextBoundaryAt: endDate };
  }

  const startMinutes = parseTimeToMinutes(session.startTime!);
  const endMinutes = parseTimeToMinutes(session.endTime!);
  const days = new Set(session.daysOfWeek);

  // Same-day windows only (e.g. "09:00-10:00") — an endTime at or before
  // startTime is treated as a misconfigured window that never opens, rather
  // than guessing an overnight-wrap intent. It's reported the same as any
  // other closed state, but with no nextBoundaryAt: unlike a normal closed
  // wait, no future tick will ever open this window, so a countdown to a
  // start time that can never actually open would be misleading.
  if (endMinutes <= startMinutes) {
    return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null };
  }

  if (!beforeStart && days.has(now.getDay())) {
    const todayStart = atMinutesOnDate(now, startMinutes);
    const todayEnd = atMinutesOnDate(now, endMinutes);
    if (now >= todayStart && now < todayEnd) {
      return { isOpen: true, reason: "scheduled_open", nextBoundaryAt: todayEnd };
    }
  }

  // Closed right now — scan forward up to a week (inclusive of today, in
  // case today's window hasn't started yet, and revisiting today's weekday
  // next week as the fallback) for the next scheduled start. Scanning from
  // startDate instead of now when the range hasn't started yet finds the
  // first qualifying day on/after it, rather than one relative to today.
  const scanFrom = beforeStart ? startDate! : now;
  for (let offset = 0; offset <= 7; offset++) {
    const candidateDate = new Date(scanFrom);
    candidateDate.setDate(candidateDate.getDate() + offset);
    if (!days.has(candidateDate.getDay())) continue;
    const candidateStart = atMinutesOnDate(candidateDate, startMinutes);
    if (candidateStart > now) {
      if (endDate && candidateStart > endDate) break;
      return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: candidateStart };
    }
  }

  return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null };
}

export interface EncoderOpenState {
  isOpen: boolean;
  // Which schedule is the reason the encoder is currently open — null when
  // closed, or when open only because there are no schedules at all.
  openSessionId: string | null;
}

// One encoder can have many independent schedules (a lecture hall hosting
// several different courses through the week — see the AttendanceSession
// model comment). The encoder as a whole accepts a tap if ANY of its
// schedules currently does — "the door unlocks while some class is in
// session" — and stays unrestricted if it has no schedules at all, same as
// every other opt-in restriction in this app.
export function computeEncoderOpenState(
  sessions: (SessionScheduleInput & { id: string })[],
  now: Date = new Date()
): EncoderOpenState {
  if (sessions.length === 0) return { isOpen: true, openSessionId: null };

  for (const session of sessions) {
    if (computeSessionState(session, now).isOpen) {
      return { isOpen: true, openSessionId: session.id };
    }
  }

  return { isOpen: false, openSessionId: null };
}

export type AttendanceTypeDecision = { type: AttendanceType } | { rejected: true; reason: string };

// Pure decision for what a tap should record, given the schedule's
// AttendanceMode and the holder's last record in this same scope (per
// attendanceService.ts's toggleScope — `last` is null the very first time
// this holder is seen in that scope). FREE reproduces the original
// unlimited-alternation behavior exactly, so existing schedules (all
// created before this field existed, defaulting to FREE) are unaffected.
//
// CHECK_IN_ONLY/CHECK_OUT_ONLY and DAILY_CHECK_IN look identical here — both
// are "reject if `last` exists at all" — because what actually makes
// DAILY_CHECK_IN reset every meeting isn't this function, it's the caller
// scoping `last` to the *current occurrence* instead of the whole schedule
// (see recordAttendance's toggleScope). This function only ever sees
// whatever its caller already scoped `last` to.
export function nextAttendanceType(mode: AttendanceMode, last: { type: AttendanceType } | null): AttendanceTypeDecision {
  switch (mode) {
    case "CHECK_IN_ONLY":
      return last ? { rejected: true, reason: "This card has already checked in" } : { type: "CHECK_IN" };
    case "CHECK_OUT_ONLY":
      return last ? { rejected: true, reason: "This card has already checked out" } : { type: "CHECK_OUT" };
    case "ONCE":
      if (!last) return { type: "CHECK_IN" };
      if (last.type === "CHECK_IN") return { type: "CHECK_OUT" };
      return { rejected: true, reason: "This card has already checked in and out" };
    case "DAILY_CHECK_IN":
      return last ? { rejected: true, reason: "This card has already checked in for this session" } : { type: "CHECK_IN" };
    case "FREE":
    default:
      return { type: last?.type === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN" };
  }
}
