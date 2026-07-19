import { describe, it, expect } from "vitest";
import { computeSessionState, computeEncoderOpenState, nextAttendanceType, type SessionScheduleInput } from "./attendanceSessionService.js";

// Wednesday, 10:00 local time — a fixed reference point so schedule math
// (day-of-week, minutes-of-day) doesn't depend on when the suite runs.
const WEDNESDAY_10AM = new Date(2026, 0, 7, 10, 0, 0); // 2026-01-07 is a Wednesday
const WEDNESDAY = WEDNESDAY_10AM.getDay();
const START_OF_WEDNESDAY = new Date(2026, 0, 7, 0, 0, 0);

function schedule(overrides: Partial<SessionScheduleInput> = {}): SessionScheduleInput {
  return {
    daysOfWeek: [],
    startTime: null,
    endTime: null,
    manualOverride: "NONE",
    ...overrides,
  };
}

describe("computeSessionState", () => {
  it("FORCE_OPEN wins regardless of schedule, occurrence dated to the start of today", () => {
    const state = computeSessionState(
      schedule({ manualOverride: "FORCE_OPEN", daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "10:00" }),
      WEDNESDAY_10AM
    );
    expect(state).toEqual({ isOpen: true, reason: "manual_open", nextBoundaryAt: null, occurrenceStartedAt: START_OF_WEDNESDAY });
  });

  it("FORCE_CLOSED wins regardless of schedule, with no countdown boundary or occurrence", () => {
    const state = computeSessionState(schedule({ manualOverride: "FORCE_CLOSED" }), WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: false, reason: "manual_closed", nextBoundaryAt: null, occurrenceStartedAt: null });
  });

  it("an empty schedule with NONE override is unrestricted (no_schedule), occurrence dated to the start of today", () => {
    const state = computeSessionState(schedule(), WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, reason: "no_schedule", nextBoundaryAt: null, occurrenceStartedAt: START_OF_WEDNESDAY });
  });

  it("is open while now falls inside today's scheduled window, counting down to close, occurrence dated to today's start time", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(true);
    expect(state.reason).toBe("scheduled_open");
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 7, 11, 0, 0));
    expect(state.occurrenceStartedAt).toEqual(new Date(2026, 0, 7, 9, 0, 0));
  });

  it("is closed before today's window starts, counting down to open, with no occurrence yet", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "14:00", endTime: "16:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe("scheduled_closed");
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 7, 14, 0, 0));
    expect(state.occurrenceStartedAt).toBeNull();
  });

  it("is closed after today's window ends, counting down to the next scheduled day", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "07:00", endTime: "08:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe("scheduled_closed");
    // Next Wednesday, since today is the only scheduled day and its window already passed.
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 14, 7, 0, 0));
  });

  it("is closed on a day that isn't scheduled, counting down to the nearest scheduled day", () => {
    const friday = (WEDNESDAY + 2) % 7;
    const state = computeSessionState(schedule({ daysOfWeek: [friday], startTime: "09:00", endTime: "10:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(false);
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 9, 9, 0, 0)); // this Friday
  });

  it("a misconfigured window (endTime <= startTime) never opens and reports no countdown", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "10:00", endTime: "09:00" }), WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null, occurrenceStartedAt: null });
  });

  it("picks the earliest of multiple scheduled days", () => {
    const thursday = (WEDNESDAY + 1) % 7;
    const state = computeSessionState(
      schedule({ daysOfWeek: [thursday, WEDNESDAY], startTime: "07:00", endTime: "08:00" }),
      WEDNESDAY_10AM
    );
    // Wednesday's window already passed today, so the next one is tomorrow (Thursday).
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 8, 7, 0, 0));
  });
});

describe("computeEncoderOpenState", () => {
  it("an encoder with zero schedules is unrestricted", () => {
    expect(computeEncoderOpenState([], WEDNESDAY_10AM)).toEqual({ isOpen: true, openSessionId: null, occurrenceStartedAt: null });
  });

  it("is open if any one of several schedules is open — like a lecture hall hosting multiple courses", () => {
    const closedCourse = { id: "cs101", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "07:00", endTime: "08:00" }) };
    const openCourse = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const state = computeEncoderOpenState([closedCourse, openCourse], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, openSessionId: "math201", occurrenceStartedAt: new Date(2026, 0, 7, 9, 0, 0) });
  });

  it("is closed only when every schedule is closed", () => {
    const courseA = { id: "cs101", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "07:00", endTime: "08:00" }) };
    const courseB = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "14:00", endTime: "16:00" }) };
    const state = computeEncoderOpenState([courseA, courseB], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: false, openSessionId: null, occurrenceStartedAt: null });
  });

  it("a manually stopped schedule doesn't prevent a sibling schedule from being open", () => {
    const stopped = { id: "cs101", ...schedule({ manualOverride: "FORCE_CLOSED", daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const open = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const state = computeEncoderOpenState([stopped, open], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, openSessionId: "math201", occurrenceStartedAt: new Date(2026, 0, 7, 9, 0, 0) });
  });
});

