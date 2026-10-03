import { getDb } from "../../../lib/db";
import { isCalendarDate, todayLocal } from "../../../lib/date";
import { Cooldown } from "../../../lib/cooldown";
import { GenerationError, generateDay } from "../../../lib/generate";
import { createProvider, type LlmProvider, type LlmProviderName } from "../../../lib/llm/provider";
import { secretMatches } from "../../../lib/secrets";

/**
 * POST /api/generate — on-demand generation for one date.
 *
 * Contract (brief): header `x-generate-secret` must equal env
 * `GENERATE_SECRET` (401 unauthorized); body `{date?}` defaults to today and
 * must be a strict YYYY-MM-DD (400 bad-date) so raw user input never reaches
 * `generateDay`; one accepted attempt per date per 10 minutes, in-memory
 * (429 rate-limited); provider config failure or `GenerationError` → 502
 * generation-failed; any other unexpected failure → 500 internal-error;
 * success → 200 `{date, stale, directive}`.
 */

/** One accepted on-demand attempt per date per 10 minutes (in-memory, per-process). */
const attemptCooldown = new Cooldown(10 * 60 * 1000);

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
  // Arrays and primitives are not request bodies: reject rather than let an
  // array fall through the `"date" in parsed` check and silently mean "today".
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  if (!("date" in parsed)) {
    return { ok: true, date: todayLocal() };
  }
  const raw: unknown = parsed.date;
  if (typeof raw !== "string" || !isCalendarDate(raw)) {
    return { ok: false };
  }
  return { ok: true, date: raw };
}

export async function POST(request: Request): Promise<Response> {
  // 1. Auth: exact match against GENERATE_SECRET; unset secret never authorizes.
  const secret = process.env.GENERATE_SECRET;
  const provided = request.headers.get("x-generate-secret");
  if (!secretMatches(provided, secret)) {
    return error({ error: "unauthorized" }, 401);
  }

  // 2. Body: strict date validation before anything touches the pipeline.
  const resolution = await resolveDate(request);
  if (!resolution.ok) {
    return error({ error: "bad-date" }, 400);
  }
  const { date } = resolution;

  // 3. Rate limit: in-memory, keyed by date, checked before any provider work.
  if (!attemptCooldown.tryConsume(date)) {
    return error({ error: "rate-limited" }, 429);
  }

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
    // Any other failure (e.g. a database error) stays a structured JSON
    // response like every other error this route returns — but the cause is
    // logged server-side, otherwise an operator sees an unattributable 500.
    // Nothing reachable here carries env: provider errors are caught earlier
    // or folded into a GenerationError, so this is a sqlite/runtime failure.
    console.error("POST /api/generate failed unexpectedly:", err);
    return error({ error: "internal-error" }, 500);
  }
}
