import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pickDirective } from "../../lib/directives";
import type { LlmProvider } from "../../lib/llm/provider";
import type { UiDocument } from "../../lib/schema";

/**
 * Spec §6 — `attemptRenderGeneration` (lib/generate.ts): the single
 * server-side generation attempt fired by the today page and GET /api/today
 * when today's row is missing (or corrupt). Plan edge case #30: with an empty
 * DB and failing/absent generation this must resolve to null and never throw.
 *
 * Isolation strategy mirrors tests/unit/api.test.ts:
 * - `vi.mock` wraps the REAL `createProvider`, so the helper's env wiring
 *   (server-held `LLM_*` only) runs unmodified while no network call can
 *   happen; tests stub the provider object handed to the REAL `generateDay`
 *   pipeline.
 * - every test calls `loadAttempt()` FIRST, which `vi.resetModules()`s and
 *   dynamically imports `lib/generate` + `lib/db` from the SAME fresh module
 *   generation, so the module-level cooldown Map starts empty per test.
 *
 * Env: LLM_PROVIDER/LLM_API_KEY are owned by this file and restored in
 * afterEach, so nothing leaks across tests or files.
 */

const ENV_KEYS = ["LLM_PROVIDER", "LLM_API_KEY"] as const;
type EnvKey = (typeof ENV_KEYS)[number];
const originalEnv: Partial<Record<EnvKey, string>> = {};

const DATE = "2026-10-05";
const OTHER_DATE = "2026-10-06";

vi.mock("../../lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/llm/provider")>();
  return { ...actual, createProvider: vi.fn(actual.createProvider) };
});

/** A document that passes validateDocument (same fixture as generate.test.ts). */
function validDoc(date = DATE): UiDocument {
  return {
    version: 1,
    date,
    title: "Generated page",
    theme: { bg: "#0f1020", fg: "#f5f5ff", accent: "#ff3366", font: "sans", dark: true },
    root: {
      id: "root",
      componentType: "Section",
      props: { heading: "Hello" },
      children: [{ id: "t1", componentType: "Text", props: { text: "Body copy" } }],
    },
  };
}

/**
 * Fresh module generation: resets the helper's cooldown Map together with the
 * db module, and re-primes the shared createProvider mock to the REAL
 * implementation (so stale stubs from a previous test never leak).
 */
async function loadAttempt() {
  vi.resetModules();
  const generate = await import("../../lib/generate");
  const db = await import("../../lib/db");
  const providerModule = await import("../../lib/llm/provider");
  const actual = await vi.importActual<typeof import("../../lib/llm/provider")>(
    "../../lib/llm/provider",
  );
  const createProvider = vi.mocked(providerModule.createProvider);
  createProvider.mockClear();
  createProvider.mockImplementation(actual.createProvider);
  const handle = db.getDb(":memory:"); // ":memory:" is never memoized
  return { attemptRenderGeneration: generate.attemptRenderGeneration, db, handle, createProvider };
}

/** Configure a valid server-side LLM env (the keys the helper is allowed to use). */
function setLlmEnv(provider = "openai", apiKey = "test-key"): void {
  process.env.LLM_PROVIDER = provider;
  process.env.LLM_API_KEY = apiKey;
}

function stubProvider(generate: LlmProvider["generate"]): LlmProvider {
  return { generate: vi.fn<LlmProvider["generate"]>(generate) };
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

// ── attemptRenderGeneration ────────────────────────────────────────────────

describe("attemptRenderGeneration", () => {
  it("LLM env missing → null, provider never created, nothing stored", async () => {
    const { attemptRenderGeneration, db, handle, createProvider } = await loadAttempt();

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
    expect(db.getDay(handle, DATE)).toBeUndefined();
  });

  it("empty LLM env (e2e-style forced-empty values) → null, provider never created", async () => {
    setLlmEnv("", "");
    const { attemptRenderGeneration, handle, createProvider } = await loadAttempt();

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("LLM_API_KEY unset with a provider set → null, provider never created", async () => {
    process.env.LLM_PROVIDER = "openai";
    const { attemptRenderGeneration, handle, createProvider } = await loadAttempt();

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("success → result returned, row upserted (stale=false), env-wired provider", async () => {
    setLlmEnv();
    const { attemptRenderGeneration, db, handle, createProvider } = await loadAttempt();
    createProvider.mockReturnValue(stubProvider(async () => JSON.stringify(validDoc())));

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).not.toBeNull();
    expect(result?.stale).toBe(false);
    expect(result?.doc).toEqual(validDoc());
    expect(result?.directive).toBe(pickDirective(DATE).id);
    // server-held env is the only credential source (never GENERATE_SECRET)
    expect(createProvider).toHaveBeenCalledWith("openai", "test-key");
    const row = db.getDay(handle, DATE);
    expect(row).toBeDefined();
    expect(row?.stale).toBe(false);
    expect(JSON.parse(row?.json ?? "")).toEqual(validDoc());
  });

  it("provider output unusable on an empty db → null (never throws), nothing stored", async () => {
    setLlmEnv();
    const { attemptRenderGeneration, db, handle, createProvider } = await loadAttempt();
    createProvider.mockReturnValue(stubProvider(async () => "not json at all"));

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).toBeNull();
    expect(db.getDay(handle, DATE)).toBeUndefined();
  });

  it("provider config throw (unknown provider name) → null, never throws", async () => {
    setLlmEnv("totally-bogus-provider");
    const { attemptRenderGeneration, handle } = await loadAttempt();

    const result = await attemptRenderGeneration(handle, DATE);

    expect(result).toBeNull();
  });

  it("second attempt for the same date within the 10-min cooldown → null without calling the provider", async () => {
    setLlmEnv();
    const { attemptRenderGeneration, db, handle, createProvider } = await loadAttempt();
    createProvider.mockReturnValue(stubProvider(async () => JSON.stringify(validDoc())));

    const first = await attemptRenderGeneration(handle, DATE);
    expect(first).not.toBeNull();
    expect(createProvider).toHaveBeenCalledTimes(1);

    const second = await attemptRenderGeneration(handle, DATE);
    expect(second).toBeNull();
    expect(createProvider).toHaveBeenCalledTimes(1); // second render never reaches the provider
    // first attempt's row survives; nothing was regenerated or removed
    expect(db.getDay(handle, DATE)).toBeDefined();
  });

  it("cooldown is keyed by date: a different date still attempts", async () => {
    setLlmEnv();
    const { attemptRenderGeneration, handle, createProvider } = await loadAttempt();
    createProvider.mockReturnValue(stubProvider(async () => JSON.stringify(validDoc())));

    await attemptRenderGeneration(handle, DATE);
    const other = await attemptRenderGeneration(handle, OTHER_DATE);

    expect(other).not.toBeNull();
    expect(createProvider).toHaveBeenCalledTimes(2);
  });

  it("cooldown expires: an attempt after the 10-minute window is allowed", async () => {
    setLlmEnv();
    const { attemptRenderGeneration, handle, createProvider } = await loadAttempt();
    createProvider.mockReturnValue(stubProvider(async () => JSON.stringify(validDoc())));

    const t0 = Date.now();
    const first = await attemptRenderGeneration(handle, DATE);
    expect(first).not.toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 10 * 60_000 + 1_000); // just past the window

    const afterWindow = await attemptRenderGeneration(handle, DATE);
    expect(afterWindow).not.toBeNull();
    expect(createProvider).toHaveBeenCalledTimes(2);
  });
});
