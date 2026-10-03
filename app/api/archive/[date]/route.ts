import { getDb, getDay } from "../../../../lib/db";
import type { UiDocument } from "../../../../lib/schema";

/**
 * GET /api/archive/[date] — one stored day's document, 404 when the date has
 * no row, 500 when the stored json itself is corrupt (ruling 3) instead of an
 * unhandled crash.
 */

type RouteContext = { params: Promise<{ date: string }> };

function error(body: { error: string }, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { date } = await context.params;
  const row = getDay(getDb(), date);
  if (row === undefined) {
    return error({ error: "not-found" }, 404);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.json);
  } catch {
    return error({ error: "corrupt" }, 500);
  }
  // Parses, but is not a document (null, array, string, number) → corrupt,
  // never a 200 with a non-document body.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return error({ error: "corrupt" }, 500);
  }
  return Response.json(parsed as UiDocument);
}