describe("nextAttendanceType", () => {
  it("FREE alternates forever, same as the original unrestricted behavior", () => {
    expect(nextAttendanceType("FREE", null)).toEqual({ type: "CHECK_IN" });
    expect(nextAttendanceType("FREE", { type: "CHECK_IN", recordedAt: WEDNESDAY_10AM })).toEqual({ type: "CHECK_OUT" });
    expect(nextAttendanceType("FREE", { type: "CHECK_OUT", recordedAt: WEDNESDAY_10AM })).toEqual({ type: "CHECK_IN" });
  });

  it("CHECK_IN_ONLY allows a single check-in, then rejects every further tap", () => {
    expect(nextAttendanceType("CHECK_IN_ONLY", null)).toEqual({ type: "CHECK_IN" });
    const rejected = nextAttendanceType("CHECK_IN_ONLY", { type: "CHECK_IN", recordedAt: WEDNESDAY_10AM });
    expect(rejected).toMatchObject({ rejected: true });
  });

  it("CHECK_OUT_ONLY allows a single check-out, then rejects every further tap", () => {
    expect(nextAttendanceType("CHECK_OUT_ONLY", null)).toEqual({ type: "CHECK_OUT" });
    const rejected = nextAttendanceType("CHECK_OUT_ONLY", { type: "CHECK_OUT", recordedAt: WEDNESDAY_10AM });
    expect(rejected).toMatchObject({ rejected: true });
  });

  it("ONCE allows exactly one check-in then one check-out, then rejects a third tap", () => {
    expect(nextAttendanceType("ONCE", null)).toEqual({ type: "CHECK_IN" });
    expect(nextAttendanceType("ONCE", { type: "CHECK_IN", recordedAt: WEDNESDAY_10AM })).toEqual({ type: "CHECK_OUT" });
    const rejected = nextAttendanceType("ONCE", { type: "CHECK_OUT", recordedAt: WEDNESDAY_10AM });
    expect(rejected).toMatchObject({ rejected: true });
  });

  describe("DAILY_CHECK_IN — course/class attendance: one check-in per occurrence, no check-out expected", () => {
    const occurrenceStartedAt = new Date(2026, 0, 7, 9, 0, 0); // today's (Wednesday's) window opened at 09:00
    const mondayCheckIn = new Date(2026, 0, 5, 9, 5, 0); // a check-in from Monday's occurrence (a previous day)

    it("checks in on the first tap of the occurrence", () => {
      expect(nextAttendanceType("DAILY_CHECK_IN", null, occurrenceStartedAt)).toEqual({ type: "CHECK_IN" });
    });

    it("rejects a repeat tap within the same still-open occurrence — no check-out concept", () => {
      const alreadyToday = { type: "CHECK_IN" as const, recordedAt: new Date(2026, 0, 7, 9, 10, 0) };
      const rejected = nextAttendanceType("DAILY_CHECK_IN", alreadyToday, occurrenceStartedAt);
      expect(rejected).toMatchObject({ rejected: true, reason: expect.stringMatching(/already checked in/i) });
    });

    it("MCT101 meets Monday and Tuesday — Monday's check-in doesn't block Tuesday's (or in this case Wednesday's) fresh check-in", () => {
      // last.recordedAt (Monday) predates this occurrence's start (Wednesday
      // 09:00) — a new occurrence, so it's treated as a fresh check-in
      // instead of being read as "already checked in" or flipped to a
      // check-out the way FREE mode would.
      const last = { type: "CHECK_IN" as const, recordedAt: mondayCheckIn };
      expect(nextAttendanceType("DAILY_CHECK_IN", last, occurrenceStartedAt)).toEqual({ type: "CHECK_IN" });
    });

    it("with no occurrence boundary available, a prior check-in is treated as still current (rejected)", () => {
      const last = { type: "CHECK_IN" as const, recordedAt: mondayCheckIn };
      const rejected = nextAttendanceType("DAILY_CHECK_IN", last, null);
      expect(rejected).toMatchObject({ rejected: true });
    });
  });
});
