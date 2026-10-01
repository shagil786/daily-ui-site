# Daily UI Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js site that serves an LLM-generated random UI each day, validated against a Zod schema and rendered through a typed component registry, with a browsable archive.

**Architecture:** Schema-first: the agent emits a `UiDocument` tree validated by Zod (limits, per-component props) before it ever renders; a registry maps `componentType` to React components. SQLite stores each day's doc; a provider-abstracted LLM pipeline generates with retry and stale-fallback. Server components render theme CSS variables + recursive renderer.

**Tech Stack:** Next.js (App Router, TypeScript), Zod, better-sqlite3, Vitest + @testing-library/react, Playwright, tsx (CLI).

**Spec:** `docs/superpowers/specs/2026-10-02-daily-ui-site-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Depth ≤ 8 and total nodes ≤ 300, enforced as hard Zod limits (`LIMITS.maxDepth`, `LIMITS.maxNodes`).
- No `dangerouslySetInnerHTML`, no `eval`, no callback/function values anywhere in the schema.
- Images: `https` only, hostname allowlist enforced by a Zod refine in the image prop schema.
- Zod validation must pass before any document is rendered or stored.
- No secrets in the client bundle: `LLM_API_KEY` and `GENERATE_SECRET` are server-side only.
- `POST /api/generate` requires header `x-generate-secret` matching `GENERATE_SECRET`.
- LLM chosen via env `LLM_PROVIDER` (`openai` | `anthropic`) + `LLM_API_KEY` (provider may be configured later — both must work).
- Registry must contain exactly these component types: `Stack, Grid, SplitPane, Tabs, Timeline, Center, Section, Hero, Text, Card, ImageGallery, LinkList, BeforeAfter, TerminalSim, Counter, Todo, Poll, Clock, Clicker, Marquee, CanvasNoise, ProgressBar, Accordion` (23; registry is the only place components are added).
- All packages installed with the repo's package manager; no new frameworks beyond the list above.

## Review Focus

Failure modes the spec implies but no single feature's happy path exercises — each has a pinned test in its owning task:

1. **LLM returns truncated/malformed JSON** — extractor pulls the first parseable JSON object; one repair retry; then stale fallback (pinned in Task 9 tests).
2. **First-ever run with empty DB and failing generation** — `GET /api/today` returns 404 `{error:"no-ui"}`, today page shows "Nothing generated yet", no crash (pinned in Task 11 tests).
3. **Hostile/deep JSON bomb** (depth 9 or 400 nodes) — validation rejects with a clear error, nothing stored/rendered (pinned in Task 6 tests).
4. **Unknown `componentType` from a registry drift or newer doc** — renderer emits a safe placeholder box, page never crashes (pinned in Task 7 tests).
5. **Wrong or missing `GENERATE_SECRET`** — 401, generation not invoked (pinned in Task 11 tests).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder), `lib/` (empty), `tests/unit/`, `tests/e2e/`

**Interfaces:**
- Produces: runnable `npm run dev`, `npm test` (Vitest), `npm run test:e2e` (Playwright), `npm run typecheck`.

- [ ] **Step 1: Scaffold Next.js + tooling**

`create-next-app` with TypeScript, App Router, no Tailwind (plain CSS in `globals.css`). Add devDeps: `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `jsdom`, `@playwright/test`, `tsx`. Deps: `zod`, `better-sqlite3` (+ `@types/better-sqlite3`). Wire `vitest.config.ts` with `environment: "jsdom"` for `tests/unit`, React plugin.

- [ ] **Step 2: Add npm scripts**

Pin exactly: `"dev"`, `"build"`, `"start"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"test:e2e": "playwright test"`.

- [ ] **Step 3: Verify scaffold**

Run: `npm run typecheck && npm test` → PASS (0 tests is fine); `npm run dev` starts and `app/page.tsx` placeholder renders.

- [ ] **Step 4: `.env.example`**

```
LLM_PROVIDER=openai
LLM_API_KEY=
GENERATE_SECRET=change-me
DATABASE_PATH=./data/days.db
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest and playwright"
```

---

### Task 2: Document schema

