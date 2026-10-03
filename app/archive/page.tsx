import Link from "next/link";
import type { Metadata } from "next";
import { getDb, listDays } from "../../lib/db";

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

export default function ArchivePage() {
  // listDays() skips corrupt rows, so one unreadable row cannot break the listing.
  const entries = listDays(getDb());
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
