import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { pickDirective } from "../../lib/directives";
import type { LlmProvider } from "../../lib/llm/provider";
import type { UiDocument } from "../../lib/schema";

/**
 * Task 11 — API route handlers, invoked directly (no HTTP server):
 * `await GET(new Request("http://x"))` style.
 *
 * Isolation strategy: every test calls a `load*()` helper that FIRST calls
 * `vi.resetModules()` and then dynamically imports `lib/db` plus the route
 * from the SAME fresh module generation. Each test therefore gets:
 *   - a clean in-memory rate-limit Map inside the generate route, and
 *   - a `setDbForTesting` override living in the same module instance the
 *     route's `getDb()` resolves, so the injected in-memory db is used.
 *
 * Provider strategy (documented choice): `lib/llm/provider`'s `createProvider`
 * is mocked via `vi.mock`, wrapping the REAL implementation, so the route's
 * env wiring (ruling 4) runs unmodified while no network call can happen.
 * Tests then stub the provider object handed to the real `generateDay`
 * pipeline — exercising more real code than mocking `generateDay` itself.
 *
 * Env: DATABASE_PATH/GENERATE_SECRET/LLM_PROVIDER/LLM_API_KEY are owned by
 * this file per test and restored in afterEach, so nothing leaks across tests.
 */

const SECRET = "test-secret";
const ENV_KEYS = ["DATABASE_PATH", "GENERATE_SECRET", "LLM_PROVIDER", "LLM_API_KEY"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const originalEnv: Partial<Record<EnvKey, string>> = {};

type ErrorBody = { error: string };
type GenerateBody = { date: string; stale: boolean; directive: string };

type DbModule = typeof import("../../lib/db");

vi.mock("../../lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/llm/provider")>();
  return { ...actual, createProvider: vi.fn(actual.createProvider) };
});

// ── helpers ────────────────────────────────────────────────────────────────

/** A document that passes validateDocument (same fixture as generate.test.ts). */
function doc(date: string, title = `Page ${date}`): UiDocument {
  return {
    version: 1,
    date,
    title,
    theme: { bg: "#0f1020", fg: "#f5f5ff", accent: "#ff3366", font: "sans", dark: true },
    root: {
      id: "root",
      componentType: "Section",
      props: { heading: "Hello" },
      children: [{ id: "t1", componentType: "Text", props: { text: "Body copy" } }],
    },
  };
}

/** Today's LOCAL calendar date (YYYY-MM-DD) — mirrors ruling 5, not UTC. */
function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Import lib/db from the current (fresh) module generation, create an
 * in-memory database, and install it as the getDb() override. Must be called
 * AFTER `vi.resetModules()` and alongside the route import so both share one
 * module generation.
 */
async function injectDb(): Promise<{ db: DbModule; handle: Database.Database }> {
  const db = await import("../../lib/db");
  const handle = db.getDb(":memory:"); // fresh: ":memory:" is never memoized
  db.setDbForTesting(handle);
  return { db, handle };
}

async function loadToday() {
  vi.resetModules();
  const route = await import("../../app/api/today/route");
  // Same provider-mock hygiene as loadGenerate: the shared createProvider mock
  // survives resetModules, so re-prime it to the REAL implementation per load —
  // the today route's spec §6 attempt must start from a clean slate (spec §6).
  const providerModule = await import("../../lib/llm/provider");
  const actual = await vi.importActual<typeof import("../../lib/llm/provider")>(
    "../../lib/llm/provider",
  );
  const createProvider = vi.mocked(providerModule.createProvider);
  createProvider.mockClear();
  createProvider.mockImplementation(actual.createProvider);
  const { db, handle } = await injectDb();
  return { route, db, handle, createProvider };
}

async function loadArchive() {
  vi.resetModules();
  const route = await import("../../app/api/archive/route");
  const { db, handle } = await injectDb();
  return { route, db, handle };
}