**Files:**
- Create: `lib/schema.ts`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Produces: `type Theme = { bg: string; fg: string; accent: string; font: "serif"|"sans"|"mono"|"display"; dark: boolean }`; `type Node = { id: string; componentType: string; props: Record<string, unknown>; children?: Node[] }`; `type UiDocument = { version: 1; date: string; title: string; theme: Theme; root: Node }`; `const uiDocumentSchema: z.ZodType<UiDocument>`; `const LIMITS = { maxDepth: 8, maxNodes: 300 }`; `function countNodes(root: Node): number`; `function depthOf(root: Node): number`.

- [ ] **Step 1: Write failing tests**

```ts
// valid minimal doc passes; date format "2026-10-02" rejected if not YYYY-MM-DD;
// depth 9 tree → uiDocumentSchema.safeParse fails;
// 301-node tree → fails;
// theme.font outside the four values → fails;
// version !== 1 → fails
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npm test -- schema` → FAIL (`lib/schema.ts` not found).

- [ ] **Step 3: Implement `lib/schema.ts`**

Zod schema as typed above. Limits enforced by `superRefine` on `root` using `depthOf`/`countNodes` (depth counts root as 1, so max 8). Strings for `bg/fg/accent`: plain color strings (hex/rgb/named) via loose regex — reject empty.

- [ ] **Step 4: Run tests, expect PASS** — `npm test -- schema`

- [ ] **Step 5: Commit** — `git add lib tests && git commit -m "feat: Zod UiDocument schema with depth and node limits"`

---

### Task 3: Registry core + layout components

**Files:**
- Create: `lib/registry.tsx`, `lib/components/layout.tsx`
- Test: `tests/unit/registry.test.ts`, `tests/unit/layout.test.tsx`

**Interfaces:**
- Consumes: `Node` from Task 2.
- Produces: `type ComponentEntry = { propsSchema: z.ZodTypeAny; Component: React.ComponentType<any> }`; `const registry: Record<string, ComponentEntry>`; `function getComponent(type: string): ComponentEntry | undefined` (never throws); `function inventoryForPrompt(): unknown` — returns a JSON-safe array `[{type, propsDescription}]` derived from registry (used by Task 10).

- [ ] **Step 1: Write failing tests**

```ts
// registry: getComponent("Stack") returns entry; getComponent("Nope") returns undefined;
// getComponent("Stack").propsSchema.safeParse({ gap: 2 }) passes; { gap: "x" } fails
// inventoryForPrompt() includes all 13 layout+content types' names... (actually: returns array whose "type" values are a subset check later in Task 5 — for now assert it contains "Stack" and "Center")
// layout: render <Stack gap={4}> with two children → both present in DOM, wrapper uses flex column with gap
```

- [ ] **Step 2: Run, expect FAIL** — `npm test -- registry layout`

- [ ] **Step 3: Implement registry core + layout components**

`registry.tsx`: the `ComponentEntry` type, `registry` object, `getComponent`, `inventoryForPrompt`. Components (`lib/components/layout.tsx`), all accepting `children` where tree-shaped: `Stack` (`gap?: number`, vertical flex), `Center` (flex center, `maxWidth?: number`), `Grid` (`columns?: number` 1–12, CSS grid), `Section` (`heading?: string`), `SplitPane` (two `children` side-by-side), `Tabs` (`tabs: {label: string}[]` + children panels — v1: renders labels as styled segmented control over a single children region), `Timeline` (`events: {date: string; text: string}[]`). Each exported with its `propsSchema`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git add lib tests && git commit -m "feat: component registry core and layout components"`

---

### Task 4: Content components

**Files:**
- Create: `lib/components/content.tsx`
- Test: `tests/unit/content.test.tsx`

**Interfaces:**
- Consumes: `registry` registration pattern from Task 3 (each component's entry added to `registry` in `registry.tsx`).
- Produces: registry entries for `Hero, Text, Card, ImageGallery, LinkList, BeforeAfter, TerminalSim`.

- [ ] **Step 1: Write failing tests**

```ts
// Text renders its text; { text: 42 } rejected by its propsSchema
// ImageGallery: url "http://insecure.com/x.png" rejected; "https://images.example.com/x.png" accepted (allowlist includes *.example.com and a documented default list — use a small exported ALLOWED_IMAGE_HOSTS array; test adds none, asserts example.com passes, evil.com fails)
// Hero renders heading + optional sub
// Card renders title/body; LinkList renders anchors with rel="noopener noreferrer"
// BeforeAfter: two image urls, renders both; TerminalSim: lines: string[] render in <pre>
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement content components**

