import { describe, it, expect } from "vitest";
import { computeSessionState, computeEncoderOpenState, nextAttendanceType, type SessionScheduleInput } from "./attendanceSessionService.js";

// Wednesday, 10:00 local time — a fixed reference point so schedule math
// (day-of-week, minutes-of-day) doesn't depend on when the suite runs.
const WEDNESDAY_10AM = new Date(2026, 0, 7, 10, 0, 0); // 2026-01-07 is a Wednesday
const WEDNESDAY = WEDNESDAY_10AM.getDay();

function schedule(overrides: Partial<SessionScheduleInput> = {}): SessionScheduleInput {
  return {
    daysOfWeek: [],
    startTime: null,
    endTime: null,
    manualOverride: "NONE",
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

describe("computeSessionState", () => {
  it("FORCE_OPEN wins regardless of schedule, with no countdown boundary", () => {
    const state = computeSessionState(
      schedule({ manualOverride: "FORCE_OPEN", daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "10:00" }),
      WEDNESDAY_10AM
    );
    expect(state).toEqual({ isOpen: true, reason: "manual_open", nextBoundaryAt: null });
  });

  it("FORCE_CLOSED wins regardless of schedule, with no countdown boundary", () => {
    const state = computeSessionState(schedule({ manualOverride: "FORCE_CLOSED" }), WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: false, reason: "manual_closed", nextBoundaryAt: null });
  });

  it("an empty schedule with NONE override is unrestricted (no_schedule)", () => {
    const state = computeSessionState(schedule(), WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, reason: "no_schedule", nextBoundaryAt: null });
  });

  it("is open while now falls inside today's scheduled window, counting down to close", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(true);
    expect(state.reason).toBe("scheduled_open");
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 7, 11, 0, 0));
  });

  it("is closed before today's window starts, counting down to open", () => {
    const state = computeSessionState(schedule({ daysOfWeek: [WEDNESDAY], startTime: "14:00", endTime: "16:00" }), WEDNESDAY_10AM);
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe("scheduled_closed");
    expect(state.nextBoundaryAt).toEqual(new Date(2026, 0, 7, 14, 0, 0));
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
    expect(state).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null });
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

  describe("startDate/endDate — Google-Calendar-style \"repeat weekly until <date>\"", () => {
    it("is closed before startDate, counting down to the first qualifying day on/after it", () => {
      // 2026-02-01 is a Sunday, so the first Wednesday on/after it is 2026-02-04.
      const state = computeSessionState(
        schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "10:00", startDate: "2026-02-01" }),
        WEDNESDAY_10AM
      );
      expect(state.isOpen).toBe(false);
      expect(state.nextBoundaryAt).toEqual(new Date(2026, 1, 4, 9, 0, 0));
    });

    it("is closed for good after endDate, with no countdown — the recurrence is over", () => {
      const state = computeSessionState(
        schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "10:00", endDate: "2026-01-01" }),
        WEDNESDAY_10AM
      );
      expect(state).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null });
    });

    it("is open today when now falls within both the date range and today's window", () => {
      const state = computeSessionState(
        schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00", startDate: "2026-01-01", endDate: "2026-12-31" }),
        WEDNESDAY_10AM
      );
      expect(state.isOpen).toBe(true);
      expect(state.reason).toBe("scheduled_open");
    });

    it("reports no countdown when the only remaining occurrence would fall after endDate", () => {
      const friday = (WEDNESDAY + 2) % 7;
      const state = computeSessionState(
        schedule({ daysOfWeek: [friday], startTime: "09:00", endTime: "10:00", endDate: "2026-01-08" }), // Thursday, the day before the next Friday
        WEDNESDAY_10AM
      );
      expect(state).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null });
    });

    it("a schedule with no days/time (always open) still respects startDate/endDate", () => {
      const notYetStarted = computeSessionState(schedule({ startDate: "2026-02-01" }), WEDNESDAY_10AM);
      expect(notYetStarted).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: new Date(2026, 1, 1) });

      const stillRunning = computeSessionState(schedule({ endDate: "2026-03-01" }), WEDNESDAY_10AM);
      expect(stillRunning.isOpen).toBe(true);
      expect(stillRunning.reason).toBe("no_schedule");
      expect(stillRunning.nextBoundaryAt).toEqual(new Date(2026, 2, 1, 23, 59, 59, 999));
    });

    it("manual overrides still win regardless of the date range", () => {
      const forcedOpen = computeSessionState(schedule({ manualOverride: "FORCE_OPEN", endDate: "2025-01-01" }), WEDNESDAY_10AM);
      expect(forcedOpen).toEqual({ isOpen: true, reason: "manual_open", nextBoundaryAt: null });
    });
  });
});

