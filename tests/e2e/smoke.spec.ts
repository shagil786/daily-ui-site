import { expect, test, type Page } from "@playwright/test";
import { getDb, listDays } from "../../lib/db";
import {
  BOGUS_DATE,
  E2E_DB_PATH,
  GENERATE_SECRET,
  SEED_DATES,
  TODAY,
  seedFixture,
} from "./seed";

/**
 * E2E smoke suite (single file, declaration order matters):
 *
 * 1. API on an EMPTY database — must run before the fixture is seeded.
 * 2. POST /api/generate auth/validation — never reaches an LLM provider.
 * 3. Seeded database — pages, archive navigation, unknown-type placeholder,
 *    404 path, and API shapes.
 *
 * The dev server is started by `playwright.config.ts` `webServer`
 * (`npm run dev`, port 3000, reuseExistingServer: true per the brief) with
 * `DATABASE_PATH` pointing at the isolated `tests/e2e/.tmp` database.
 */

type PageNoise = { consoleErrors: string[]; failedRequests: string[] };

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
    expect(rows.map((row) => row.date)).toEqual([...SEED_DATES]);
    expect(rows[0]?.stale).toBe(true);
    expect(rows[0]?.title).toBe("Coastal Dispatch");
  });

  test("today renders the fixture document in the theme wrapper", async ({ page }) => {
    const noise = trackNoise(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const themeRoot = page.getByTestId("theme-root");
    await expect(themeRoot).toBeVisible();
    await expect(themeRoot).toHaveAttribute("data-date", TODAY);
    await expect(themeRoot).toHaveAttribute("data-font", "serif");
    await expect(themeRoot).toHaveAttribute("data-dark", "false");
    // Today's row is seeded stale → the stale badge shows; no fallback happened.
    await expect(page.getByTestId("stale-badge")).toBeVisible();
    await expect(page.getByTestId("recent-badge")).toHaveCount(0);
    await expect(page.getByTestId("date-badge")).toHaveText(TODAY);
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
    await expect(rows).toHaveCount(SEED_DATES.length);

    const firstRow = rows.first();
    await expect(firstRow.getByTestId("archive-date")).toHaveText(TODAY);
    const firstLink = firstRow.getByRole("link");
    await expect(firstLink).toHaveAttribute("href", `/archive/${TODAY}`);

    await firstLink.click();
    await page.waitForURL((url) => url.pathname === `/archive/${TODAY}`);

    await expect(page.getByTestId("theme-root")).toHaveAttribute("data-date", TODAY);
    await expect(page.getByTestId("date-badge")).toHaveText(TODAY);
    await expect(page.getByRole("heading", { level: 1, name: "Coastal Dispatch" })).toBeVisible();

    await expectNoNoise(noise);
  });

  test("unknown component type degrades to a placeholder, not a crash", async ({ page }) => {
    const noise = trackNoise(page);
    await page.goto(`/archive/${BOGUS_DATE}`);

    await expect(page.getByTestId("theme-root")).toHaveAttribute("data-date", BOGUS_DATE);
    await expect(page.getByTestId("date-badge")).toHaveText(BOGUS_DATE);
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
    expect(entries).toHaveLength(SEED_DATES.length);
    expect(entries.map((entry) => entry.date)).toEqual([...SEED_DATES]);
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
});