`Hero({heading, sub?})`, `Text({text, size?: "sm"|"md"|"lg"})`, `Card({title, body})`, `ImageGallery({images: {url: string; alt?: string}[]})` with `z.string().url().refine(url => https && host matches ALLOWED_IMAGE_HOSTS via suffix match)`, `LinkList({links: {label: string; href: string}[]})` (`href` must be `https:`), `BeforeAfter({before: string; after: string; caption?})`, `TerminalSim({lines: string[]})`. Register all in `registry.tsx`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: content components with image/link allowlists"`

---

### Task 5: Interactive components

**Files:**
- Create: `lib/components/interactive.tsx`
- Test: `tests/unit/interactive.test.tsx`

**Interfaces:**
- Consumes: registry pattern (Task 3).
- Produces: registry entries for `Counter, Todo, Poll, Clock, Clicker, Marquee, CanvasNoise, ProgressBar, Accordion`. After this task, `inventoryForPrompt()` must list all 23 types — asserted here.

- [ ] **Step 1: Write failing tests**

```ts
// registry "type" values === the exact 23-name list from Global Constraints
// Counter({start: 5}): clicking + increments 5→6
// Todo: typing + Enter adds an item to the list
// Poll({options}) : clicking an option marks it selected
// Clock renders current time (mock timers)
// ProgressBar({value: 50}) width 50%
// Marquee renders duplicated text in an animated row
// Accordion: clicking header reveals body
// Clicker: clicking target increments count
// CanvasNoise: renders <canvas> without throwing (jsdom: guard getContext null)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement interactive components**

Client components (`"use client"`). `CanvasNoise` must tolerate `canvas.getContext("2d") === null` (jsdom) — bail to a static gradient div. `Clock` uses `setInterval` cleaned up on unmount. Register all.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: interactive components"`

---

### Task 6: Document validation walk

**Files:**
- Create: `lib/validate.ts`
- Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: `uiDocumentSchema` (Task 2), `registry`/`getComponent` (Task 3–5).
- Produces: `type ValidationResult = { ok: true; doc: UiDocument } | { ok: false; errors: string[] }`; `function validateDocument(raw: unknown): ValidationResult` — runs doc schema, then walks every node: unknown `componentType` → error `unknown component: X`; `propsSchema.safeParse` fail → error `invalid props at <id> (<type>): <zod message>`; returns ALL errors, never throws.

- [ ] **Step 1: Write failing tests**

```ts
// valid hand-built doc with Stack/Text → { ok: true }
// node with componentType "Hax" → ok:false, errors contains "unknown component: Hax"
// Counter node with props { start: "abc" } → ok:false, error mentions node id
// depth-9 doc → ok:false with limits error
// raw JSON string / null → ok:false, not a throw
// collects multiple errors in one pass (two bad nodes → errors.length >= 2)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `lib/validate.ts`**

Schema parse first (fail → return its issues mapped to strings); then recursive walk checking registry + props, collecting errors; cap `errors` at 50 entries to bound output.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: validateDocument walk with per-node errors"`

---

### Task 7: Renderer

**Files:**
- Create: `lib/renderer.tsx`
- Test: `tests/unit/renderer.test.tsx`

**Interfaces:**
- Consumes: `Node` (Task 2), `getComponent` (Task 3).
- Produces: `function Renderer({ node }: { node: Node }): React.JSX.Element` — recursive; per-node React error boundary; unknown type → `<div data-testid="unknown-component" role="presentation">` placeholder with the type name in dev only (`process.env.NODE_ENV !== "production"`); recursion iterates `children`.

- [ ] **Step 1: Write failing tests**

