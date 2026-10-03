import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getDb, listDays } from "../../lib/db";
import type { UiDocument } from "../../lib/schema";
import {
  bogusDate,
  E2E_DB_PATH,
  GENERATE_SECRET,
  seedDates,
  seedFixture,
  today,
} from "./seed";

/**
 * E2E smoke suite (single file, declaration order matters):
 *
 * 1. API on an EMPTY database — must run before the fixture is seeded.
 * 2. POST /api/generate auth/validation — never reaches an LLM provider.
 * 3. Seeded database — pages, archive navigation, unknown-type placeholder,
 *    404 path, API shapes, and the visitor preview (last, on a populated db).
 *
 * The dev server is started by `playwright.config.ts` `webServer`
 * (`npm run dev`, port 3000, reuseExistingServer: true per the brief) with
 * `DATABASE_PATH` pointing at the isolated `tests/e2e/.tmp` database.
 *
 * SELECTOR HAZARD, and why every preview assertion is scoped: with the preview
 * open on a POPULATED database the page contains TWO
 * `[data-testid="theme-root"]` elements (today's `DocView` and the preview's —
 * `ThemeSurface` hardcodes that test id for both, and it is off-limits to
 * edit) and THREE elements whose text is "Coastal Dispatch" (today's `h1`, the
 * preview region's own `h2` title, and the previewed fixture's Hero `h1` — two
 * of those three are inside the region alone). Playwright locators are strict,
 * so a page-wide `getByTestId("theme-root")` / `getByText("Coastal Dispatch")`
 * throws "strict mode violation" the moment a preview is open — scoping to
 * `preview-region` alone is not enough for a bare text match. Every preview
 * selector below is therefore anchored inside `preview-region` AND pinned to a
 * role, level or class, and today's document is reached through
 * `[data-testid="theme-root"][data-date]` — the one attribute a preview never
 * has (a preview has no row date). The pre-existing assertions stay page-wide
 * and remain safe only because the disclosure starts collapsed.
 */

type PageNoise = { consoleErrors: string[]; failedRequests: string[] };

/** The shipped fixture document — exactly what a fulfilled `200 { doc }` returns. */
const FIXTURE_PATH = path.resolve(__dirname, "..", "fixtures", "sample-doc.json");
const sampleDoc = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as UiDocument;

/** A brief long enough to clear the route's 8-character minimum. */
const PREVIEW_BRIEF = "a neon cyberpunk dashboard";

/** Collect console errors, uncaught page errors and non-aborted failed requests. */
function trackNoise(page: Page): PageNoise {
  const noise: PageNoise = { consoleErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      noise.consoleErrors.push(`${message.text()} (${message.location().url})`);
    }
  });
  page.on("pageerror", (error) => {
    noise.consoleErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    // Cancelled subrequests (e.g. aborted prefetches) are not failures.
    if (errorText !== "net::ERR_ABORTED") {
      noise.failedRequests.push(`${errorText} → ${request.url()}`);
    }
  });
  return noise;
}

/**
 * Page loads must be free of console errors and failed requests.
 * `expected404Url` whitelists the single console error a deliberately-404'd
 * document produces (Chromium logs "Failed to load resource ... 404" for the
 * navigation itself) — keyed to that exact resource URL, nothing else.
 */
async function expectNoNoise(noise: PageNoise, expected404Url?: string): Promise<void> {
  const consoleErrors =
    expected404Url === undefined
      ? noise.consoleErrors
      : noise.consoleErrors.filter((text) => !text.endsWith(`(${expected404Url})`));
  expect(consoleErrors).toEqual([]);
  expect(noise.failedRequests).toEqual([]);
}

/**
 * Intercept POST /api/preview and fulfil it with a fixed body, so the preview
 * flow is exercised end to end without a provider. `playwright.config.ts`
 * forces `LLM_PROVIDER=""`/`LLM_API_KEY=""`, which is exactly why this stub is
 * required: a real call would answer 503 `unavailable`. A 200 is fulfilled as
 * `{ doc }` (the route's only success body); any other status is fulfilled
 * verbatim, which is what the documented failure bodies already are.
 */
async function stubPreview(page: Page, doc: unknown, status = 200): Promise<void> {
  await page.route("**/api/preview", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? { doc } : doc),
    }),
  );
}

/** Open the disclosure, type `PREVIEW_BRIEF` and request a preview. */
async function generatePreview(page: Page): Promise<void> {
  await page.getByTestId("preview-toggle").click();
  await page.getByTestId("preview-input").fill(PREVIEW_BRIEF);
  await page.getByTestId("preview-generate").click();
}

