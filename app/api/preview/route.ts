import { Cooldown } from "../../../lib/cooldown";
import { todayLocal } from "../../../lib/date";
import { GenerationError, generateFromBrief } from "../../../lib/generate";
import { createProvider, type LlmProvider, type LlmProviderName } from "../../../lib/llm/provider";

/**
 * POST /api/preview — generate a UI document from a visitor's free-text brief.
 *
 * UNAUTHENTICATED by design: this route is open to anyone, so its cost is
 * bounded by rate limits rather than by a secret. `GENERATE_SECRET` is
 * deliberately NOT read here — it is the daily `POST /api/generate` credential.
 * Nothing is persisted: the document is returned and forgotten.
 *
 * Checks run in exactly this order, first failure wins, so a caller always
 * learns the FIRST thing that is wrong with it:
 *   1. body shape → `{brief: string}` with a trimmed length of 8–400
 *      characters and no prompt-fence delimiter (400 bad-brief)
 *   2. per-client cooldown → one generation per client per 10 minutes
 *      (429 cooldown, with `retryAfterMinutes`)
 *   3. per-process daily cap → `PREVIEW_DAILY_CAP` (default 50) generations per
 *      UTC calendar day (429 daily-cap)
 *   4. provider config from server-held `LLM_PROVIDER`/`LLM_API_KEY`, missing
 *      or empty → 503 unavailable without constructing a provider
 *   5. generation → 200 `{doc}`, or 502 generation-failed
 *
 * Every error response is a FIXED body from this list. No `err.message` is ever
 * surfaced: a `GenerationError` message carries the provider's endpoint URL,
 * its HTTP status, a slice of the upstream response body, and model-controlled
 * strings, all of which would leak to an unauthenticated caller. The cause is
 * logged server-side instead, and only ever the error and the brief's LENGTH.
 */

/** A brief must be at least this many characters after trimming to be usable. */
const MIN_BRIEF_LENGTH = 8;
/** ...and at most this many, so one request cannot stream an unbounded prompt. */
const MAX_BRIEF_LENGTH = 400;
/** One generation per client per 10 minutes. */
const PREVIEW_COOLDOWN_MS = 10 * 60 * 1000;
/** Generations allowed per UTC day when `PREVIEW_DAILY_CAP` is unusable. */
const DEFAULT_DAILY_CAP = 50;
/** The visitor-brief prompt's own closing fence; a brief must not contain it. */
const BRIEF_FENCE_END = "--- END VISITOR BRIEF ---";

/** Per-client cooldown, in-memory and per-process by design. */
const previewCooldown = new Cooldown(PREVIEW_COOLDOWN_MS);

/** UTC day the daily counter belongs to ("YYYY-MM-DD"); rolled on each check. */
let capDay = "";
/** Generations admitted so far on `capDay`. */
let capCount = 0;

function error(
  body: { error: string; retryAfterMinutes?: number },
  status: number,
): Response {
  return Response.json(body, { status });
}

type BriefResolution = { ok: true; brief: string } | { ok: false };

/**
 * Validate the request body into a trimmed brief. Invalid input resolves
 * `ok: false` (400) and never reaches the provider.
 *
 * The delimiter check is part of validity, not a separate rule: this route is
 * the untrusted-input boundary for `generateFromBrief`, and a brief carrying
 * the prompt's own closing fence could terminate the fenced section early and
 * pose as prompt text that follows it.
 */
async function resolveBrief(request: Request): Promise<BriefResolution> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return { ok: false };
  }
  // Arrays and primitives are not request bodies: reject rather than let an
  // array fall through the `"brief" in parsed` check and read a missing key.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  const raw: unknown = (parsed as { brief?: unknown }).brief;
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const brief = raw.trim();
  if (brief.length < MIN_BRIEF_LENGTH || brief.length > MAX_BRIEF_LENGTH) {
    return { ok: false };
  }
  if (brief.includes(BRIEF_FENCE_END)) {
    return { ok: false };
  }
  return { ok: true, brief };
}

/**
 * The bucket key for a request: the FIRST hop of `x-forwarded-for` (the client
 * as seen by the outermost trusted proxy), else `x-real-ip`, else the single
 * "local" bucket every header-less caller shares.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp !== undefined && realIp.length > 0) {
    return realIp;
  }
  return "local";
}

/**
 * The current UTC calendar day, so the cap resets at midnight UTC no matter
 * what timezone the host runs in (the opposite rule from the LOCAL "today" the
 * generated document is dated with — see `todayLocal`).
 */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `PREVIEW_DAILY_CAP` when it is a positive integer, else DEFAULT_DAILY_CAP. */
function dailyCap(): number {
  const raw = process.env.PREVIEW_DAILY_CAP;
  if (raw === undefined) {
    return DEFAULT_DAILY_CAP;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_DAILY_CAP;
  }
  return parsed;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Brief validity, before anything consumes a rate-limit slot: a caller
  //    with a malformed brief should not have its cooldown or the daily cap
  //    spent on it.
  const resolution = await resolveBrief(request);
  if (!resolution.ok) {
    return error({ error: "bad-brief" }, 400);
  }
  const { brief } = resolution;

  // 2. Per-client cooldown, before any provider work.
  const ip = clientIp(request);
  if (!previewCooldown.tryConsume(ip)) {
    const retryAfterMinutes = Math.max(1, Math.ceil(previewCooldown.remainingMs(ip) / 60_000));
    return error({ error: "cooldown", retryAfterMinutes }, 429);
  }

  // 3. Daily cap across all clients. This route is unauthenticated, so the
  //    per-IP cooldown alone cannot bound total spend: one client could rotate
  //    source addresses, and many clients can share one.
  const today = utcDay();
  if (today !== capDay) {
    capDay = today;
    capCount = 0;
  }
  if (capCount >= dailyCap()) {
    return error({ error: "daily-cap" }, 429);
  }
  capCount += 1;

  // 4. Provider wiring from server-held env; the key is passed through and
  //    never logged or returned. Missing/empty config is "unavailable", not
  //    "bad request": nothing about the visitor's brief is wrong.
  const providerName = process.env.LLM_PROVIDER;
  const apiKey = process.env.LLM_API_KEY;
  if (providerName === undefined || providerName.length === 0) {
    return error({ error: "unavailable" }, 503);
  }
  if (apiKey === undefined || apiKey.length === 0) {
    return error({ error: "unavailable" }, 503);
  }
  let provider: LlmProvider;
  try {
    provider = createProvider(providerName as LlmProviderName, apiKey);
  } catch {
    // An unknown provider name in env is a misconfiguration. Its message names
    // the configured value, so it stays server-side too.
    return error({ error: "unavailable" }, 503);
  }

  // 5. Run the pipeline. `generateFromBrief` throws GenerationError only after
  //    its own single repair attempt, and `runAttempt` already folds provider
  //    throws into it — so the message here can carry upstream detail. Neither
  //    branch returns it.
  try {
    const doc = await generateFromBrief({ provider }, brief, todayLocal());
    return Response.json({ doc });
  } catch (err) {
    if (!(err instanceof GenerationError)) {
      // Unreachable via the provider path (see above); anything else is an
      // unexpected fault. Log the class and the brief's LENGTH — never the
      // brief text (it is the visitor's, and untrusted) and never the key.
      console.error(
        `preview generation failed (brief length ${brief.length}):`,
        err instanceof Error ? err.constructor.name : typeof err,
      );
    }
    return error({ error: "generation-failed" }, 502);
  }
}