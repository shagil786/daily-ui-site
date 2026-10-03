import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeSurface } from "../../app/theme-surface";
import type { UiDocument } from "../../lib/schema";

/**
 * `ThemeSurface` in isolation — no page or db machinery. Importing `DocView`
 * would drag in `next/link` (needs App Router context that jsdom lacks) and
 * the page/db path; this component is pure markup, so it renders directly.
 *
 * The date attribute is the load-bearing contract: a preview passes no
 * `date`, and `data-date` must then be ABSENT rather than empty so a
 * consumer can never read a missing date as today's.
 */

afterEach(cleanup);

/** Valid document of the same shape as the fixtures in renderer.test.tsx. */
function fixtureDoc(): UiDocument {
  return {
    version: 1,
    date: "2026-10-03",
    title: "Theme surface fixture",
    theme: { bg: "#0f1020", fg: "#f5f5ff", accent: "#ff3366", font: "sans", dark: true },
    root: {
      id: "root",
      componentType: "Section",
      props: { heading: "Hello" },
      children: [{ id: "t1", componentType: "Text", props: { text: "Body copy" } }],
    },
  };
}

describe("ThemeSurface", () => {
  it("omits data-date when no date is given", () => {
    render(<ThemeSurface doc={fixtureDoc()} />);
    const root = screen.getByTestId("theme-root");
    expect(root.hasAttribute("data-date")).toBe(false);
  });

  /**
   * The full set of theme outputs on the wrapper, in one place on purpose:
   * `--fg`, `--accent`, and the `font-*` class had NO coverage anywhere in the
   * repo, so dropping one of them left every other test green while silently
   * breaking the theme. The e2e suite covers `data-date`/`data-font`/
   * `data-dark`, and this test covers everything it does not.
   */
  it("emits the font class, all three custom properties, and the data hooks", () => {
    render(<ThemeSurface doc={fixtureDoc()} date="2026-10-03" />);
    const root = screen.getByTestId("theme-root");

    expect(root.className).toBe(`theme-root font-${fixtureDoc().theme.font}`);
    expect(root.style.getPropertyValue("--bg")).toBe(fixtureDoc().theme.bg);
    expect(root.style.getPropertyValue("--fg")).toBe(fixtureDoc().theme.fg);
    expect(root.style.getPropertyValue("--accent")).toBe(fixtureDoc().theme.accent);
    expect(root.getAttribute("data-date")).toBe("2026-10-03");
    expect(root.getAttribute("data-font")).toBe(fixtureDoc().theme.font);
    expect(root.getAttribute("data-dark")).toBe(String(fixtureDoc().theme.dark));
  });
});
