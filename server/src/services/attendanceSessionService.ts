import type { AttendanceMode, AttendanceType, ManualOverride } from "@prisma/client";

export interface SessionScheduleInput {
  // 0 = Sunday .. 6 = Saturday.
  daysOfWeek: number[];
  // "HH:mm", 24-hour, server-local time.
  startTime: string | null;
  endTime: string | null;
  manualOverride: ManualOverride;
}

export interface SessionState {
  isOpen: boolean;
  reason: "manual_open" | "manual_closed" | "scheduled_open" | "scheduled_closed" | "no_schedule";
  // When the current state will next flip on its own — null while a manual
  // override holds (it lasts until explicitly cleared back to NONE) or when
  // there's no schedule configured at all.
  nextBoundaryAt: Date | null;
  // The start of *this* open occurrence — today's configured start time for
  // "scheduled_open", or the start of today for "manual_open"/"no_schedule"
  // (neither has a natural start time of its own). Only meaningful while
  // isOpen; used by DAILY_CHECK_IN (see nextAttendanceType) to tell "already
  // checked in for today's session" apart from "that check-in was a
  // previous occurrence — this is a fresh day, allow it again". Always null
  // while closed.
  occurrenceStartedAt: Date | null;
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

// Pure function: given a session's schedule/override fields and the current
// time, is attendance currently accepted? Computed live on every call rather
// than by a background job flipping a stored flag, so a manual Start/Stop
// click takes effect immediately and can never be raced or clobbered by a
// cron tick — the same reasoning behind the live Card.expiresAt checks in
// attendanceService.ts and the websocket command handler.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function computeSessionState(session: SessionScheduleInput, now: Date = new Date()): SessionState {
  if (session.manualOverride === "FORCE_OPEN") {
    // No natural start time of its own — treated as "opened today" so
    // DAILY_CHECK_IN still resets once per calendar day under a manual
    // override, same as an unscheduled always-open session.
    return { isOpen: true, reason: "manual_open", nextBoundaryAt: null, occurrenceStartedAt: startOfDay(now) };
  }
  if (session.manualOverride === "FORCE_CLOSED") {
    return { isOpen: false, reason: "manual_closed", nextBoundaryAt: null, occurrenceStartedAt: null };
  }

  const hasSchedule = session.daysOfWeek.length > 0 && !!session.startTime && !!session.endTime;
  if (!hasSchedule) {
    return { isOpen: true, reason: "no_schedule", nextBoundaryAt: null, occurrenceStartedAt: startOfDay(now) };
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
    return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null, occurrenceStartedAt: null };
  }

  if (days.has(now.getDay())) {
    const todayStart = atMinutesOnDate(now, startMinutes);
    const todayEnd = atMinutesOnDate(now, endMinutes);
    if (now >= todayStart && now < todayEnd) {
      return { isOpen: true, reason: "scheduled_open", nextBoundaryAt: todayEnd, occurrenceStartedAt: todayStart };
    }
  }

  // Closed right now — scan forward up to a week (inclusive of today, in
  // case today's window hasn't started yet, and revisiting today's weekday
  // next week as the fallback) for the next scheduled start.
  for (let offset = 0; offset <= 7; offset++) {
    const candidateDate = new Date(now);
    candidateDate.setDate(candidateDate.getDate() + offset);
    if (!days.has(candidateDate.getDay())) continue;
    const candidateStart = atMinutesOnDate(candidateDate, startMinutes);
    if (candidateStart > now) {
      return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: candidateStart, occurrenceStartedAt: null };
    }
  }

  return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null, occurrenceStartedAt: null };
}

export interface EncoderOpenState {
  isOpen: boolean;
  // Which schedule is the reason the encoder is currently open — null when
  // closed, or when open only because there are no schedules at all.
  openSessionId: string | null;
  // The winning schedule's own occurrenceStartedAt (see SessionState) —
  // null whenever openSessionId is null.
  occurrenceStartedAt: Date | null;
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
  if (sessions.length === 0) return { isOpen: true, openSessionId: null, occurrenceStartedAt: null };

  for (const session of sessions) {
    const state = computeSessionState(session, now);
    if (state.isOpen) {
      return { isOpen: true, openSessionId: session.id, occurrenceStartedAt: state.occurrenceStartedAt };
    }
  }

  return { isOpen: false, openSessionId: null, occurrenceStartedAt: null };
}

export type AttendanceTypeDecision = { type: AttendanceType } | { rejected: true; reason: string };

// Pure decision for what a tap should record, given the schedule's
// AttendanceMode and the holder's last record in this same scope. For
// CHECK_IN_ONLY/CHECK_OUT_ONLY/ONCE, `last` is scoped per-schedule (this
// specific session, not the zone it happens to share with other schedules —
// see recordAttendance) and is null the very first time this holder is seen
// under that schedule. FREE reproduces the original unlimited-alternation
// behavior exactly and stays zone-scoped, so existing schedules (all
// created before this field existed, defaulting to FREE) are unaffected.
export function nextAttendanceType(
  mode: AttendanceMode,
  last: { type: AttendanceType; recordedAt: Date } | null,
  occurrenceStartedAt: Date | null = null
): AttendanceTypeDecision {
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
      // No `last` at all, or `last` is from a previous occurrence (a prior
      // day this schedule met) — either way, this occurrence hasn't seen a
      // tap yet, so it's a fresh check-in. A repeat tap within the same
      // still-open occurrence is rejected — there's no check-out concept
      // here, unlike FREE/ONCE.
      if (!last || (occurrenceStartedAt && last.recordedAt < occurrenceStartedAt)) {
        return { type: "CHECK_IN" };
      }
      return { rejected: true, reason: "This card has already checked in for today's session" };
    case "FREE":
    default:
      return { type: last?.type === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN" };
  }
}