async function loadArchiveDay() {
  vi.resetModules();
  const route = await import("../../app/api/archive/[date]/route");
  const { db, handle } = await injectDb();
  return { route, db, handle };
}

async function loadGenerate() {
  vi.resetModules();
  const route = await import("../../app/api/generate/route");
  const providerModule = await import("../../lib/llm/provider");
  // The vi.mock factory result SURVIVES vi.resetModules(), so this single
  // createProvider mock is shared by every test in this file (vitest clears
  // call history between tests by default, but keeps implementations). Reset
  // it explicitly per load so no stub leaks from a previous test and the
  // default behavior is the REAL createProvider (ruling 4 exercises it).
  const actual = await vi.importActual<typeof import("../../lib/llm/provider")>(
    "../../lib/llm/provider",
  );
  const createProvider = vi.mocked(providerModule.createProvider);
  createProvider.mockClear();
  createProvider.mockImplementation(actual.createProvider);
  const { db, handle } = await injectDb();
  return { route, db, handle, createProvider };
}

function seed(
  db: DbModule,
  handle: Database.Database,
  date: string,
  opts: { title?: string; directive?: string; stale?: boolean; json?: string } = {},
): void {
  const json = opts.json ?? JSON.stringify(doc(date, opts.title ?? `Title ${date}`));
  db.upsertDay(handle, {
    date,
    json,
    directive: opts.directive ?? "brutalist",
    stale: opts.stale ?? false,
  });
}

function get(url = "http://x"): Request {
  return new Request(url);
}

function post(body?: unknown, secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret !== undefined) {
    headers["x-generate-secret"] = secret;
  }
  return new Request("http://x", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function archiveDayRequest(date: string): Request {
  return new Request(`http://x/api/archive/${date}`);
}

// ── env lifecycle ──────────────────────────────────────────────────────────

beforeAll(() => {
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      originalEnv[key] = value;
    }
  }
});

