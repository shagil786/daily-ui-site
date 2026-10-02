import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "../../lib/db";

/**
 * `/archive` — server-rendered list of every stored day, newest first:
 * date, title preview, directive, stale flag; each row links to
 * `/archive/[date]`. Direct `getDb()` read (no fetch to our own API).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Archive",
  description: "Every generated UI, newest first.",
};

type StoredRow = { date: string; json: string; directive: string; stale: number };
type ArchiveEntry = { date: string; title: string; directive: string; stale: boolean };

/**
 * Mirrors GET /api/archive: `listDays()` parses every title eagerly, so one
 * corrupt row would discard the whole listing — instead this walks the rows
 * and skips only the rows whose json cannot be parsed (same corrupt-row
 * handling as the API: skip, never an unhandled crash).
 */
function loadEntries(): ArchiveEntry[] {
  const rows = getDb()
    .prepare<[], StoredRow>(`SELECT date, json, directive, stale FROM days ORDER BY date DESC`)
    .all();

  const entries: ArchiveEntry[] = [];
  for (const row of rows) {
    let title: string;
    try {
      title = titleOf(row.json);
    } catch {
      continue; // corrupt row: skip it (API parity, ruling 3)
    }
    entries.push({
      date: row.date,
      title,
      directive: row.directive,
      stale: row.stale !== 0,
    });
  }
  return entries;
}

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

export default function ArchivePage() {
  const entries = loadEntries();
  if (entries.length === 0) {
    return (
      <main className="empty-state" data-testid="empty-state">
        <p>Nothing generated yet</p>
      </main>
    );
  }
  return (
    <main className="archive-page" data-testid="archive-page">
      <header className="archive-header">
        <h1>Archive</h1>
        <Link href="/">Today</Link>
      </header>
      <ul className="archive-list">
        {entries.map((entry) => (
          <li key={entry.date} className="archive-row" data-testid="archive-row">
            <Link
              href={`/archive/${encodeURIComponent(entry.date)}`}
              className="archive-row-link"
            >
              {/* row-key date (never doc.date) + text preview of the title */}
              <span className="archive-date" data-testid="archive-date">
                {entry.date}
              </span>
              <span className="archive-title">
                {entry.title === "" ? "Untitled" : entry.title}
              </span>
            </Link>
            <span className="archive-meta">
              {entry.stale ? (
                <span className="badge badge-stale" data-testid="stale-badge">
                  yesterday&apos;s
                </span>
              ) : null}
              <span className="archive-directive">{entry.directive}</span>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
