import { describe, expect, it, vi, type Mock } from "vitest";
import { getDb, getDay, upsertDay } from "../../lib/db";
import { DIRECTIVES, pickDirective } from "../../lib/directives";
import { GenerationError, generateDay } from "../../lib/generate";
import { inventoryForPrompt } from "../../lib/registry";
import type { LlmProvider } from "../../lib/llm/provider";
import { LIMITS, type UiDocument } from "../../lib/schema";
import { parseArgs } from "../../scripts/generate";

const DATE = "2026-10-05";
const YESTERDAY = "2026-10-04";

/** A document that passes validateDocument: Section > Text, known props only. */
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

/** Well-formed JSON that fails validateDocument (unknown component). */
function invalidDocJson(): string {
  const doc = validDoc();
  doc.root.componentType = "NoSuchComponent";
  return JSON.stringify(doc);
}

/** Mock provider with the exact LlmProvider.generate signature; queue responses per call. */
function providerMock(): { provider: LlmProvider; generate: Mock<LlmProvider["generate"]> } {
  const generate = vi.fn<LlmProvider["generate"]>();
  return { provider: { generate }, generate };
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("DIRECTIVES", () => {
  it("has at least 8 entries including the required ids", () => {
    expect(DIRECTIVES.length).toBeGreaterThanOrEqual(8);
    const ids = DIRECTIVES.map((d) => d.id);
    for (const required of [
      "retro-terminal",
      "brutalist",
      "pastel",
      "game-like",
      "minimal-portfolio",
      "data-dashboard",
      "neon-cyber",
      "organic-zen",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("entries have non-empty briefs and unique ids", () => {
    for (const entry of DIRECTIVES) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.brief.length).toBeGreaterThan(0);
    }
    expect(new Set(DIRECTIVES.map((d) => d.id)).size).toBe(DIRECTIVES.length);
  });
});

describe("pickDirective", () => {
  it("is deterministic: the same date always picks the same directive", () => {
    expect(pickDirective(DATE)).toEqual(pickDirective(DATE));
    expect(pickDirective("2026-01-01").id).toBe(pickDirective("2026-01-01").id);
    expect(pickDirective("2030-12-31").id).toBe(pickDirective("2030-12-31").id);
  });

  it("only returns entries that are members of DIRECTIVES (id and brief match)", () => {
    const dates = [
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
      "2026-11-15",
      "2027-01-01",
      "2028-02-29",
      "2030-06-30",
    ];
    for (const date of dates) {
      const picked = pickDirective(date);
      const entry = DIRECTIVES.find((d) => d.id === picked.id);
      expect(entry).toBeDefined();
      expect(picked.brief).toBe(entry?.brief);
    }
  });

  it("maps distinct dates across a year onto more than one directive (spread)", () => {
    const ids = new Set<string>();
    for (let day = 1; day <= 365; day++) {
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      ids.add(pickDirective(date).id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("generateDay", () => {
  it("happy path: valid doc JSON → validated, upserted, stale=false, directive stored", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate.mockResolvedValue(JSON.stringify(validDoc()));

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.stale).toBe(false);
    expect(result.directive).toBe(pickDirective(DATE).id);
    expect(result.doc).toEqual(validDoc());

    const row = getDay(db, DATE);
    expect(row).toBeDefined();
    expect(row?.stale).toBe(false);
    expect(row?.directive).toBe(pickDirective(DATE).id);
    expect(JSON.parse(row?.json ?? "")).toEqual(validDoc());
  });

  it("builds the prompt from inventory, limits, directive brief, date, and 'Return JSON only'", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate.mockResolvedValue(JSON.stringify(validDoc()));

    await generateDay({ provider, db }, DATE);

    const prompt = generate.mock.calls[0][0];
    expect(prompt).toContain(JSON.stringify(inventoryForPrompt()));
    expect(prompt).toContain(String(LIMITS.maxDepth));
    expect(prompt).toContain(String(LIMITS.maxNodes));
    expect(prompt).toContain(pickDirective(DATE).brief);
    expect(prompt).toContain(DATE);
    expect(prompt).toContain("Return JSON only");
  });

  it("garbage then valid on repair → ok, stale=false, provider called twice", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate
      .mockResolvedValueOnce("sorry, no json here at all")
      .mockResolvedValueOnce(JSON.stringify(validDoc()));

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(false);
    expect(result.doc).toEqual(validDoc());
    expect(getDay(db, DATE)?.stale).toBe(false);

    // repair message = prior output + failure detail
    const repair = generate.mock.calls[1][1]?.repair;
    expect(repair).toContain("sorry, no json here at all");
  });

  it("well-formed but invalid (unknown component) → repair carries the validation error", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate
      .mockResolvedValueOnce(invalidDocJson())
      .mockResolvedValueOnce(JSON.stringify(validDoc()));

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(false);

    const repair = generate.mock.calls[1][1]?.repair;
    expect(repair).toContain("unknown component: NoSuchComponent");
    expect(repair).toContain(invalidDocJson());
  });

  it("garbage twice, yesterday's row exists → yesterday's doc, stale=true, today's row upserted stale", async () => {
    const db = getDb(":memory:");
    upsertDay(db, {
      date: YESTERDAY,
      json: JSON.stringify(validDoc(YESTERDAY)),
      directive: "brutalist",
      stale: false,
    });
    const { provider, generate } = providerMock();
    generate.mockResolvedValueOnce("junk").mockResolvedValueOnce("junk again");

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(true);
    expect(result.directive).toBe(pickDirective(DATE).id);
    expect(result.doc).toEqual(validDoc(YESTERDAY));

    const row = getDay(db, DATE);
    expect(row).toBeDefined();
    expect(row?.stale).toBe(true);
    expect(row?.directive).toBe(pickDirective(DATE).id);
    expect(JSON.parse(row?.json ?? "")).toEqual(validDoc(YESTERDAY));
  });

  it("invalid twice (unknown component), yesterday exists → stale fallback", async () => {
    const db = getDb(":memory:");
    upsertDay(db, {
      date: YESTERDAY,
      json: JSON.stringify(validDoc(YESTERDAY)),
      directive: "pastel",
      stale: false,
    });
    const { provider, generate } = providerMock();
    generate.mockResolvedValue(invalidDocJson()).mockResolvedValue(invalidDocJson());

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(true);
    expect(result.doc).toEqual(validDoc(YESTERDAY));
    expect(getDay(db, DATE)?.stale).toBe(true);
  });

  it("garbage twice, empty db → throws GenerationError and stores nothing", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate.mockResolvedValueOnce("junk").mockResolvedValueOnce("junk again");

    await expect(generateDay({ provider, db }, DATE)).rejects.toThrow(GenerationError);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(getDay(db, DATE)).toBeUndefined();
  });

  it("invalid twice (unknown component), empty db → throws GenerationError", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate.mockResolvedValue(invalidDocJson()).mockResolvedValue(invalidDocJson());

    await expect(generateDay({ provider, db }, DATE)).rejects.toThrow(GenerationError);
    expect(getDay(db, DATE)).toBeUndefined();
  });

  it("provider throw on first attempt counts as a failed attempt and still repairs", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(JSON.stringify(validDoc()));

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(false);
    expect(result.doc).toEqual(validDoc());
    expect(generate.mock.calls[1][1]?.repair).toContain("network down");
  });

  it("provider throws on both attempts → stale fallback (no silent crash)", async () => {
    const db = getDb(":memory:");
    upsertDay(db, {
      date: YESTERDAY,
      json: JSON.stringify(validDoc(YESTERDAY)),
      directive: "neon-cyber",
      stale: false,
    });
    const { provider, generate } = providerMock();
    generate.mockRejectedValue(new Error("http 500"));

    const result = await generateDay({ provider, db }, DATE);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.stale).toBe(true);
    expect(result.doc).toEqual(validDoc(YESTERDAY));
    expect(getDay(db, DATE)?.stale).toBe(true);
  });

  it("provider throws on both attempts, empty db → throws GenerationError", async () => {
    const db = getDb(":memory:");
    const { provider, generate } = providerMock();
    generate.mockRejectedValue(new Error("http 503"));

    await expect(generateDay({ provider, db }, DATE)).rejects.toThrow(GenerationError);
    expect(getDay(db, DATE)).toBeUndefined();
  });
});