```ts
// renders Stack→Text tree, text visible
// node componentType "Ghost" → placeholder [data-testid="unknown-component"] rendered, no throw
// node whose Component throws (register test-only "Boom" component in the test) → its boundary renders fallback div; sibling node still visible
// children walk: nested depth 3 renders deepest text
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `lib/renderer.tsx`**

Error boundary as a small class component wrapping each node (`data-testid="node-error"` fallback). Guard `children ?? []`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: recursive renderer with error boundary and unknown-type fallback"`

---

### Task 8: SQLite day store

**Files:**
- Create: `lib/db.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: env `DATABASE_PATH`.
- Produces:
```ts
type DayRow = { date: string; json: string; directive: string; stale: boolean; createdAt: string };
function getDb(path?: string): Database;        // opens file, CREATE TABLE IF NOT EXISTS days(date TEXT PRIMARY KEY, json TEXT NOT NULL, directive TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL)
function upsertDay(db: Database, row: Omit<DayRow, "createdAt">): void;
function getDay(db: Database, date: string): DayRow | undefined;
function getLatestDay(db: Database): DayRow | undefined;   // ORDER BY date DESC LIMIT 1
function listDays(db: Database): Array<Pick<DayRow, "date" | "directive" | "stale"> & { title: string }>; // title extracted at insert time? No — store title inside json only; listDays parses json for title
```

- [ ] **Step 1: Write failing tests**

```ts
// uses in-memory path ":memory:" → upsert then getDay returns row with stale flag round-tripped (boolean)
// upsert same date twice → one row, json replaced
// getLatestDay with dates 10-01,10-03 → 10-03
// listDays → sorted DESC, title parsed from json
// empty db → getDay/getLatestDay undefined
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `lib/db.ts`**

better-sqlite3, synchronous API, `stale` stored as INTEGER, converted to boolean on read. `getDb()` memoized per path.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: SQLite day store"`

---

### Task 9: LLM provider + JSON extraction

**Files:**
- Create: `lib/llm/provider.ts`, `lib/llm/openai.ts`, `lib/llm/anthropic.ts`, `lib/llm/extract.ts`
- Test: `tests/unit/llm.test.ts`

**Interfaces:**
- Produces:
```ts
interface LlmProvider { generate(prompt: string, opts?: { repair?: string }): Promise<string>; }
function createProvider(name: "openai" | "anthropic", apiKey: string): LlmProvider;
function extractJson(text: string): unknown;  // finds first balanced {...} or [...] substring, JSON.parse; throws ExtractError on failure
class ExtractError extends Error {}
```
- Network via `fetch`; both impls read provider docs' current chat-completions / messages endpoints (use structured output where available: OpenAI `response_format: {type:"json_object"}`, Anthropic tool-use with a single `submit_ui` tool).

- [ ] **Step 1: Write failing tests**

```ts
// extractJson('prefix {"a":1} suffix') → {a:1}
// extractJson('```json\n{"a":1}\n```') → {a:1}
// extractJson('{"broken" → throws ExtractError
// extractJson('{"nested":{"arr":[1,2]}}') → full object (balanced-brace scan skips braces inside strings)
// createProvider("bogus" as any) → throws
// openai impl with mocked fetch returning OpenAI-shaped content → returns content string; sends response_format json_object
// anthropic impl with mocked fetch → returns text block content
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement provider + extractor**

Balanced-brace scanner respecting double-quoted strings (with escapes). Both providers share a tiny `postJson(url, headers, body)` helper. Endpoints: OpenAI `https://api.openai.com/v1/chat/completions`, Anthropic `https://api.anthropic.com/v1/messages`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: LLM provider abstraction and JSON extraction"`

---

### Task 10: Generation pipeline + CLI

**Files:**
- Create: `lib/directives.ts`, `lib/generate.ts`, `scripts/generate.ts`
- Test: `tests/unit/generate.test.ts`

