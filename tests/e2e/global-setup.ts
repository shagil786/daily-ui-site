import fs from "node:fs";
import type { FullConfig } from "@playwright/test";
import { getDb } from "../../lib/db";
import { E2E_DB_PATH, E2E_TMP_DIR } from "./seed";

/**
 * Runs before the suite (Playwright starts `webServer` first, but the server
 * only opens the database on the first request — i.e. after this hook).
 *
 * Replaces any leftover e2e database with a fresh EMPTY file so the pre-seed
 * API assertions (`GET /api/today` → 404 `no-ui`, empty `GET /api/archive`)
 * are deterministic regardless of what a previous run left behind. The actual
 * fixture seeding happens inside the spec, after those assertions.
 *
 * Returns the teardown hook that removes the database again, so e2e leaves no
 * artifacts behind.
 */
export default function globalSetup(_config: FullConfig): () => void {
  fs.rmSync(E2E_TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_TMP_DIR, { recursive: true });
  getDb(E2E_DB_PATH); // creates the schema on a brand-new file
  return () => {
    fs.rmSync(E2E_TMP_DIR, { recursive: true, force: true });
  };
}
