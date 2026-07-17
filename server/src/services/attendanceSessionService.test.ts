import { describe, it, expect } from "vitest";
import { computeSessionState, type SessionScheduleInput } from "./attendanceSessionService.js";

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
});
