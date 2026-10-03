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
 * This guard turns that silent hole into a loud failure: exit 1 when the port
 * already has a listener, so the suite only ever runs against the server it
 * configured itself.
 *
 * Detection is by CONNECTING, not by binding: a bind test only proves that
 * *this* address is free, and a server on another interface (Next binds the
 * wildcard address) would slip past it. Both loopback families are tried so an
 * IPv6-only or IPv4-only listener is still caught.
 *
 * Usage: `node scripts/check-port-free.mjs [port]` (default 3000).
 */
import { connect } from "node:net";

const port = Number.parseInt(process.argv[2] ?? "3000", 10);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`check-port-free: invalid port "${process.argv[2]}"`);
  process.exit(2);
}

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    // A filtered/closed port must not hang the check.
    socket.setTimeout(1000, () => settle(false));
  });
}

const hosts = ["127.0.0.1", "::1"];
const results = await Promise.all(hosts.map(canConnect));
const busy = results.some(Boolean);

if (busy) {
  console.error(
    [
      `Port ${port} already has a listener, so Playwright would reuse that`,
      "server instead of starting its own — and would not apply this suite's",
      "DATABASE_PATH / GENERATE_SECRET / empty LLM_* env.",
      "",
      "Stop whatever is listening on that port (e.g. a `npm run dev` you left",
      "running) and try again.",
    ].join("\n"),
  );
  process.exit(1);
}

process.exit(0);