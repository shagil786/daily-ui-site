import { getDb } from "../../../lib/db";
import { GenerationError, generateDay } from "../../../lib/generate";
import { createProvider, type LlmProvider, type LlmProviderName } from "../../../lib/llm/provider";

/**
 * POST /api/generate — on-demand generation for one date.
 *
 * Contract (brief): header `x-generate-secret` must equal env
 * `GENERATE_SECRET` (401 unauthorized); body `{date?}` defaults to today and
 * must be a strict YYYY-MM-DD (400 bad-date) so raw user input never reaches
 * `generateDay`; one accepted attempt per date per 10 minutes, in-memory
 * (429 rate-limited); provider config failure or `GenerationError` → 502
 * generation-failed; success → 200 `{date, stale, directive}`.
 */

/** One accepted on-demand attempt per date per 10 minutes. */
const RATE_LIMIT_MS = 10 * 60 * 1000;

/** In-memory, per-process: date → epoch ms of the last accepted attempt. */
const lastAttemptByDate = new Map<string, number>();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD: correct shape AND a real calendar date (ruling 2). */
function isDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Today's local calendar date as YYYY-MM-DD (local time, not UTC). */
function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function error(body: { error: string }, status: number): Response {
  return Response.json(body, { status });
}

type DateResolution = { ok: true; date: string } | { ok: false };

/**
 * Resolve the target date from the request body: absent body or absent
 * `date` key → local today; anything else must be a strict YYYY-MM-DD.
 * Invalid input resolves `ok: false` (400) and never reaches `generateDay`.
 */
async function resolveDate(request: Request): Promise<DateResolution> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return { ok: true, date: todayLocal() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false };
  }
  if (!("date" in parsed)) {
    return { ok: true, date: todayLocal() };
  }
  const raw: unknown = parsed.date;
  if (typeof raw !== "string" || !isDate(raw)) {
    return { ok: false };
  }
  return { ok: true, date: raw };
}

export async function POST(request: Request): Promise<Response> {
  // 1. Auth: exact match against GENERATE_SECRET; unset secret never authorizes.
  const secret = process.env.GENERATE_SECRET;
  const provided = request.headers.get("x-generate-secret");
  if (secret === undefined || secret.length === 0 || provided !== secret) {
    return error({ error: "unauthorized" }, 401);
  }

  // 2. Body: strict date validation before anything touches the pipeline.
  const resolution = await resolveDate(request);
  if (!resolution.ok) {
    return error({ error: "bad-date" }, 400);
  }
  const { date } = resolution;

  // 3. Rate limit: in-memory, keyed by date, checked before any provider work.
  const now = Date.now();
  const last = lastAttemptByDate.get(date);
  if (last !== undefined && now - last < RATE_LIMIT_MS) {
    return error({ error: "rate-limited" }, 429);
  }
  lastAttemptByDate.set(date, now);

  // 4. Provider wiring from env; misconfiguration is a 502, never a crash.
  //    The API key is passed through, never logged.
  let provider: LlmProvider;
  try {
    provider = createProvider(
      process.env.LLM_PROVIDER as LlmProviderName,
      process.env.LLM_API_KEY ?? "",
    );
  } catch {
    return error({ error: "generation-failed" }, 502);
  }

  // 5. Run the pipeline; GenerationError (after its own retry) → 502.
  try {
    const result = await generateDay({ provider, db: getDb() }, date);
    return Response.json({ date, stale: result.stale, directive: result.directive });
  } catch (err) {
    if (err instanceof GenerationError) {
      return error({ error: "generation-failed" }, 502);
    }
    throw err;
  }
}