describe("computeEncoderOpenState", () => {
  it("an encoder with zero schedules is unrestricted", () => {
    expect(computeEncoderOpenState([], WEDNESDAY_10AM)).toEqual({ isOpen: true, openSessionId: null });
  });

  it("is open if any one of several schedules is open — like a lecture hall hosting multiple courses", () => {
    const closedCourse = { id: "cs101", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "07:00", endTime: "08:00" }) };
    const openCourse = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const state = computeEncoderOpenState([closedCourse, openCourse], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, openSessionId: "math201" });
  });

  it("is closed only when every schedule is closed", () => {
    const courseA = { id: "cs101", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "07:00", endTime: "08:00" }) };
    const courseB = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "14:00", endTime: "16:00" }) };
    const state = computeEncoderOpenState([courseA, courseB], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: false, openSessionId: null });
  });

  it("a manually stopped schedule doesn't prevent a sibling schedule from being open", () => {
    const stopped = { id: "cs101", ...schedule({ manualOverride: "FORCE_CLOSED", daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const open = { id: "math201", ...schedule({ daysOfWeek: [WEDNESDAY], startTime: "09:00", endTime: "11:00" }) };
    const state = computeEncoderOpenState([stopped, open], WEDNESDAY_10AM);
    expect(state).toEqual({ isOpen: true, openSessionId: "math201" });
  });
});

describe("nextAttendanceType", () => {
  it("FREE alternates forever, same as the original unrestricted behavior", () => {
    expect(nextAttendanceType("FREE", null)).toEqual({ type: "CHECK_IN" });
    expect(nextAttendanceType("FREE", { type: "CHECK_IN" })).toEqual({ type: "CHECK_OUT" });
    expect(nextAttendanceType("FREE", { type: "CHECK_OUT" })).toEqual({ type: "CHECK_IN" });
  });

  it("CHECK_IN_ONLY allows a single check-in, then rejects every further tap", () => {
    expect(nextAttendanceType("CHECK_IN_ONLY", null)).toEqual({ type: "CHECK_IN" });
    const rejected = nextAttendanceType("CHECK_IN_ONLY", { type: "CHECK_IN" });
    expect(rejected).toMatchObject({ rejected: true });
  });

  it("CHECK_OUT_ONLY allows a single check-out, then rejects every further tap", () => {
    expect(nextAttendanceType("CHECK_OUT_ONLY", null)).toEqual({ type: "CHECK_OUT" });
    const rejected = nextAttendanceType("CHECK_OUT_ONLY", { type: "CHECK_OUT" });
    expect(rejected).toMatchObject({ rejected: true });
  });

  it("ONCE allows exactly one check-in then one check-out, then rejects a third tap", () => {
    expect(nextAttendanceType("ONCE", null)).toEqual({ type: "CHECK_IN" });
    expect(nextAttendanceType("ONCE", { type: "CHECK_IN" })).toEqual({ type: "CHECK_OUT" });
    const rejected = nextAttendanceType("ONCE", { type: "CHECK_OUT" });
    expect(rejected).toMatchObject({ rejected: true });
  });

  it("DAILY_CHECK_IN allows a single check-in per scope, then rejects a repeat — the caller narrows scope per occurrence", () => {
    // This function only ever sees whatever "last" its caller already scoped
    // (see recordAttendance's toggleScope) — the actual "resets every
    // meeting" behavior comes from the caller scoping `last` to the current
    // SessionOccurrence, not from anything here. So from this function's own
    // point of view, DAILY_CHECK_IN looks exactly like CHECK_IN_ONLY.
    expect(nextAttendanceType("DAILY_CHECK_IN", null)).toEqual({ type: "CHECK_IN" });
    const rejected = nextAttendanceType("DAILY_CHECK_IN", { type: "CHECK_IN" });
    expect(rejected).toMatchObject({ rejected: true, reason: expect.stringMatching(/already checked in/i) });
  });
});
