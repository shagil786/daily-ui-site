/**
 * Calendar-date helpers shared by the pages and the API routes.
 *
 * Single source of truth for the two date rules the app applies everywhere:
 * "today" is a LOCAL calendar day (never UTC), and a caller-supplied date is
 * accepted only when it is a real YYYY-MM-DD calendar date.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's local calendar date as YYYY-MM-DD.
 *
 * Local time, not UTC: a visitor in UTC-5 asking for "today" at 23:30 local
 * gets 2026-10-01, not 2026-10-02. `now` is injectable for tests.
 */
export function todayLocal(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Strict YYYY-MM-DD: correct shape AND a real calendar date (2026-02-30 fails). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}