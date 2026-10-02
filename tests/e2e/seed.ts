import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb, upsertDay } from "../../lib/db";
import type { UiDocument } from "../../lib/schema";

/**
 * Shared e2e seeding state.
 *
 * The suite runs against an isolated sqlite file under `tests/e2e/.tmp`
 * (never the production `./data/days.db`), wired to the dev server through
 * the `DATABASE_PATH` env of `playwright.config.ts`'s `webServer`.
 */

/** Absolute path of the isolated sqlite file shared by server and tests. */
export const E2E_DB_PATH = path.resolve(__dirname, ".tmp", "days.db");

/** Directory holding the isolated database (removed by global-setup/teardown). */
export const E2E_TMP_DIR = path.resolve(__dirname, ".tmp");

/** Fixed secret for POST /api/generate — test-only, never a real credential. */
export const GENERATE_SECRET = "e2e-secret";

/** The reused fixture document (valid, 8 component types). */
const FIXTURE_PATH = path.resolve(__dirname, "..", "fixtures", "sample-doc.json");

/** Today's local calendar date as YYYY-MM-DD (same local-time rule as the app). */
function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export const TODAY = localDate(0);
export const YESTERDAY = localDate(1);
export const OLDER = localDate(3);
export const BOGUS_DATE = localDate(5);

/** Seed row dates, newest first — the expected `/api/archive` order. */
export const SEED_DATES = [TODAY, YESTERDAY, OLDER, BOGUS_DATE] as const;

/**
 * Upserts the fixture rows into the e2e database: today's row (flagged stale,
 * the pipeline's own "serving older content" state, so `/` shows the stale
 * badge), two plain archive days, and one day whose document contains a bogus
 * component type for the unknown-type placeholder test.
 */
export function seedFixture(): void {
  const fixture = readFileSync(FIXTURE_PATH, "utf8");
  const base = JSON.parse(fixture) as UiDocument;

  const bogus = structuredClone(base);
  const brokenNode = bogus.root.children?.find((child) => child.id === "section-glance");
  if (brokenNode !== undefined) {
    brokenNode.componentType = "MysteryWidget";
  }

  const db = getDb(E2E_DB_PATH);
  upsertDay(db, { date: TODAY, json: fixture, directive: "data-dashboard", stale: true });
  upsertDay(db, { date: YESTERDAY, json: fixture, directive: "brutalist", stale: false });
  upsertDay(db, { date: OLDER, json: fixture, directive: "pastel", stale: false });
  upsertDay(db, { date: BOGUS_DATE, json: JSON.stringify(bogus), directive: "neon-cyber", stale: false });
}
