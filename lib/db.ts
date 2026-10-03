import fs from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type DayRow = {
  date: string;
  json: string;
  directive: string;
  stale: boolean;
  createdAt: string;
};

/** Row as SQLite returns it: `stale` is an INTEGER 0/1 until mapped. */
type DayRowStored = {
  date: string;
  json: string;
  directive: string;
  stale: number;
  createdAt: string;
};

/** Row for queries that do not select createdAt. */
type DayListStored = Omit<DayRowStored, "createdAt">;

const CREATE_DAYS_TABLE = `CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  directive TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
)`;

const DEFAULT_DB_FILE = "./data/days.db";

const connections = new Map<string, Database.Database>();

/**
 * Test-only override installed by `setDbForTesting`. Production code never
 * sets it; tests inject a seeded in-memory database so route handlers (which
 * call `getDb()` with no arguments) read/write that instance.
 */
let testOverride: Database.Database | undefined;

/**
 * Seam for tests only (used by `tests/unit/api.test.ts`): while a db is set,
 * every `getDb()` call returns it; `setDbForTesting(undefined)` clears the
 * override and restores the normal memoized-per-path behavior below.
 *
 * Production code must never call this.
 */
export function setDbForTesting(db: Database.Database | undefined): void {
  testOverride = db;
}

function createConnection(file: string): Database.Database {
  if (file !== ":memory:") {
    fs.mkdirSync(dirname(resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.exec(CREATE_DAYS_TABLE);
  return db;
}

/**
 * Opens the database, memoized per path.
 *
 * Path resolution: explicit `path` wins, else env `DATABASE_PATH`, else
 * `./data/days.db`. The parent directory is created on first open. While a
 * test override is installed (see `setDbForTesting`), it wins over all of
 * this.
 *
 * `":memory:"` is deliberately NOT memoized: an in-memory database lives only
 * as long as its connection, so sharing one memo entry across callers would
 * silently leak rows between them. Callers keep the returned handle if they
 * need the same instance (tests rely on getting a fresh, isolated database).
 */
export function getDb(path?: string): Database.Database {
  if (testOverride !== undefined) {
    return testOverride;
  }
  const envPath = process.env.DATABASE_PATH;
  const file = path !== undefined ? path : envPath || DEFAULT_DB_FILE;
  if (file === ":memory:") {
    return createConnection(file);
  }
  const cached = connections.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const db = createConnection(file);
  connections.set(file, db);
  return db;
}

/**
 * Inserts the day, or replaces json/directive/stale for an existing date
 * (one row per date). `createdAt` records the first insert and is kept on
 * conflict.
 */
export function upsertDay(db: Database.Database, row: Omit<DayRow, "createdAt">): void {
  db.prepare<[string, string, string, number, string]>(
    `INSERT INTO days (date, json, directive, stale, createdAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET json = excluded.json, directive = excluded.directive, stale = excluded.stale`,
  ).run(row.date, row.json, row.directive, row.stale ? 1 : 0, new Date().toISOString());
}

export function getDay(db: Database.Database, date: string): DayRow | undefined {
  const row = db
    .prepare<[string], DayRowStored>(
      `SELECT date, json, directive, stale, createdAt FROM days WHERE date = ?`,
    )
    .get(date);
  return row === undefined ? undefined : toDayRow(row);
}

/** Latest row overall, or — when `beforeDate` is given — latest row with `date < beforeDate`. */
export function getLatestDay(db: Database.Database, beforeDate?: string): DayRow | undefined {
  const row =
    beforeDate === undefined
      ? db
          .prepare<[], DayRowStored>(
            `SELECT date, json, directive, stale, createdAt FROM days ORDER BY date DESC LIMIT 1`,
          )
          .get()
      : db
          .prepare<[string], DayRowStored>(
            `SELECT date, json, directive, stale, createdAt FROM days WHERE date < ? ORDER BY date DESC LIMIT 1`,
          )
          .get(beforeDate);
  return row === undefined ? undefined : toDayRow(row);
}

export function listDays(
  db: Database.Database,
): Array<Pick<DayRow, "date" | "directive" | "stale"> & { title: string }> {
  const rows = db
    .prepare<[], DayListStored>(`SELECT date, json, directive, stale FROM days ORDER BY date DESC`)
    .all();
  const days: Array<Pick<DayRow, "date" | "directive" | "stale"> & { title: string }> = [];
  for (const row of rows) {
    const title = titleFromJson(row.json);
    // A row whose stored json is corrupt cannot be listed; skip that row only
    // (listings stay available) instead of discarding every row.
    if (title === undefined) {
      continue;
    }
    days.push({ date: row.date, directive: row.directive, stale: row.stale !== 0, title });
  }
  return days;
}

function toDayRow(row: DayRowStored): DayRow {
  return { ...row, stale: row.stale !== 0 };
}

/**
 * Title lives only inside the stored json; parse it on read. Returns
 * `undefined` when the json is unparseable (corrupt row) and `""` when it
 * parses but carries no string title.
 */
function titleFromJson(json: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  // A non-document (null, array, string, number) is corrupt, matching
  // GET /api/archive/[date]: both endpoints must answer the same way for the
  // same stored bytes.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  if ("title" in parsed && typeof parsed.title === "string") {
    return parsed.title;
  }
  return "";
}
