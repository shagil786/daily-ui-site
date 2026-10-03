#!/usr/bin/env node
/**
 * E2E port preflight.
 *
 * `playwright.config.ts` runs `webServer` with `reuseExistingServer: true`, so
 * when something already listens on port 3000 Playwright attaches to THAT
 * process instead of starting an isolated one — and `webServer.env` never
 * reaches it. The suite would then read the wrong `DATABASE_PATH` and could
 * make a real provider call, quietly breaking its no-network guarantee.
 *
 * This guard turns that silent hole into a loud failure: exit 1 with an
 * explanation when the port is busy, so the suite always runs against the
 * server it configured itself.
 *
 * Usage: `node scripts/check-port-free.mjs [port]` (default 3000).
 */
import { createServer } from "node:net";

const port = Number.parseInt(process.argv[2] ?? "3000", 10);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`check-port-free: invalid port "${process.argv[2]}"`);
  process.exit(2);
}

const probe = createServer();

probe.once("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      [
        `Port ${port} is already in use, so Playwright would reuse that server`,
        "instead of starting its own — and would not apply this suite's",
        "DATABASE_PATH / GENERATE_SECRET / empty LLM_* env.",
        "",
        "Stop whatever is listening on that port (e.g. a `npm run dev` you left",
        "running) and try again.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.error(`check-port-free: ${err.message}`);
  process.exit(2);
});

probe.once("listening", () => {
  probe.close(() => process.exit(0));
});

probe.listen(port, "127.0.0.1");