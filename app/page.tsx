import type { Metadata } from "next";
import { getDay, getDb, getLatestDay, type DayRow } from "../lib/db";
import type { UiDocument } from "../lib/schema";
import { DocView, docTitle, parseStoredDoc, todayLocal } from "./doc-view";

/**
 * `/` — today's stored document, falling back to the latest stored row when
 * today has not been generated yet (same semantics as GET /api/today, read
 * server-side directly via `getDb()` — no fetch to our own API, ruling 6).
 * Empty table or a corrupt selected row → the "Nothing generated yet" empty
 * state instead of a crash (ruling 3).
 *
 * `force-dynamic`: the sqlite db mutates after build, so this route must read
 * fresh on every request — never serve build-time-baked HTML.
 */
export const dynamic = "force-dynamic";

type LoadedDay = { row: DayRow; doc: UiDocument; today: string };

function loadToday(): LoadedDay | undefined {
  const db = getDb();
  const today = todayLocal();
  // today's row if present, else the latest row overall (any older date)
  const row = getDay(db, today) ?? getLatestDay(db);
  if (row === undefined) {
    return undefined;
  }
  const doc = parseStoredDoc(row.json);
  if (doc === undefined) {
    // corrupt row: GET /api/today answers 500 here; a page must not crash, so
    // it degrades to the same empty state as a db miss (ruling 3).
    return undefined;
  }
  return { row, doc, today };
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = loadToday();
  if (loaded === undefined) {
    return { title: "Daily UI Site" };
  }
  // Title from the document, date (if any) from the ROW — never doc.date.
  return {
    title: docTitle(loaded.doc),
    description: `A generated UI for ${loaded.row.date}.`,
  };
}

export default function Home() {
  const loaded = loadToday();
  if (loaded === undefined) {
    return (
      <main className="empty-state" data-testid="empty-state">
        <p>Nothing generated yet</p>
      </main>
    );
  }
  const { row, doc, today } = loaded;
  return (
    <DocView
      doc={doc}
      date={row.date}
      stale={row.stale}
      showingRecent={row.date !== today}
    />
  );
}
