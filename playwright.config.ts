import { defineConfig } from "@playwright/test";
import { E2E_DB_PATH, GENERATE_SECRET } from "./tests/e2e/seed";

/**
 * E2E smoke suite (`npm run test:e2e`).
 *
 * Server: Playwright's `webServer` runs `npm run dev` on port 3000 with
 * `reuseExistingServer: true` (per the task brief); the production build is
 * verified separately by the `npm run build` gate.
 *
 * Determinism / isolation:
 * - `DATABASE_PATH` points at `tests/e2e/.tmp/days.db`, freshly emptied by
 *   `tests/e2e/global-setup.ts` before the run and removed again afterwards.
 *   The spec seeds that file with `tests/fixtures/sample-doc.json` AFTER the
 *   empty-database API assertions.
 * - `GENERATE_SECRET` is a fixed test value; `LLM_PROVIDER`/`LLM_API_KEY` are
 *   forced empty so POST /api/generate fails with 502 before any network call.
 *
 * `fullyParallel: false` because the single spec file relies on declaration
 * order: the empty-database API checks must run before the fixture is seeded.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
    env: {
      DATABASE_PATH: E2E_DB_PATH,
      GENERATE_SECRET,
      // No provider configured → generate must 502 locally, never call an API.
      LLM_PROVIDER: "",
      LLM_API_KEY: "",
    },
  },
});
