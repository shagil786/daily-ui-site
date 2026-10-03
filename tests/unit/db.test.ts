import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDay, getDb, getLatestDay, listDays, setDbForTesting, upsertDay } from "../../lib/db";

type DayInput = Parameters<typeof upsertDay>[1];

const tmpDirs: string[] = [];
let originalDatabasePath: string | undefined;

beforeAll(() => {
  originalDatabasePath = process.env.DATABASE_PATH;
});

afterEach(() => {
  if (originalDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = originalDatabasePath;
  }
});

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Unique file path in a fresh temp dir (cleaned up in afterAll). */
function tmpDbPath(fileName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "days-db-test-"));
  tmpDirs.push(dir);
  return path.join(dir, fileName);
}

function day(date: string, overrides: Partial<DayInput> = {}): DayInput {
  return {
    date,
    json: JSON.stringify({ title: `Title for ${date}` }),
    directive: "celebrate",
    stale: false,
    ...overrides,
  };
}

describe("setDbForTesting", () => {
  const override = getDb(":memory:");

  afterEach(() => {
    setDbForTesting(undefined);
  });

  it("getDb returns the override while it is set", () => {
    setDbForTesting(override);
    upsertDay(override, day("2026-10-01"));

    expect(getDay(getDb(), "2026-10-01")).toBeDefined();
    expect(listDays(getDb())).toHaveLength(1);
  });

  it("clearing the override restores normal memoized resolution", () => {
    setDbForTesting(override);
    setDbForTesting(undefined);

    const file = tmpDbPath("cleared.db");
    const resolved = getDb(file);
    expect(resolved).not.toBe(override);
    expect(getDb(file)).toBe(resolved); // memoized again, not the override
    expect(listDays(resolved)).toEqual([]);
  });
});

describe("getDb", () => {
  it("returns the same connection for the same path (memoized)", () => {
    const file = tmpDbPath("memo.db");
    expect(getDb(file)).toBe(getDb(file));
  });

  it("returns separate connections for separate paths", () => {
    const a = getDb(tmpDbPath("a.db"));
    const b = getDb(tmpDbPath("b.db"));
    expect(a).not.toBe(b);
  });

  it("opens the file named by env DATABASE_PATH by default", () => {
    const file = tmpDbPath("from-env.db");
    process.env.DATABASE_PATH = file;
    const db = getDb();
    expect(fs.existsSync(file)).toBe(true);
    expect(db).toBe(getDb()); // default path is memoized too
  });

  it("does not let an explicit path pollute the default memo", () => {
    const file = tmpDbPath("default.db");
    process.env.DATABASE_PATH = file;
    const defaultDb = getDb();
    const inMemory = getDb(":memory:");
    expect(inMemory).not.toBe(defaultDb);
    expect(getDb()).toBe(defaultDb);
    const other = getDb(tmpDbPath("other.db"));
    expect(other).not.toBe(defaultDb);
    expect(getDb()).toBe(defaultDb);
  });

  it("returns a fresh connection for ':memory:' (in-memory DBs are per-connection)", () => {
    expect(getDb(":memory:")).not.toBe(getDb(":memory:"));
  });
});

describe("upsertDay / getDay", () => {
  it("round-trips a day with the stale flag as a boolean", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-01", { stale: true }));

    const row = getDay(db, "2026-10-01");
    expect(row).toBeDefined();
    expect(row?.stale).toBe(true);
    expect(typeof row?.stale).toBe("boolean");
    expect(row?.date).toBe("2026-10-01");
    expect(row?.directive).toBe("celebrate");
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    upsertDay(db, day("2026-10-02", { stale: false }));
    expect(getDay(db, "2026-10-02")?.stale).toBe(false);
  });

  it("keeps one row when upserting the same date twice, replacing json", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-01", { json: JSON.stringify({ title: "Old" }), directive: "old" }));
    upsertDay(
      db,
      day("2026-10-01", { json: JSON.stringify({ title: "New" }), directive: "new", stale: true }),
    );

    const rows = listDays(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.directive).toBe("new");
    const row = getDay(db, "2026-10-01");
    expect(row?.json).toBe(JSON.stringify({ title: "New" }));
    expect(row?.stale).toBe(true);
  });
});

describe("getLatestDay", () => {
  it("picks 10-03 over 10-01", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-01"));
    upsertDay(db, day("2026-10-03"));
    expect(getLatestDay(db)?.date).toBe("2026-10-03");
  });

  it("with beforeDate returns the latest row strictly before that date", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-01"));
    upsertDay(db, day("2026-10-03"));
    expect(getLatestDay(db, "2026-10-02")?.date).toBe("2026-10-01");
  });

  it("with beforeDate excludes rows on the boundary date", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-01"));
    upsertDay(db, day("2026-10-03"));
    expect(getLatestDay(db, "2026-10-01")).toBeUndefined();
  });
});

describe("listDays", () => {
  it("sorts date DESC and parses the title from json", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-02", { json: JSON.stringify({ title: "Second" }) }));
    upsertDay(db, day("2026-10-01", { json: JSON.stringify({ title: "First" }), stale: true }));
    upsertDay(db, day("2026-10-03", { json: JSON.stringify({ title: "Third" }) }));

    const rows = listDays(db);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(rows.map((r) => r.title)).toEqual(["Third", "Second", "First"]);
    expect(rows.map((r) => r.directive)).toEqual(["celebrate", "celebrate", "celebrate"]);
    expect(rows.map((r) => r.stale)).toEqual([false, false, true]);
    expect(typeof rows[1]?.stale).toBe("boolean");
  });

  it("returns an empty title for parseable json without a string title", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-02", { json: JSON.stringify({ version: 1 }) }));
    upsertDay(db, day("2026-10-01", { json: JSON.stringify({ title: 42 }) }));

    expect(listDays(db).map((r) => r.title)).toEqual(["", ""]);
  });

  it("skips rows whose json is unparseable and keeps the rest", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-03", { json: "{not json" }));
    upsertDay(db, day("2026-10-02", { json: JSON.stringify({ title: "Good" }) }));
    upsertDay(db, day("2026-10-01", { json: "" }));

    expect(listDays(db).map((r) => r.date)).toEqual(["2026-10-02"]);
  });

  it("treats parseable-but-non-document json as corrupt, like the day route", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-04", { json: "null" }));
    upsertDay(db, day("2026-10-03", { json: "[]" }));
    upsertDay(db, day("2026-10-02", { json: JSON.stringify({ title: "Real" }) }));

    expect(listDays(db).map((r) => r.date)).toEqual(["2026-10-02"]);
  });

  it("does not throw when every row is corrupt", () => {
    const db = getDb(":memory:");
    upsertDay(db, day("2026-10-02", { json: "}{" }));
    expect(listDays(db)).toEqual([]);
  });
});

describe("empty database", () => {
  it("returns undefined from getDay/getLatestDay and an empty list", () => {
    const db = getDb(":memory:");
    expect(getDay(db, "2026-10-01")).toBeUndefined();
    expect(getLatestDay(db)).toBeUndefined();
    expect(getLatestDay(db, "2026-10-02")).toBeUndefined();
    expect(listDays(db)).toEqual([]);
  });
});
