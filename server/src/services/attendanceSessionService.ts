import type { ManualOverride } from "@prisma/client";

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
export function computeSessionState(session: SessionScheduleInput, now: Date = new Date()): SessionState {
  if (session.manualOverride === "FORCE_OPEN") {
    return { isOpen: true, reason: "manual_open", nextBoundaryAt: null };
  }
  if (session.manualOverride === "FORCE_CLOSED") {
    return { isOpen: false, reason: "manual_closed", nextBoundaryAt: null };
  }

  const hasSchedule = session.daysOfWeek.length > 0 && !!session.startTime && !!session.endTime;
  if (!hasSchedule) {
    return { isOpen: true, reason: "no_schedule", nextBoundaryAt: null };
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

  if (days.has(now.getDay())) {
    const todayStart = atMinutesOnDate(now, startMinutes);
    const todayEnd = atMinutesOnDate(now, endMinutes);
    if (now >= todayStart && now < todayEnd) {
      return { isOpen: true, reason: "scheduled_open", nextBoundaryAt: todayEnd };
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
      return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: candidateStart };
    }
  }

  return { isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null };
}
