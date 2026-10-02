import { getDb } from "../../../lib/db";

/**
 * GET /api/archive — every stored day, newest first:
 * `[{date, title, directive, stale}]`.
 *
 * `listDays()` parses every title eagerly, so one corrupt row would discard
 * the whole listing; instead this route reads the rows and skips only the
 * rows whose json cannot be parsed (ruling 3: corrupt row → skip, never an
 * unhandled crash).
 */

type StoredRow = { date: string; json: string; directive: string; stale: number };
type ArchiveEntry = { date: string; title: string; directive: string; stale: boolean };

/** Title from a stored document; throws when the stored json is corrupt. */
function titleOf(json: string): string {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "title" in parsed &&
    typeof parsed.title === "string"
  ) {
    return parsed.title;
  }
  return "";
}

export async function GET(_request: Request): Promise<Response> {
  const db = getDb();
  const rows = db
    .prepare<[], StoredRow>(`SELECT date, json, directive, stale FROM days ORDER BY date DESC`)
    .all();

  const entries: ArchiveEntry[] = [];
  for (const row of rows) {
    let title: string;
    try {
      title = titleOf(row.json);
    } catch {
      continue; // corrupt row: skip it (ruling 3)
    }
    entries.push({
      date: row.date,
      title,
      directive: row.directive,
      stale: row.stale !== 0,
    });
  }
  return Response.json(entries);
}
