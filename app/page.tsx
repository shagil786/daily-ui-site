import type { Metadata } from "next";
import { getDay, getDb, getLatestDay, type DayRow } from "../lib/db";
import { todayLocal } from "../lib/date";
import { attemptRenderGeneration } from "../lib/generate";
import type { UiDocument } from "../lib/schema";
import { DocView, docTitle, parseStoredDoc } from "./doc-view";

/**
 * `/` — today's stored document, falling back to the latest stored row when
 * today has not been generated yet (same semantics as GET /api/today, read
 * server-side directly via `getDb()` — no fetch to our own API, ruling 6).
 * Empty table or a corrupt selected row → the "Nothing generated yet" empty
 * state instead of a crash (ruling 3).
 *
 * Spec §6: a miss (today's row missing OR unparseable) triggers ONE
 * server-side generation attempt — server-held `LLM_*` env only, never
 * `GENERATE_SECRET`, never more than once per 10-minute cooldown window. The
 * attempt never throws: on failure the existing latest-row fallback (with the
 * "showing most recent" badge) and the empty state below are unchanged.
 *
 * `force-dynamic`: the sqlite db mutates after build, so this route must read
 * fresh on every request — never serve build-time-baked HTML.
 */
export const dynamic = "force-dynamic";

type LoadedDay = { row: DayRow; doc: UiDocument; today: string };

async function loadToday(): Promise<LoadedDay | undefined> {
  const db = getDb();
  const today = todayLocal();
  // today's row if present, else the latest row overall (any older date)
  let row = getDay(db, today);
  // spec §6: missing OR corrupt today row = a miss → one generation attempt
  if (row === undefined || parseStoredDoc(row.json) === undefined) {
    await attemptRenderGeneration(db, today);
    row = getDay(db, today); // fresh row when the attempt succeeded
  }
  const selected = row ?? getLatestDay(db);
  if (selected === undefined) {
    return undefined;
  }
  const doc = parseStoredDoc(selected.json);
  if (doc === undefined) {
    // corrupt row: GET /api/today answers 500 here; a page must not crash, so
    // it degrades to the same empty state as a db miss (ruling 3).
    return undefined;
  }
  return { row: selected, doc, today };
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadToday();
  if (loaded === undefined) {
    return { title: "Daily UI Site" };
  }
  // Title from the document, date (if any) from the ROW — never doc.date.
  return {
    title: docTitle(loaded.doc),
    description: `A generated UI for ${loaded.row.date}.`,
  };
}

export default async function Home() {
  const loaded = await loadToday();
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