beforeEach(() => {
  // Routes must never reach a real file, and every test owns the secret.
  process.env.DATABASE_PATH = ":memory:";
  process.env.GENERATE_SECRET = SECRET;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_API_KEY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.useRealTimers();
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ── GET /api/today ─────────────────────────────────────────────────────────

describe("GET /api/today", () => {
  it("empty db → 404 {error:'no-ui'}", async () => {
    const { route } = await loadToday();

    const res = await route.GET(get());

    expect(res.status).toBe(404);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "no-ui" });
  });

  it("only an older day exists → 200 with that doc (latest overall)", async () => {
    const { route, db, handle } = await loadToday();
    const older = doc("2026-09-01", "Old page");
    seed(db, handle, "2026-09-01", { title: "Old page" });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect(await jsonOf<UiDocument>(res)).toEqual(older);
  });

  it("today's row present → today's doc wins over older rows", async () => {
    const { route, db, handle } = await loadToday();
    const today = localToday();
    seed(db, handle, "2026-09-01", { title: "Old page" });
    seed(db, handle, today, { title: "Today page" });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect((await jsonOf<UiDocument>(res)).date).toBe(today);
  });

  it("uses the LOCAL calendar date, not UTC (faked clock near a UTC day boundary)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:00Z → next calendar day in IST (+05:30): local 2026-03-11, UTC 2026-03-10.
    const instant = new Date("2026-03-10T20:00:00Z");
    vi.setSystemTime(instant);
    const utcDay = instant.toISOString().slice(0, 10);
    const localDay = localToday();

    const { route, db, handle } = await loadToday();
    seed(db, handle, utcDay, { title: "UTC day" });
    if (localDay !== utcDay) {
      seed(db, handle, localDay, { title: "Local day" });
    }

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    const body = await jsonOf<UiDocument>(res);
    // On any non-UTC machine a UTC implementation would return utcDay instead.
    expect(body.date).toBe(localDay);
    if (localDay !== utcDay) {
      expect(body.title).toBe("Local day");
    }
  });

  // ── spec §6: one server-side generation attempt on a miss ────────────────

  it("today missing + attempt succeeds → 200 with the fresh today doc, row stored (spec §6)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, db, handle, createProvider } = await loadToday();
    const today = localToday();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc(today)) });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect((await jsonOf<UiDocument>(res)).date).toBe(today);
    // env wiring: the attempt uses only server-held LLM_* credentials
    expect(createProvider).toHaveBeenCalledWith("openai", "test-key");
    expect(db.getDay(handle, today)).toBeDefined();
  });

  it("today missing + attempt fails + older row exists → 200 latest doc (no new error code)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, db, handle, createProvider } = await loadToday();
    seed(db, handle, "2026-09-01", { title: "Old page" });
    createProvider.mockReturnValue({ generate: async () => "not json at all" });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect((await jsonOf<UiDocument>(res)).title).toBe("Old page");
  });

  it("empty db + attempt fails → 404 {error:'no-ui'}, never a new error code (plan edge case #30)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, createProvider } = await loadToday();
    createProvider.mockReturnValue({ generate: async () => "junk" });

    const res = await route.GET(get());

    expect(res.status).toBe(404);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "no-ui" });
    expect(createProvider).toHaveBeenCalled(); // the attempt was actually made
  });

  it("LLM env missing → attempt short-circuits (provider never created), existing shapes preserved", async () => {
    // beforeEach deletes LLM_PROVIDER/LLM_API_KEY — the e2e forced-empty env case
    const { route, createProvider } = await loadToday();

    const res = await route.GET(get());

    expect(res.status).toBe(404);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "no-ui" });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("corrupt today row treated as a miss → attempt repairs it → 200 (spec §6)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, db, handle, createProvider } = await loadToday();
    const today = localToday();
    seed(db, handle, today, { json: "{broken json" });
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc(today)) });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect((await jsonOf<UiDocument>(res)).date).toBe(today);
  });

  it("corrupt today row + attempt unavailable → 500 {error:'corrupt'} (shape preserved)", async () => {
    const { route, db, handle } = await loadToday();
    seed(db, handle, localToday(), { json: "{broken json" });

    const res = await route.GET(get());

    expect(res.status).toBe(500);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "corrupt" });
  });
});

// ── GET /api/archive ───────────────────────────────────────────────────────

describe("GET /api/archive", () => {
  it("lists seeded days DESC with {date,title,directive,stale}", async () => {
    const { route, db, handle } = await loadArchive();
    seed(db, handle, "2026-10-01", { title: "First", directive: "brutalist" });
    seed(db, handle, "2026-10-03", { title: "Third", directive: "pastel", stale: true });
    seed(db, handle, "2026-10-02", { title: "Second", directive: "retro-terminal" });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect(await jsonOf<unknown>(res)).toEqual([
      { date: "2026-10-03", title: "Third", directive: "pastel", stale: true },
      { date: "2026-10-02", title: "Second", directive: "retro-terminal", stale: false },
      { date: "2026-10-01", title: "First", directive: "brutalist", stale: false },
    ]);
  });

  it("corrupt json row → skips that row instead of crashing (ruling 3)", async () => {
    const { route, db, handle } = await loadArchive();
    seed(db, handle, "2026-10-01", { title: "Good" });
    seed(db, handle, "2026-10-02", { json: "{definitely not json" });

    const res = await route.GET(get());

    expect(res.status).toBe(200);
    expect(await jsonOf<unknown>(res)).toEqual([
      { date: "2026-10-01", title: "Good", directive: "brutalist", stale: false },
    ]);
  });
});

// ── GET /api/archive/[date] ────────────────────────────────────────────────

