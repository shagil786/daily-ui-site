import Link from "next/link";
import { Renderer } from "../lib/renderer";
import type { UiDocument } from "../lib/schema";
import { ThemeSurface } from "./theme-surface";

/**
 * Shared server-side pieces for the pages that render stored documents
 * (`/` and `/archive/[date]`). `DocView` is a Server Component; the recursive
 * `Renderer` below it is the one client island (declared in renderer.tsx —
 * its class error boundary needs the full React runtime) and receives the
 * node tree as plain JSON props.
 *
 * Date invariant (carried ruling, Task 10 review): every displayed date —
 * corner badge, metadata, `data-date` — comes from the ROW/ROUTE date passed
 * in by the caller, NEVER from `doc.date`: stale rows legitimately carry
 * yesterday's inner date.
 */

type DocViewProps = {
  doc: UiDocument;
  /** Row/route date (YYYY-MM-DD) — the only date ever rendered. */
  date: string;
  /** `row.stale` — renders the small "yesterday's" badge. */
  stale: boolean;
  /** True when today's row was missing and an older row is shown instead. */
  showingRecent?: boolean;
};

/**
 * Themed document view: the shared `ThemeSurface` wrapper (theme custom
 * properties, font-family class, `data-*` hooks) carrying the fixed corner
 * badge block (date + `/archive` link, optional stale / "showing most recent"
 * badges) and the recursive renderer.
 *
 * `corner-badges` stays here, not in `ThemeSurface`, because it holds the
 * `/archive` link — a preview has no use for it.
 */
export function DocView({
  doc,
  date,
  stale,
  showingRecent = false,
}: DocViewProps) {
  return (
    <ThemeSurface doc={doc} date={date}>
      <div className="corner-badges" data-testid="corner-badges">
        {stale ? (
          <span className="badge badge-stale" data-testid="stale-badge">
            yesterday&apos;s
          </span>
        ) : null}
        {showingRecent ? (
          <span className="badge badge-recent" data-testid="recent-badge">
            showing most recent
          </span>
        ) : null}
        <span className="badge badge-date" data-testid="date-badge">
          {date}
        </span>
        <Link href="/archive" className="badge badge-link" data-testid="archive-link">
          archive
        </Link>
      </div>
      <main className="doc-body">
        <Renderer node={doc.root} />
      </main>
    </ThemeSurface>
  );
}

/**
 * JSON.parse guard for a stored row: returns `undefined` when the row is
 * corrupt (invalid JSON or a structurally unusable document), so pages degrade
 * instead of crashing — the page-level counterpart of the API routes'
 * `{error:"corrupt"}` defense (ruling 3/5: single-day pages map this to
 * `notFound()`).
 *
 * Deliberately lighter than `validateDocument`: what GET /api/today serves,
 * these pages render — unknown component types and bad props are already
 * contained by `Renderer`'s error boundary, and only `root`/`theme` shape is
 * load-bearing for the page shell itself.
 */
export function parseStoredDoc(json: string): UiDocument | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const candidate = parsed as { theme?: unknown; root?: unknown };
  if (
    typeof candidate.theme !== "object" ||
    candidate.theme === null ||
    Array.isArray(candidate.theme)
  ) {
    return undefined;
  }
  if (
    typeof candidate.root !== "object" ||
    candidate.root === null ||
    Array.isArray(candidate.root)
  ) {
    return undefined;
  }
  const root = candidate.root as { componentType?: unknown };
  if (typeof root.componentType !== "string") {
    return undefined;
  }
  return parsed as UiDocument;
}

/** Usable metadata title; a missing/empty/non-string stored title falls back. */
export function docTitle(doc: UiDocument): string {
  const raw: unknown = doc.title;
  return typeof raw === "string" && raw.trim() !== "" ? raw : "Daily UI Site";
}

// The local-calendar "today" rule lives in lib/date.ts so the pages and every
// route share one implementation.