describe("parseArgs (scripts/generate.ts)", () => {
  it("defaults both --from and --to to today when no flags are given", () => {
    expect(parseArgs([])).toEqual({ from: utcToday(), to: utcToday() });
  });

  it("missing --from defaults to today; --to defaults to today when only --from is given", () => {
    expect(parseArgs(["--from", "2026-10-01"])).toEqual({
      from: "2026-10-01",
      to: utcToday(),
    });
    expect(parseArgs(["--to", "2026-10-04"])).toEqual({
      from: utcToday(),
      to: "2026-10-04",
    });
  });

  it("uses explicit --from and --to values", () => {
    expect(parseArgs(["--from", "2026-10-01", "--to", "2026-10-05"])).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
    // order of flags does not matter
    expect(parseArgs(["--to", "2026-10-05", "--from", "2026-10-01"])).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
  });

  it("rejects a malformed date", () => {
    expect(() => parseArgs(["--from", "2026/10/05"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(["--to", "October 5"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(["--from"])).toThrow(/YYYY-MM-DD/);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--verbose"])).toThrow(/unknown argument/);
  });

  it("rejects a range whose start is after its end", () => {
    expect(() => parseArgs(["--from", "2026-10-05", "--to", "2026-10-01"])).toThrow(
      /after/,
    );
  });
});