describe("GET /api/archive/[date]", () => {
  it("existing date → 200 with the stored doc", async () => {
    const { route, db, handle } = await loadArchiveDay();
    const stored = doc("2026-10-01", "Stored page");
    seed(db, handle, "2026-10-01", { title: "Stored page" });

    const routeCtx = { params: Promise.resolve({ date: "2026-10-01" }) };
    const res = await route.GET(archiveDayRequest("2026-10-01"), routeCtx);

    expect(res.status).toBe(200);
    expect(await jsonOf<UiDocument>(res)).toEqual(stored);
  });

  it("missing date → 404 {error:'not-found'}", async () => {
    const { route } = await loadArchiveDay();

    const routeCtx = { params: Promise.resolve({ date: "1999-01-01" }) };
    const res = await route.GET(archiveDayRequest("1999-01-01"), routeCtx);

    expect(res.status).toBe(404);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "not-found" });
  });

  it("existing date but corrupt json → 500 {error:'corrupt'} (ruling 3)", async () => {
    const { route, db, handle } = await loadArchiveDay();
    seed(db, handle, "2026-10-01", { json: "{broken json" });

    const routeCtx = { params: Promise.resolve({ date: "2026-10-01" }) };
    const res = await route.GET(archiveDayRequest("2026-10-01"), routeCtx);

    expect(res.status).toBe(500);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "corrupt" });
  });

  it("parseable but non-object json → 500 {error:'corrupt'}, never 200 null", async () => {
    for (const json of ["null", "[]", '"a string"', "42"]) {
      const { route, db, handle } = await loadArchiveDay();
      seed(db, handle, "2026-10-02", { json });

      const routeCtx = { params: Promise.resolve({ date: "2026-10-02" }) };
      const res = await route.GET(archiveDayRequest("2026-10-02"), routeCtx);

      expect(res.status).toBe(500);
      expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "corrupt" });
    }
  });
});

// ── POST /api/generate ─────────────────────────────────────────────────────