test.describe("API on an empty database (before seeding)", () => {
  test("GET /api/today → 404 {error: no-ui}", async ({ request }) => {
    const response = await request.get("/api/today");
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "no-ui" });
  });

  test("GET /api/archive → []", async ({ request }) => {
    const response = await request.get("/api/archive");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

test.describe("POST /api/generate auth and validation (no LLM calls)", () => {
  test("missing x-generate-secret → 401", async ({ request }) => {
    const response = await request.post("/api/generate", { data: {} });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("wrong x-generate-secret → 401", async ({ request }) => {
    const response = await request.post("/api/generate", {
      headers: { "x-generate-secret": "not-the-secret" },
      data: {},
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("valid secret with malformed date → 400 bad-date", async ({ request }) => {
    const response = await request.post("/api/generate", {
      headers: { "x-generate-secret": GENERATE_SECRET },
      data: { date: "not-a-date" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "bad-date" });
  });

  test("valid date without provider config → 502, immediate repeat → 429", async ({
    request,
  }) => {
    const headers = { "x-generate-secret": GENERATE_SECRET };
    // LLM_PROVIDER is forced empty in playwright.config.ts, so provider
    // creation fails locally — no network call is ever made.
    const first = await request.post("/api/generate", {
      headers,
      data: { date: "2000-01-01" },
    });
    expect(first.status()).toBe(502);
    expect(await first.json()).toEqual({ error: "generation-failed" });

    const second = await request.post("/api/generate", {
      headers,
      data: { date: "2000-01-01" },
    });
    expect(second.status()).toBe(429);
    expect(await second.json()).toEqual({ error: "rate-limited" });
  });
});

test.describe("seeded database", () => {
  test("seed the fixture rows", () => {
    seedFixture();
    const rows = listDays(getDb(E2E_DB_PATH));
    expect(rows.map((row) => row.date)).toEqual([...seedDates()]);
    expect(rows[0]?.stale).toBe(true);
    expect(rows[0]?.title).toBe("Coastal Dispatch");
  });

  test("today renders the fixture document in the theme wrapper", async ({ page }) => {
    const noise = trackNoise(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const themeRoot = page.getByTestId("theme-root");
    await expect(themeRoot).toBeVisible();
    await expect(themeRoot).toHaveAttribute("data-date", today());
    await expect(themeRoot).toHaveAttribute("data-font", "serif");
    await expect(themeRoot).toHaveAttribute("data-dark", "false");
    // Today's row is seeded stale → the stale badge shows; no fallback happened.
    await expect(page.getByTestId("stale-badge")).toBeVisible();
    await expect(page.getByTestId("recent-badge")).toHaveCount(0);
    await expect(page.getByTestId("date-badge")).toHaveText(today());
    await expect(page.getByTestId("archive-link")).toHaveAttribute("href", "/archive");
    await expect(page.getByRole("heading", { level: 1, name: "Coastal Dispatch" })).toBeVisible();

    // ≥5 distinct component types from the fixture are visible on the page.
    const componentMarkers = [
      page.getByRole("heading", { level: 1, name: "Coastal Dispatch" }), // Hero
      page.getByRole("heading", { level: 2, name: "Today at a glance" }), // Section
      page.getByText("Sixty-two percent", { exact: false }), // Text
      page.getByRole("progressbar"), // ProgressBar
      page.getByRole("heading", { level: 3, name: "Tide tables" }), // Card
      page.getByRole("link", { name: "Harbour bulletin" }), // LinkList
      page.getByText("Lifeboat drill at the station, 19:00."), // Timeline
    ];
    const visible = await Promise.all(
      componentMarkers.map((marker) => marker.first().isVisible()),
    );
    expect(visible.filter((isVisible) => isVisible).length).toBeGreaterThanOrEqual(5);

    await expectNoNoise(noise);
  });

  test("archive navigates to the day page", async ({ page }) => {
    const noise = trackNoise(page);
    await page.goto("/archive");
    await expect(page.getByTestId("archive-page")).toBeVisible();

    const rows = page.getByTestId("archive-row");
    await expect(rows).toHaveCount(seedDates().length);

    const firstRow = rows.first();
    await expect(firstRow.getByTestId("archive-date")).toHaveText(today());
    const firstLink = firstRow.getByRole("link");
    await expect(firstLink).toHaveAttribute("href", `/archive/${today()}`);

    await firstLink.click();
    await page.waitForURL((url) => url.pathname === `/archive/${today()}`);

    await expect(page.getByTestId("theme-root")).toHaveAttribute("data-date", today());
    await expect(page.getByTestId("date-badge")).toHaveText(today());
    await expect(page.getByRole("heading", { level: 1, name: "Coastal Dispatch" })).toBeVisible();

    await expectNoNoise(noise);
  });

  test("archive rows fit a 390px viewport without overlapping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/archive");

    const rows = page.getByTestId("archive-row");
    await expect(rows).toHaveCount(seedDates().length);

    for (let i = 0; i < seedDates().length; i += 1) {
      const row = rows.nth(i);
      const rowBox = await row.boundingBox();
      const linkBox = await row.locator(".archive-row-link").boundingBox();
      const metaBox = await row.locator(".archive-meta").boundingBox();
      expect(rowBox).not.toBeNull();
      expect(linkBox).not.toBeNull();
      expect(metaBox).not.toBeNull();
      if (rowBox === null || linkBox === null || metaBox === null) {
        throw new Error(`archive row ${i} is not laid out`);
      }

      // Nothing may spill past the viewport (the date chip refuses to shrink,
      // so a narrow screen used to push the row past the right edge).
      const rightMost = Math.max(
        rowBox.x + rowBox.width,
        linkBox.x + linkBox.width,
        metaBox.x + metaBox.width,
      );
      expect(rightMost, `archive row ${i} overflows 390px`).toBeLessThanOrEqual(390);

      // Title link and meta chips must not sit on top of each other.
      const sharesX =
        linkBox.x < metaBox.x + metaBox.width - 1 && metaBox.x < linkBox.x + linkBox.width - 1;
      const sharesY =
        linkBox.y < metaBox.y + metaBox.height - 1 && metaBox.y < linkBox.y + linkBox.height - 1;
      expect(sharesX && sharesY, `archive row ${i} overlaps its meta column`).toBe(false);
    }
  });

  test("unknown component type degrades to a placeholder, not a crash", async ({ page }) => {
    const noise = trackNoise(page);
    await page.goto(`/archive/${bogusDate()}`);

    await expect(page.getByTestId("theme-root")).toHaveAttribute("data-date", bogusDate());
    await expect(page.getByTestId("date-badge")).toHaveText(bogusDate());
    await expect(page.getByTestId("unknown-component")).toBeVisible();
    await expect(page.getByTestId("node-error")).toHaveCount(0);
    // Siblings of the bogus node keep rendering.
    await expect(page.getByRole("heading", { level: 1, name: "Coastal Dispatch" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Notes" })).toBeVisible();

    await expectNoNoise(noise);
  });

  test("unknown archive date shows the not-found state", async ({ page }) => {
    const noise = trackNoise(page);
    const response = await page.goto("/archive/1999-01-01");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
    // Only the intentional document 404 may be reported; everything else clean.
    await expectNoNoise(noise, page.url());
  });

  test("GET /api/archive → [{date, title, directive, stale}]", async ({ request }) => {
    const response = await request.get("/api/archive");
    expect(response.status()).toBe(200);
    const entries = (await response.json()) as Array<{
      date: string;
      title: string;
      directive: string;
      stale: boolean;
    }>;
    expect(entries).toHaveLength(seedDates().length);
    expect(entries.map((entry) => entry.date)).toEqual([...seedDates()]);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(["date", "directive", "stale", "title"]);
      expect(entry.title).toBe("Coastal Dispatch");
      expect(typeof entry.directive).toBe("string");
      expect(typeof entry.stale).toBe("boolean");
    }
    expect(entries[0]?.stale).toBe(true);
  });

  test("GET /api/archive/1999-01-01 → 404 {error: not-found}", async ({ request }) => {
    const response = await request.get("/api/archive/1999-01-01");
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });

  test("GET /api/today → the seeded fixture document", async ({ request }) => {
    const response = await request.get("/api/today");
    expect(response.status()).toBe(200);
    const doc = (await response.json()) as {
      title?: unknown;
      root?: { componentType?: unknown };
    };
    expect(doc.title).toBe("Coastal Dispatch");
    expect(doc.root?.componentType).toBe("Stack");
  });

  test("preview renders a described UI through the same renderer", async ({ page }) => {
    const noise = trackNoise(page);
    await stubPreview(page, sampleDoc);
    await page.goto("/");
    await generatePreview(page);

    const region = page.getByTestId("preview-region");
    await expect(region).toBeVisible();

    // Scoped to `region` throughout — see the selector hazard in the header.
    const previewTheme = region.getByTestId("theme-root");
    await expect(previewTheme).toHaveCount(1);
    await expect(previewTheme).toHaveAttribute("data-font", "serif");
    await expect(previewTheme).toHaveAttribute("data-dark", "false");
    // A preview has no row, so ThemeSurface omits `data-date` rather than
    // emptying it: nothing inside the region may look like a stored day.
    await expect(previewTheme).not.toHaveAttribute("data-date", /.+/);

    // The generated title, as the region's own heading (the fixture's Hero also
    // renders "Coastal Dispatch", inside the region, as an `h1` — hence the
    // level and the scoping rather than a bare text match).
    await expect(region.getByRole("heading", { level: 2, name: "Coastal Dispatch" })).toBeVisible();

    // Same renderer as the daily document: three different fixture component
    // types resolve to real roles inside the preview region.
    await expect(region.getByRole("progressbar")).toBeVisible();
    await expect(region.getByRole("heading", { level: 3, name: "Tide tables" })).toBeVisible();
    await expect(region.getByRole("link", { name: "Harbour bulletin" })).toBeVisible();

    // Review focus #5: a preview carries no date chip, and its marker is the
    // preview chip — never the "showing most recent" chip of a stored row.
    await expect(region.locator("[data-date]")).toHaveCount(0);
    await expect(region.getByTestId("date-badge")).toHaveCount(0);
    await expect(region.getByTestId("corner-badges")).toHaveCount(0);
    await expect(region.locator(".badge-preview")).toHaveText("preview");
    await expect(region.locator(".badge-recent")).toHaveCount(0);

    // The echoed brief and a way back, both unique on the page.
    await expect(page.getByTestId("preview-summary")).toContainText(PREVIEW_BRIEF);
    await expect(page.getByTestId("preview-back")).toBeVisible();
    await expect(page.getByTestId("preview-error")).toHaveCount(0);

    // The daily document is untouched, and it is still the only one with a row
    // date: exactly one of the two duplicate theme roots carries `data-date`.
    const todayTheme = page.locator('[data-testid="theme-root"][data-date]');
    await expect(todayTheme).toHaveCount(1);
    await expect(todayTheme).toHaveAttribute("data-date", today());
    await expect(page.getByTestId("stale-badge")).toBeVisible();
    // The duplicate is real — the reason nothing above is page-wide.
    await expect(page.getByTestId("theme-root")).toHaveCount(2);
    // A preview is a block on the page, not a second page: still one landmark.
    await expect(page.getByRole("main")).toHaveCount(1);

    await expectNoNoise(noise);
  });

  test("preview error states are shown inline", async ({ page }) => {
    // No `trackNoise` here on purpose: Chromium logs a console error for a
    // non-2xx fetch, so the only thing this test asserts is the visitor-facing
    // behaviour. The remaining documented codes are covered in
    // tests/unit/preview-box.test.tsx.
    await stubPreview(page, { error: "cooldown", retryAfterMinutes: 7 }, 429);
    await page.goto("/");
    await generatePreview(page);

    const alert = page.getByTestId("preview-error");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Try again in 7 minutes");

    // A failure swaps nothing: no preview region, and the daily document is
    // still the single (dated) theme root. Both selectors are safe here
    // precisely because no second `theme-root` was created.
    await expect(page.getByTestId("preview-region")).toHaveCount(0);
    await expect(page.getByTestId("theme-root")).toHaveCount(1);
    await expect(page.getByTestId("theme-root")).toHaveAttribute("data-date", today());
    // The visitor can edit the brief and retry without reopening the box.
    await expect(page.getByTestId("preview-input")).toBeVisible();
  });

  test("a structurally wrong preview document degrades instead of blanking the page", async ({
    page,
  }) => {
    const noise = trackNoise(page);
    // The fixture cloned with ONE componentType changed — the same technique
    // tests/e2e/seed.ts uses for its MysteryWidget row.
    const brokenDoc = structuredClone(sampleDoc);
    brokenDoc.root.componentType = "NoSuchWidget";
    await stubPreview(page, brokenDoc);
    await page.goto("/");
    await generatePreview(page);

    const region = page.getByTestId("preview-region");
    await expect(region).toBeVisible();

    // The unknown root degrades to the placeholder, inside the preview only,
    // and no node error boundary tripped on the way.
    const placeholder = region.getByTestId("unknown-component");
    await expect(placeholder).toHaveCount(1);
    // The placeholder names the type in dev; this is the only assertion here
    // that depends on the dev server `playwright.config.ts` starts.
    await expect(placeholder).toHaveText("NoSuchWidget");
    await expect(region.getByTestId("node-error")).toHaveCount(0);

    // The preview's own shell survives, so the visitor can still read what they
    // asked for and get back out.
    await expect(region.getByTestId("theme-root")).toHaveCount(1);
    await expect(region.getByRole("heading", { level: 2, name: "Coastal Dispatch" })).toBeVisible();
    await expect(page.getByTestId("preview-back")).toBeVisible();
    await expect(page.getByTestId("preview-error")).toHaveCount(0);

    // Today's document is still fully rendered above the degraded preview.
    const todayTheme = page.locator('[data-testid="theme-root"][data-date]');
    await expect(todayTheme).toHaveCount(1);
    await expect(todayTheme).toHaveAttribute("data-date", today());
    const main = page.locator("main");
    await expect(main).toHaveCount(1);
    await expect(main.getByRole("heading", { level: 1, name: "Coastal Dispatch" })).toBeVisible();
    await expect(main.getByRole("progressbar")).toBeVisible();
    // Exactly one placeholder page-wide: the daily document has none.
    await expect(page.getByTestId("unknown-component")).toHaveCount(1);

    await expectNoNoise(noise);
  });
});
