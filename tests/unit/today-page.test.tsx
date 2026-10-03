import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { UiDocument } from "../../lib/schema";

/**
 * Spec §6 / plan edge case #30 — the today PAGE render path: a missing OR
 * unparseable today row must fire one server-side generation attempt and must
 * NEVER crash. `Home` is an async server component, so tests resolve it
 * (`await Home()`) and render the resulting element; `generateMetadata` is
 * exercised directly. Logic is otherwise shared with GET /api/today (covered
 * in tests/unit/api.test.ts) and with `attemptRenderGeneration` (covered in
 * tests/unit/render-generation.test.ts).
 *
 * Isolation mirrors tests/unit/api.test.ts:
 * - `vi.mock` wraps the REAL `createProvider`; tests stub the provider handed
 *   to the REAL `generateDay` pipeline.
 * - each test calls `loadPage()` FIRST: `vi.resetModules()` + dynamic import
 *   of the page, db, and provider modules from ONE fresh generation, so the
 *   helper's cooldown Map starts empty and `setDbForTesting` points at this
 *   test's in-memory db.
 *
 * Env: DATABASE_PATH/LLM_PROVIDER/LLM_API_KEY are owned by this file and
 * restored in afterEach.
 */

const ENV_KEYS = ["DATABASE_PATH", "LLM_PROVIDER", "LLM_API_KEY"] as const;
type EnvKey = (typeof ENV_KEYS)[number];
const originalEnv: Partial<Record<EnvKey, string>> = {};

const OLDER = "2026-09-01";

vi.mock("../../lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/llm/provider")>();
  return { ...actual, createProvider: vi.fn(actual.createProvider) };
});

// doc-view's <Link> needs the App Router context, which does not exist in
// jsdom — render the anchor directly so the page shell is unchanged.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children }: { href: string; children?: React.ReactNode }) =>
      React.createElement("a", { href }, children),
  };
});

/** A document that passes validateDocument (same fixture as api.test.ts). */
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

/** Today's LOCAL calendar date (YYYY-MM-DD) — ruling 5, not UTC. */
function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type DbModule = typeof import("../../lib/db");

/**
 * Fresh module generation: resets the page's db/generate modules (cooldown
 * Map) together, re-primes the shared createProvider mock to the REAL
 * implementation, and installs this test's in-memory db as the page's getDb()
 * override. Must run BEFORE every page call in a test.
 */
async function loadPage() {
  vi.resetModules();
  const page = await import("../../app/page");
  const db = await import("../../lib/db");
  const providerModule = await import("../../lib/llm/provider");
  const actual = await vi.importActual<typeof import("../../lib/llm/provider")>(
    "../../lib/llm/provider",
  );
  const createProvider = vi.mocked(providerModule.createProvider);
  createProvider.mockClear();
  createProvider.mockImplementation(actual.createProvider);
  const handle = db.getDb(":memory:"); // ":memory:" is never memoized
  db.setDbForTesting(handle);
  return { page, db, handle, createProvider };
}

function seed(db: DbModule, handle: Database.Database, date: string, json: string): void {
  db.upsertDay(handle, { date, json, directive: "brutalist", stale: false });
}

function setLlmEnv(): void {
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_API_KEY = "test-key";
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
  process.env.DATABASE_PATH = ":memory:";
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_API_KEY;
});

afterEach(() => {
  cleanup();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ── `/` render path ────────────────────────────────────────────────────────

describe("today page (spec §6)", () => {
  it("empty db + no LLM env → 'Nothing generated yet', provider never created (plan edge #30)", async () => {
    const { page, createProvider } = await loadPage();

    render(await page.default());

    expect(screen.getByTestId("empty-state")).not.toBeNull();
    expect(screen.getByText("Nothing generated yet")).not.toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
    expect((await page.generateMetadata()).title).toBe("Daily UI Site");
  });

  it("empty db + working provider → attempt runs, fresh today doc renders (spec §6)", async () => {
    setLlmEnv();
    const { page, db, handle, createProvider } = await loadPage();
    const today = localToday();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc(today)) });

    render(await page.default());

    expect(screen.queryByTestId("empty-state")).toBeNull();
    const themeRoot = screen.getByTestId("theme-root");
    expect(themeRoot.getAttribute("data-date")).toBe(today);
    // fresh row, no fallback badge
    expect(screen.queryByTestId("recent-badge")).toBeNull();
    expect(createProvider).toHaveBeenCalledWith("openai", "test-key");
    expect(db.getDay(handle, today)).toBeDefined();
  });

  it("empty db + failing provider → attempt returns null → empty state, no crash", async () => {
    setLlmEnv();
    const { page, createProvider } = await loadPage();
    createProvider.mockReturnValue({ generate: async () => "not json at all" });

    render(await page.default());

    expect(screen.getByTestId("empty-state")).not.toBeNull();
    expect(createProvider).toHaveBeenCalled(); // the attempt was actually made
  });

  it("corrupt today row + no LLM env → empty state, no crash (ruling 3)", async () => {
    const { page, db, handle, createProvider } = await loadPage();
    seed(db, handle, localToday(), "{broken json");

    render(await page.default());

    expect(screen.getByTestId("empty-state")).not.toBeNull();
    expect(createProvider).not.toHaveBeenCalled(); // env missing → short-circuit
  });

  it("empty db → the preview toggle is mounted (spec §5: works on a fresh deploy)", async () => {
    const { page } = await loadPage();

    render(await page.default());

    // Spec §5 requires the preview box on a fresh deploy with an EMPTY
    // database, which is exactly this branch. The box takes no props and reads
    // no stored document, so it needs nothing here — a preview fetches its own
    // tree at runtime. Moving <PreviewBox /> inside the populated branch only
    // would break the requirement while leaving every other test in this file
    // green, so assert it here explicitly.
    expect(screen.getByTestId("preview-toggle")).not.toBeNull();
    expect(screen.getByTestId("empty-state")).not.toBeNull();
  });

  it("populated db → the preview toggle is mounted alongside the document (spec §5)", async () => {
    const { page, db, handle } = await loadPage();
    seed(db, handle, localToday(), JSON.stringify(doc(localToday())));

    render(await page.default());

    // The other half of the same requirement: the box must survive the
    // populated branch too, or a visitor with today's UI cannot use it.
    expect(screen.getByTestId("preview-toggle")).not.toBeNull();
    expect(screen.getByTestId("theme-root")).not.toBeNull();
  });

  it("older row only + no LLM env → latest fallback with the 'showing most recent' badge", async () => {
    const { page, db, handle } = await loadPage();
    const older = doc(OLDER, "Old page");
    seed(db, handle, OLDER, JSON.stringify(older));

    render(await page.default());

    expect(screen.queryByTestId("empty-state")).toBeNull();
    expect(screen.getByTestId("theme-root").getAttribute("data-date")).toBe(OLDER);
    expect(screen.getByTestId("recent-badge")).not.toBeNull();
    expect(screen.queryByTestId("stale-badge")).toBeNull();
  });

  it("generateMetadata + Home share one attempt: provider called once, page shows the fresh row", async () => {
    setLlmEnv();
    const { page, createProvider } = await loadPage();
    const today = localToday();
    createProvider.mockReturnValue({ generate: async () => JSON.stringify(doc(today)) });

    const metadata = await page.generateMetadata();
    render(await page.default());

    expect(metadata.title).toBe(`Page ${today}`);
    // both call loadToday; the cooldown guarantees a single provider attempt
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("theme-root").getAttribute("data-date")).toBe(today);
  });
});
