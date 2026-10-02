import type Database from "better-sqlite3";
import { getLatestDay, upsertDay } from "./db";
import { pickDirective, type Directive } from "./directives";
import { extractJson } from "./llm/extract";
import type { LlmProvider } from "./llm/provider";
import { inventoryForPrompt } from "./registry";
import { LIMITS, type UiDocument } from "./schema";
import { validateDocument } from "./validate";

/**
 * Daily generation pipeline: pick a directive, prompt the provider, extract +
 * validate the JSON, repair once on failure, then fall back to the most recent
 * earlier day. Everything Task 11's routes and the CLI need is here.
 */

/** Raised when generation cannot produce a usable document for a date. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export type GenerateDeps = { provider: LlmProvider; db: Database.Database };

export type GenerateResult = { doc: UiDocument; stale: boolean; directive: string };

/** Max validation errors forwarded into a single repair message. */
const MAX_REPAIR_ERRORS = 10;

/** One failed attempt: raw output (if any) plus why it was rejected. */
type Failure = { output: string | null; errors: string[] };

type Attempt = { ok: true; doc: UiDocument } | { ok: false; failure: Failure };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The full generation prompt: system instructions + component inventory +
 * limits + directive brief + date, ending with "Return JSON only".
 */
function buildPrompt(date: string, directive: Directive): string {
  return [
    "You are a UI designer-engineer. Produce one complete UI document (version, date, " +
      'title, theme, root) for the daily showcase site, as a single JSON object. The "root" ' +
      "is a node tree whose componentType values come only from the allowed inventory.",
    `Date: ${date}`,
    `Directive id: ${directive.id}`,
    `Directive brief: ${directive.brief}`,
    `Allowed components and their props: ${JSON.stringify(inventoryForPrompt())}`,
    `Limits: tree depth at most ${LIMITS.maxDepth} (root counts as depth 1); at most ` +
      `${LIMITS.maxNodes} nodes in total.`,
    "Return JSON only.",
  ].join("\n");
}

/** Repair message: the prior output plus the first validation errors. */
function buildRepair(failure: Failure): string {
  return [
    "Your previous output was rejected and must be corrected.",
    "Problems:",
    ...failure.errors.slice(0, MAX_REPAIR_ERRORS).map((err) => `- ${err}`),
    "Previous output:",
    failure.output ?? "(the provider returned no output)",
    "Return JSON only.",
  ].join("\n");
}

/**
 * One generation attempt: provider.generate → extractJson → validateDocument.
 * A throw at any stage is a failed attempt (never escapes), reported as a
 * `Failure` so the caller can repair or fall back.
 */
async function runAttempt(
  provider: LlmProvider,
  prompt: string,
  repair?: string,
): Promise<Attempt> {
  let raw: string;
  try {
    raw = await provider.generate(prompt, repair === undefined ? undefined : { repair });
  } catch (err) {
    return { ok: false, failure: { output: null, errors: [`provider error: ${message(err)}`] } };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return {
      ok: false,
      failure: { output: raw, errors: [`JSON extraction failed: ${message(err)}`] },
    };
  }

  const result = validateDocument(parsed);
  if (!result.ok) {
    return { ok: false, failure: { output: raw, errors: result.errors } };
  }
  return { ok: true, doc: result.doc };
}

/** Decode a stored fallback document; unreadable/invalid storage is fatal. */
function decodeFallback(json: string, date: string): UiDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new GenerationError(
      `stored fallback document before ${date} is not valid JSON: ${message(err)}`,
    );
  }
  const result = validateDocument(raw);
  if (!result.ok) {
    throw new GenerationError(
      `stored fallback document before ${date} failed validation: ${result.errors.join("; ")}`,
    );
  }
  return result.doc;
}

/**
 * Generate, validate, and store the document for `date`.
 *
 * Order: pickDirective → prompt → generate → extract → validate; on failure,
 * exactly ONE repair attempt carrying the prior output and first validation
 * errors. If that also fails, reuse the latest stored document strictly before
 * `date` (upserting today's row with `stale: true`); with no such row, throw
 * `GenerationError`.
 */
export async function generateDay(deps: GenerateDeps, date: string): Promise<GenerateResult> {
  const { provider, db } = deps;
  const directive = pickDirective(date);
  const prompt = buildPrompt(date, directive);

  let result = await runAttempt(provider, prompt);
  if (!result.ok) {
    result = await runAttempt(provider, prompt, buildRepair(result.failure));
  }

  if (result.ok) {
    upsertDay(db, {
      date,
      json: JSON.stringify(result.doc),
      directive: directive.id,
      stale: false,
    });
    return { doc: result.doc, stale: false, directive: directive.id };
  }

  const prior = getLatestDay(db, date);
  if (prior === undefined) {
    throw new GenerationError(
      `generation failed for ${date} and no earlier day exists to fall back on`,
    );
  }
  const doc = decodeFallback(prior.json, date);
  upsertDay(db, { date, json: JSON.stringify(doc), directive: directive.id, stale: true });
  return { doc, stale: true, directive: directive.id };
}
