import Link from "next/link";
import type { CSSProperties } from "react";
import { Renderer } from "../lib/renderer";
import type { UiDocument } from "../lib/schema";

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

/**
 * Theme colors as CSS custom properties consumed by `.theme-root` in
 * globals.css. The `as CSSProperties` cast is the one narrow, sanctioned
 * exception to the strict-cast rule: React's `CSSProperties` declares no
 * index signature for `--*` custom properties, and Next forbids mutating
 * `<html>` server-side, so the variables live on a wrapper div instead.
 */
function themeVars(theme: UiDocument["theme"]): CSSProperties {
  return {
    "--bg": theme.bg,
    "--fg": theme.fg,
    "--accent": theme.accent,
  } as CSSProperties;
}

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
 * Themed document view: wrapper div carrying `--bg/--fg/--accent`, the
 * font-family class derived from `theme.font`, the fixed corner badge
 * (date + `/archive` link), optional stale / "showing most recent" badges,
 * and the recursive renderer.
 */
export function DocView({
  doc,
  date,
  stale,
  showingRecent = false,
}: DocViewProps) {
  return (
    <div
      className={`theme-root font-${doc.theme.font}`}
      data-testid="theme-root"
      data-date={date}
      data-font={doc.theme.font}
      data-dark={String(doc.theme.dark)}
      style={themeVars(doc.theme)}
    >
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
    </div>
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

/**
 * Today's local calendar date as YYYY-MM-DD — same local-time rule as
 * GET /api/today (routes share this semantic, not this module).
 */
export function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
