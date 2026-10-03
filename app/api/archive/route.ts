import { getDb, listDays } from "../../../lib/db";

/**
 * GET /api/archive — every stored day, newest first:
 * `[{date, title, directive, stale}]`.
 *
 * `listDays()` skips rows whose stored json is corrupt (ruling 3: one bad row
 * must not discard the whole listing), so this route is a straight read.
 */

export async function GET(_request: Request): Promise<Response> {
  return Response.json(listDays(getDb()));
}
