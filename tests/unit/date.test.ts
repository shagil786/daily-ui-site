import { describe, expect, it } from "vitest";
import { isCalendarDate, todayLocal } from "../../lib/date";

describe("todayLocal", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(todayLocal(new Date(2026, 9, 1))).toBe("2026-10-01");
  });

  it("zero-pads single-digit months and days", () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses local calendar fields, not UTC", () => {
    // 23:30 local on 2026-10-01 is 2026-10-02T06:30Z in UTC; the local rule wins.
    const local = new Date(2026, 9, 1, 23, 30);
    const utc = local.toISOString().slice(0, 10);
    expect(todayLocal(local)).toBe("2026-10-01");
    if (utc !== "2026-10-01") {
      expect(todayLocal(local)).not.toBe(utc);
    }
  });

  it("walks backwards with a positive offset, across a month boundary", () => {
    expect(todayLocal(new Date(2026, 2, 1), 1)).toBe("2026-02-28");
    expect(todayLocal(new Date(2026, 0, 1), 1)).toBe("2025-12-31");
  });

  it("walks forward with a negative offset", () => {
    expect(todayLocal(new Date(2026, 11, 31), -1)).toBe("2027-01-01");
  });

  it("does not mutate the caller's Date when offsetting", () => {
    const now = new Date(2026, 9, 1);
    todayLocal(now, 5);
    expect(todayLocal(now)).toBe("2026-10-01");
  });

  it("defaults to the current instant", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isCalendarDate", () => {
  it("accepts a real calendar date", () => {
    expect(isCalendarDate("2026-10-01")).toBe(true);
  });

  it("rejects a shape-valid but impossible date", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isCalendarDate("")).toBe(false);
    expect(isCalendarDate("2026-1-1")).toBe(false);
    expect(isCalendarDate("not-a-date")).toBe(false);
    expect(isCalendarDate("2026-10-01T00:00:00Z")).toBe(false);
  });
});
