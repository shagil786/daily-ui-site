import type { CSSProperties, JSX, ReactNode } from "react";
import type { UiDocument } from "../lib/schema";

/**
 * Theme wrapper extracted from `DocView` so a future Client Component can
 * reuse the same themed surface without pulling in page/db machinery. It owns
 * only what is theme-level: the `.theme-root` classes, the three CSS custom
 * properties, and the `data-*` hooks the e2e suite matches on.
 *
 * It deliberately does NOT own the `corner-badges` container: that block also
 * holds the date chip and the `/archive` link, which a preview has no use for.
 * The caller passes its own badges block as `children`, so `DocView`'s
 * rendered DOM stays byte-identical.
 *
 * Date invariant (carried ruling, Task 10 review): `date` is the ROW/ROUTE
 * date passed in by the caller, NEVER `doc.date` — stale rows legitimately
 * carry yesterday's inner date. When `date` is omitted (previews) the
 * `data-date` attribute is ABSENT rather than empty, so a consumer can never
 * read a missing date as today's.
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

type ThemeSurfaceProps = {
  doc: UiDocument;
  /** Row/route date (YYYY-MM-DD); omitted for previews, which have no row. */
  date?: string;
  /** Caller's own content — rendered inside the wrapper. */
  children?: ReactNode;
};

/**
 * The `.theme-root` div: `font-${theme.font}` class, `--bg/--fg/--accent`
 * custom properties, and the `theme-root` / `data-font` / `data-dark` hooks.
 * A Server Component — no state or effects, so no `"use client"` needed.
 */
export function ThemeSurface({ doc, date, children }: ThemeSurfaceProps): JSX.Element {
  return (
    <div
      className={`theme-root font-${doc.theme.font}`}
      data-testid="theme-root"
      data-date={date}
      data-font={doc.theme.font}
      data-dark={String(doc.theme.dark)}
      style={themeVars(doc.theme)}
    >
      {children}
    </div>
  );
}