describe("POST /api/generate", () => {
  it("no x-generate-secret header → 401 and provider is never created", async () => {
    const { route, createProvider } = await loadGenerate();

    const res = await route.POST(post({ date: "2026-10-05" }));

    expect(res.status).toBe(401);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "unauthorized" });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("wrong secret → 401", async () => {
    const { route, createProvider } = await loadGenerate();

    const res = await route.POST(post({ date: "2026-10-05" }, "not-the-secret"));

    expect(res.status).toBe(401);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "unauthorized" });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("GENERATE_SECRET unset → 401 even with a header present", async () => {
    delete process.env.GENERATE_SECRET;
    const { route } = await loadGenerate();

    const res = await route.POST(post({ date: "2026-10-05" }, SECRET));

    expect(res.status).toBe(401);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "unauthorized" });
  });

  it("correct secret + provider ok → 200 {date, stale:false, directive}, row stored", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, db, handle, createProvider } = await loadGenerate();
    const generate = vi.fn<LlmProvider["generate"]>(async () => JSON.stringify(doc("2026-10-05")));
    createProvider.mockReturnValue({ generate });

    const res = await route.POST(post({ date: "2026-10-05" }, SECRET));

    expect(res.status).toBe(200);
    expect(await jsonOf<GenerateBody>(res)).toEqual({
      date: "2026-10-05",
      stale: false,
      directive: pickDirective("2026-10-05").id,
    });
    // env wiring (ruling 4): provider built from env, key never logged.
    expect(createProvider).toHaveBeenCalledWith("openai", "test-key");
    expect(db.getDay(handle, "2026-10-05")?.stale).toBe(false);
  });

  it("no date in the body → defaults to local today", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, db, handle, createProvider } = await loadGenerate();
    const today = localToday();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc(today)) });

    const res = await route.POST(post(undefined, SECRET));

    expect(res.status).toBe(200);
    expect((await jsonOf<GenerateBody>(res)).date).toBe(today);
    expect(db.getDay(handle, today)).toBeDefined();
  });

  it("second POST for the same date within 10 min → 429; another date still allowed", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, createProvider } = await loadGenerate();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc("2026-10-06")) });

    const first = await route.POST(post({ date: "2026-10-06" }, SECRET));
    expect(first.status).toBe(200);

    const second = await route.POST(post({ date: "2026-10-06" }, SECRET));
    expect(second.status).toBe(429);
    expect(await jsonOf<ErrorBody>(second)).toEqual({ error: "rate-limited" });

    // rate-limit is keyed by date, not global
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc("2026-10-07")) });
    const otherDate = await route.POST(post({ date: "2026-10-07" }, SECRET));
    expect(otherDate.status).toBe(200);
    expect(createProvider).toHaveBeenCalledTimes(2); // 429 short-circuits before the provider
  });

  it("the rate-limit window is 10 minutes: a retry after the window is allowed", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, createProvider } = await loadGenerate();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc("2026-10-08")) });

    const t0 = Date.now();
    const first = await route.POST(post({ date: "2026-10-08" }, SECRET));
    expect(first.status).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 10 * 60_000 + 1_000); // just past the window

    const afterWindow = await route.POST(post({ date: "2026-10-08" }, SECRET));
    expect(afterWindow.status).toBe(200);
    expect(createProvider).toHaveBeenCalledTimes(2);
  });

  it("invalid date → 400 {error:'bad-date'} and generateDay is never reached (ruling 2)", async () => {
    const { route, createProvider } = await loadGenerate();

    for (const bad of ["2026/10/05", "05-10-2026", "2026-02-30", "banana", "2026-13-01"]) {
      const res = await route.POST(post({ date: bad }, SECRET));
      expect(res.status).toBe(400);
      expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "bad-date" });
    }
    // wrong type must not reach generateDay either
    const wrongType = await route.POST(post({ date: 20261005 }, SECRET));
    expect(wrongType.status).toBe(400);
    expect(await jsonOf<ErrorBody>(wrongType)).toEqual({ error: "bad-date" });

    expect(createProvider).not.toHaveBeenCalled();
  });

  it("non-object body or array body → 400 {error:'bad-date'}, never a silent today default", async () => {
    const { route, createProvider } = await loadGenerate();

    for (const body of [[], [{ date: "2026-10-05" }], "2026-10-05", 42, true]) {
      const res = await route.POST(post(body, SECRET));
      expect(res.status).toBe(400);
      expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "bad-date" });
    }

    expect(createProvider).not.toHaveBeenCalled();
  });

  it("a non-GenerationError failure inside the pipeline → structured 500, not a crash", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, createProvider, handle } = await loadGenerate();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc("2026-10-11")) });
    // A database-level failure inside the pipeline (closed connection) is
    // neither a GenerationError nor a provider-config problem: it must still be
    // a JSON response, not an unhandled exception.
    handle.close();

    const res = await route.POST(post({ date: "2026-10-11" }, SECRET));

    expect(res.status).toBe(500);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "internal-error" });
  });

  it("provider config failure (no LLM_PROVIDER) → 502 {error:'generation-failed'} (ruling 4)", async () => {
    const { route, createProvider } = await loadGenerate();

    const res = await route.POST(post({ date: "2026-10-09" }, SECRET));

    expect(res.status).toBe(502);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "generation-failed" });
    expect(createProvider).toHaveBeenCalledOnce(); // real createProvider threw on bad config
  });

  it("GenerationError (after the pipeline's own retry) → 502 {error:'generation-failed'}", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
    const { route, createProvider } = await loadGenerate();
    const generate = vi.fn<LlmProvider["generate"]>(async () => "not json at all");
    createProvider.mockReturnValue({ generate }); // empty db → no fallback → GenerationError

    const res = await route.POST(post({ date: "2026-10-10" }, SECRET));

    expect(res.status).toBe(502);
    expect(await jsonOf<ErrorBody>(res)).toEqual({ error: "generation-failed" });
    expect(generate).toHaveBeenCalledTimes(2); // one repair attempt before failing
  });
});