**Interfaces:**
- Consumes: `inventoryForPrompt` (Task 3), `validateDocument` (Task 6), `createProvider`/`extractJson` (Task 9), `getDb`/`upsertDay`/`getDay` (Task 8).
- Produces:
```ts
// lib/directives.ts
const DIRECTIVES: ReadonlyArray<{ id: string; brief: string }>;  // ≥8 entries (retro-terminal, brutalist, pastel, game-like, minimal-portfolio, data-dashboard, neon-cyber, organic-zen)
function pickDirective(date: string): { id: string; brief: string };  // deterministic by date hash so re-runs are stable
// lib/generate.ts
type GenerateDeps = { provider: LlmProvider; db: Database };
type GenerateResult = { doc: UiDocument; stale: boolean; directive: string };
async function generateDay(deps: GenerateDeps, date: string): Promise<GenerateResult>;
// scripts/generate.ts: --from YYYY-MM-DD --to YYYY-MM-DD (default: both = today)
```

- [ ] **Step 1: Write failing tests**

```ts
// pickDirective stable: same date → same id; different dates differ (use two fixed dates known to hash differently, hardcode expected ids after implementation — or assert set membership + stability only)
// generateDay happy path (mock provider returns valid doc JSON) → validateDocument ok, upserted, stale=false, directive stored
// provider returns garbage then valid JSON on repair → ok, stale=false (repair attempt made: mock called twice)
// provider returns garbage twice, yesterday's row exists → returns yesterday's doc with stale=true, today's row upserted stale
// provider returns garbage twice, empty db → throws GenerationError (no silent store)
// provider returns well-formed JSON that fails validation (unknown component) → repair attempted with error text; second failure → same stale/throw behavior as above
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement directives, pipeline, CLI**

Prompt = system instructions + `inventoryForPrompt()` + `LIMITS` + directive brief + date + "Return JSON only". Repair message: previous output + first validation errors. Fallback reads `getLatestDay` strictly before today's date. `scripts/generate.ts` uses tsx, prints per-date `ok | stale | failed`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Verify CLI end-to-end (mocked)**

Run: `LLM_PROVIDER=openai LLM_API_KEY=dummy npm test -- generate` — plus a manual smoke of `npx tsx scripts/generate.ts --from 2026-10-02 --to 2026-10-02` is NOT required to hit the real API (no key yet); CLI arg parsing verified by unit test: missing `--from` defaults to today (add assertion in step 1's file if not covered).

- [ ] **Step 6: Commit** — `git commit -m "feat: daily generation pipeline with retry and stale fallback"`

---

### Task 11: API routes

**Files:**
- Create: `app/api/today/route.ts`, `app/api/archive/route.ts`, `app/api/archive/[date]/route.ts`, `app/api/generate/route.ts`
- Modify: `lib/db.ts` — add `setDbForTesting(db: Database | undefined): void` seam (clears the memoized instance when `undefined`), used only by tests
- Test: `tests/unit/api.test.ts`

**Interfaces:**
- Consumes: db + `generateDay` (Tasks 8, 10).
- Produces:
  - `GET /api/today` → 200 `UiDocument` JSON; **404 `{error:"no-ui"}` when table empty**; if today missing but older rows exist → 200 latest doc.
  - `GET /api/archive` → 200 `[{date, title, directive, stale}]` sorted DESC.
  - `GET /api/archive/[date]` → 200 doc, 404 `{error:"not-found"}`.
  - `POST /api/generate` → header `x-generate-secret` must equal `GENERATE_SECRET` (401 `{error:"unauthorized"}` otherwise) → body `{date?}` (default today) → runs `generateDay` → 200 `{date, stale, directive}`; 502 `{error:"generation-failed"}` if `GenerationError` (after pipeline's own retry); rate-limit: max 1 on-demand attempt per date per 10 min (in-memory Map — return 429 `{error:"rate-limited"}`).

- [ ] **Step 1: Write failing tests**

Invoke route handlers directly (`await GET(new Request("http://x"))` style):
```ts
// empty db → GET /api/today 404 {error:"no-ui"}
// seeded old day only → GET /api/today 200 with that doc
// GET /api/archive lists seeded days DESC with title
// GET /api/archive/1999-01-01 → 404
// POST /api/generate no header → 401, provider mock NOT called
// POST /api/generate wrong secret → 401
// POST /api/generate correct secret, provider ok → 200 {date, stale:false}
// second POST within window → 429
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement routes**

