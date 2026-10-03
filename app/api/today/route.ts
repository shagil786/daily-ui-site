import { getDb, getDay, getLatestDay } from "../../../lib/db";
import { todayLocal } from "../../../lib/date";
import { attemptRenderGeneration } from "../../../lib/generate";
import type { UiDocument } from "../../../lib/schema";

/**
 * GET /api/today — today's UI document, falling back to the latest stored day
 * when today has not been generated yet (ruling 5: local calendar date, not
 * UTC). 404 when the table is empty.
 *
 * Spec §6: a miss (today's row missing or unparseable) triggers ONE
 * server-side generation attempt — server-held `LLM_*` env only, never
 * `GENERATE_SECRET` — before the latest-fallback/404 chain; the attempt never
 * throws and never introduces a new response shape (failure → the same
 * latest-or-404 answers as before).
 */

/** True when the stored json parses — a corrupt today row counts as a miss. */
function isParsable(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

function error(body: { error: string }, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(_request: Request): Promise<Response> {
  const db = getDb();
  const today = todayLocal();
  // today's row if present, else the latest row overall (any older date)
  let row = getDay(db, today);
  // spec §6: missing OR corrupt today row → one server-side generation attempt
  if (row === undefined || !isParsable(row.json)) {
    await attemptRenderGeneration(db, today);
    row = getDay(db, today); // fresh row when the attempt succeeded
  }
  const selected = row ?? getLatestDay(db);
  if (selected === undefined) {
    return error({ error: "no-ui" }, 404);
  }
  let doc: UiDocument;
  try {
    doc = JSON.parse(selected.json) as UiDocument;
  } catch {
    // corrupt stored row: same defense as GET /api/archive/[date] (ruling 3)
    return error({ error: "corrupt" }, 500);
  }
  return Response.json(doc);
}
