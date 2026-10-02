import { getDb, getDay, getLatestDay } from "../../../lib/db";
import type { UiDocument } from "../../../lib/schema";

/**
 * GET /api/today — today's UI document, falling back to the latest stored day
 * when today has not been generated yet (ruling 5: local calendar date, not
 * UTC). 404 when the table is empty.
 */

/** Today's local calendar date as YYYY-MM-DD (derived from `new Date()` local time). */
function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function error(body: { error: string }, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(_request: Request): Promise<Response> {
  const db = getDb();
  // today's row if present, else the latest row overall (any older date)
  const row = getDay(db, todayLocal()) ?? getLatestDay(db);
  if (row === undefined) {
    return error({ error: "no-ui" }, 404);
  }
  let doc: UiDocument;
  try {
    doc = JSON.parse(row.json) as UiDocument;
  } catch {
    // corrupt stored row: same defense as GET /api/archive/[date] (ruling 3)
    return error({ error: "corrupt" }, 500);
  }
  return Response.json(doc);
}