`next/server` route handlers; db opened lazily per request via `getDb()`; tests inject seeded in-memory db by setting `process.env.DATABASE_PATH=":memory:"`... note: `:memory:` is per-connection — export a `setDbForTesting(db)` seam in `lib/db.ts` used only by tests, or accept `DATABASE_PATH` file in `tmp` — pick the `setDbForTesting` seam (documented, minimal).

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat: today/archive/generate API routes with auth and rate limit"`

---

### Task 12: Pages + theme

**Files:**
- Create: `app/page.tsx` (replace placeholder), `app/archive/page.tsx`, `app/archive/[date]/page.tsx`, `app/not-found.tsx` state in page
- Modify: `app/globals.css`, `app/layout.tsx` (metadata from doc title)

**Interfaces:**
- Consumes: `Renderer` (Task 7), db direct read, `Theme` (Task 2).
- Produces: `/` renders today (or latest) doc: `html` data attributes + CSS variables `--bg --fg --accent` set via inline `style` on a wrapper div (Next forbids mutating `html` server-side — wrapper div approach), font family class from `theme.font`; corner badge with date + `/archive` link; stale badge when `stale`; empty state "Nothing generated yet". `/archive` server-rendered list. `/archive/[date]` renders that doc or `notFound()`.

- [ ] **Step 1: Implement pages (server components, direct `getDb()` read)**

Theme CSS: `globals.css` defines `.theme-root { background: var(--bg); color: var(--fg); }` and font families (system serif/sans/mono + one display via `@font-face`? No — use CSS fallback stacks only: `font-display` → `"Georgia", serif` etc. Keep zero external font fetches).

- [ ] **Step 2: Seed a fixture and verify in browser**

Create `tests/fixtures/sample-doc.json` (valid doc using ~8 component types). Temporarily seed db (small script or test hook), `npm run dev`, open `/` — verify rendering, then clear seed.

- [ ] **Step 3: Check console + failed requests clean** (browser devtools or `curl` the routes).

- [ ] **Step 4: Commit** — `git commit -m "feat: today, archive, and day pages with theme rendering"`

---

### Task 13: E2E smoke

**Files:**
- Create: `tests/e2e/smoke.spec.ts`, `playwright.config.ts` webServer config
- Fixture: reuse `tests/fixtures/sample-doc.json` seeded via `tests/e2e/global-setup.ts`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write failing smoke tests**

```ts
// global-setup seeds DATABASE_PATH (file in tests/e2e/.tmp) with sample-doc for today + two archive days
// test "today renders": page.goto("/"), expect h1/hero text from fixture, expect no console errors
// test "archive navigates": goto "/archive"), click first row, expect URL /archive/<date> and fixture title visible
// test "unknown-type placeholder doesn't crash": seed a doc with one bogus type, page still shows badge + other nodes
```

- [ ] **Step 2: Run, expect FAIL** — `npm run test:e2e`

- [ ] **Step 3: Install browsers + wire `playwright.config.ts` `webServer: { command: "npm run dev", port: 3000, reuseExistingServer: true }`**

- [ ] **Step 4: Run tests, expect PASS** — `npm run test:e2e`

- [ ] **Step 5: Full gate** — `npm run typecheck && npm test && npm run test:e2e` all PASS.

- [ ] **Step 6: Commit** — `git commit -m "test: playwright smoke for today and archive"`

---

## Self-Review Notes (checked at write time)

- **Spec coverage:** schema §4→Task 2; registry/inventory §4→Tasks 3–5; validate §4→Task 6; renderer/safety §4→Task 7; DB §5→Task 8; provider/prompt/retry/stale §5→Tasks 9–10; API+secret+rate-limit §5–9→Task 11; pages/archive/theme §6→Task 12; tests §7→throughout + Task 13; CLI §5→Task 10; future brief param §8 → provider `opts.repair` shape kept separate; `brief` intentionally NOT built (out of scope §10), but `generateDay(deps, date)` is the seam.
- **Deployment/SQLite note (spec §10):** deferred, not planned here — correct.
- **Thumbnails (spec §6):** explicitly deferred — not in plan.
