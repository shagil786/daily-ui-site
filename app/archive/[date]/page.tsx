import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDay, getDb } from "../../../lib/db";
import { DocView, docTitle, parseStoredDoc } from "../../doc-view";

/**
 * `/archive/[date]` — one stored day's document rendered through the same
 * `DocView` as `/`. Missing or corrupt row → `notFound()` (Next's not-found →
 * 404, ruling 5; the API route maps the same cases to 404/500).
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ date: string }> };

function loadDay(date: string) {
  // route param is the db row key, so row.date === date once found; the badge
  // and metadata always display that row/route date, never doc.date.
  const row = getDay(getDb(), date);
  if (row === undefined) {
    return undefined;
  }
  const doc = parseStoredDoc(row.json);
  if (doc === undefined) {
    return undefined; // corrupt row → notFound() (ruling 5)
  }
  return { row, doc };
}

export async function generateMetadata({ params }: RouteContext): Promise<Metadata> {
  const { date } = await params;
  const loaded = loadDay(date);
  if (loaded === undefined) {
    return { title: "Daily UI Site" };
  }
  return {
    title: docTitle(loaded.doc),
    description: `A generated UI for ${loaded.row.date}.`,
  };
}

export default async function ArchiveDayPage({ params }: RouteContext) {
  const { date } = await params;
  const loaded = loadDay(date);
  if (loaded === undefined) {
    notFound();
  }
  const { row, doc } = loaded;
  return <DocView doc={doc} date={row.date} stale={row.stale} />;
}
