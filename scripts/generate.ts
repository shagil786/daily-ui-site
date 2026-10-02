import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDb } from "../lib/db";
import { GenerationError, generateDay } from "../lib/generate";
import { createProvider, type LlmProviderName } from "../lib/llm/provider";

/**
 * Daily generation CLI: `npx tsx scripts/generate.ts --from YYYY-MM-DD --to YYYY-MM-DD`.
 * Defaults both bounds to today (UTC). Prints `<date> ok | stale | failed` per date.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today in UTC (YYYY-MM-DD) — the default bound for both --from and --to. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Strict YYYY-MM-DD: correct shape AND a real calendar date. */
function isDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export type CliRange = { from: string; to: string };

/**
 * Parse `--from` / `--to` (either order, each optional; missing bound defaults
 * to today). Throws on malformed dates, unknown flags, or an inverted range.
 */
export function parseArgs(argv: readonly string[]): CliRange {
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== "--from" && flag !== "--to") {
      throw new Error(`unknown argument: ${String(flag)}`);
    }
    const value = argv[i + 1];
    if (value === undefined || !isDate(value)) {
      throw new Error(`${flag} requires a date in YYYY-MM-DD format`);
    }
    if (flag === "--from") {
      from = value;
    } else {
      to = value;
    }
    i += 1;
  }
  const resolvedFrom = from ?? utcToday();
  const resolvedTo = to ?? utcToday();
  if (resolvedFrom > resolvedTo) {
    throw new Error(`--from ${resolvedFrom} is after --to ${resolvedTo}`);
  }
  return { from: resolvedFrom, to: resolvedTo };
}

/** Inclusive list of YYYY-MM-DD dates between the bounds (day-step, UTC). */
function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function readProviderName(value: string | undefined): LlmProviderName {
  if (value === "openai" || value === "anthropic") {
    return value;
  }
  throw new Error('LLM_PROVIDER must be "openai" or "anthropic"');
}

function readApiKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("LLM_API_KEY is required");
  }
  return value;
}

async function main(argv: readonly string[]): Promise<void> {
  const { from, to } = parseArgs(argv);
  const provider = createProvider(
    readProviderName(process.env.LLM_PROVIDER),
    readApiKey(process.env.LLM_API_KEY),
  );
  const db = getDb(); // honors env DATABASE_PATH (defaults to ./data/days.db)

  let failed = false;
  for (const date of eachDate(from, to)) {
    try {
      const result = await generateDay({ provider, db }, date);
      console.log(`${date} ${result.stale ? "stale" : "ok"}`);
    } catch (err) {
      if (!(err instanceof GenerationError)) {
        throw err;
      }
      failed = true;
      console.log(`${date} failed`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

/** True only when this file is the process entry point (tsx execution). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
