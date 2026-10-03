"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Renderer } from "../lib/renderer";
import type { UiDocument } from "../lib/schema";
import { ThemeSurface } from "./theme-surface";

/**
 * "Describe your own UI" — the visitor-facing preview disclosure on `/`.
 *
 * The daily document stays server-rendered and untouched: this box never
 * receives the stored document and never swaps the area above it. A preview is
 * rendered in the disclosure's OWN region, from a tree fetched at runtime, so
 * it needs no stored row and works on an empty database (which is why `Home`
 * can mount it in both branches).
 *
 * Wire contract with `POST /api/preview` (see app/api/preview/route.ts): the
 * only success body is `{ doc }` and the only failure bodies are the fixed
 * literals `bad-brief` / `cooldown` (+ `retryAfterMinutes`) / `daily-cap` /
 * `unavailable` / `generation-failed`. That route is unauthenticated and its
 * bodies deliberately carry no upstream detail, so this component maps each
 * code to one fixed message and NEVER surfaces the response body — an
 * unrecognised or unreadable failure degrades to the same generic copy as a
 * rejected fetch.
 *
 * The returned `doc` is NOT re-validated here: it comes from our own
 * already-validated endpoint, `Renderer`'s per-node error boundary contains a
 * throwing subtree, and an unknown component type renders a placeholder. A
 * second Zod pass would only add bytes to the client bundle for nothing.
 */

/** Minimum trimmed length `POST /api/preview` accepts (mirrors the route). */
const MIN_BRIEF_LENGTH = 8;
/** Maximum length the route accepts; mirrored so the field cannot outgrow it. */
const MAX_BRIEF_LENGTH = 400;

/** Shown for any failure the mapping below does not recognise. */
const GENERIC_ERROR = "Couldn't generate that right now";

/**
 * Fixed copy per documented error code. Each code gets its OWN message: telling
 * a rate-limited visitor that the preview is "broken" (or vice versa) hides
 * the action they can actually take.
 */
const MESSAGES: Record<string, string> = {
  "daily-cap": "That's today's preview budget — come back tomorrow",
  "bad-brief": `Describe a UI in at least ${MIN_BRIEF_LENGTH} characters`,
  unavailable: "Previews aren't configured right now",
  "generation-failed": "The model couldn't produce a usable design",
};

/** Read the JSON body defensively: an unparseable body is just a failed read. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Error body → visitor-facing message. Anything unrecognised (an unknown code,
 * a non-object body, a missing or nonsensical `retryAfterMinutes`) falls back
 * to the generic copy rather than echoing the response.
 */
function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return GENERIC_ERROR;
  }
  const { error, retryAfterMinutes } = body as { error?: unknown; retryAfterMinutes?: unknown };
  if (error === "cooldown") {
    // Whole positive minutes only: `-3` or `7.5` would render as nonsense copy
    // ("Try again in -3 minutes"), and the route's own `Math.max(1, …)` ceiling
    // means anything below 1 is not a real wait.
    const usable =
      typeof retryAfterMinutes === "number" &&
      Number.isInteger(retryAfterMinutes) &&
      retryAfterMinutes > 0;
    return usable
      ? `Try again in ${retryAfterMinutes} minutes`
      : "Try again in a few minutes";
  }
  if (typeof error === "string" && MESSAGES[error] !== undefined) {
    return MESSAGES[error];
  }
  return GENERIC_ERROR;
}

/**
 * The document out of a success body, or `undefined` when the body is not
 * document-shaped. This is a shape check for typing, NOT validation: the
 * endpoint already validated the tree before returning it.
 */
function readDoc(body: unknown): UiDocument | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const doc = (body as { doc?: unknown }).doc;
  if (typeof doc !== "object" || doc === null) {
    return undefined;
  }
  const { theme, root } = doc as { theme?: unknown; root?: unknown };
  if (typeof theme !== "object" || theme === null || typeof root !== "object" || root === null) {
    return undefined;
  }
  return doc as UiDocument;
}

export function PreviewBox(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<UiDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Focus follows both directions of the swap: onto the preview's heading once a
  // document exists, and back onto the textarea when the preview is dismissed
  // (the focused back button unmounts, which would otherwise strand focus on
  // <body> and send a keyboard user back to the top of the document).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (result !== null) {
      headingRef.current?.focus();
    } else {
      // Null on the initial closed render, where there is no field to focus.
      inputRef.current?.focus();
    }
  }, [result]);

  async function generatePreview(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      if (response.ok) {
        const doc = readDoc(await readBody(response));
        if (doc === undefined) {
          setError(GENERIC_ERROR);
          return;
        }
        setResult(doc);
        return;
      }
      setError(errorMessage(await readBody(response)));
    } catch {
      // A transport failure (offline, DNS, aborted) is the visitor's one
      // visible outcome; the thrown detail stays in the console.
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  const tooShort = brief.trim().length < MIN_BRIEF_LENGTH;

  return (
    <section className="preview-box" aria-label="Describe your own UI">
      <button
        type="button"
        className="preview-toggle"
        data-testid="preview-toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        Describe your own UI
      </button>

      {open ? (
        result === null ? (
          <div className="preview-panel">
            <textarea
              className="preview-input"
              data-testid="preview-input"
              aria-label="Describe the UI you want to see"
              placeholder="e.g. a calm invoice dashboard for freelancers"
              ref={inputRef}
              value={brief}
              maxLength={MAX_BRIEF_LENGTH}
              onChange={(event) => {
                setBrief(event.target.value);
                // Editing clears a stale message rather than leaving it to
                // contradict the brief now in the field.
                if (error !== null) {
                  setError(null);
                }
              }}
            />
            <div className="preview-actions">
              {/* Visible count, deliberately NOT a live region: it changes on
                  every keystroke and "12/400" means nothing announced. */}
              <span className="preview-count">
                {brief.length}/{MAX_BRIEF_LENGTH}
              </span>
              <button
                type="button"
                className="preview-generate"
                data-testid="preview-generate"
                disabled={pending || tooShort}
                onClick={() => {
                  void generatePreview();
                }}
              >
                {pending ? "Generating..." : "Generate preview"}
              </button>
            </div>
            {error !== null ? (
              <p className="preview-error" role="alert" data-testid="preview-error">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="preview-panel">
            <div className="preview-summary-row">
              <p className="preview-summary" data-testid="preview-summary">
                {`“${brief}”`}
              </p>
              <button
                type="button"
                className="preview-back"
                data-testid="preview-back"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Back to today&apos;s UI
              </button>
            </div>
            <div className="preview-region" data-testid="preview-region">
              <ThemeSurface doc={result}>
                <div className="preview-region-head">
                  <h2 className="preview-region-title" ref={headingRef} tabIndex={-1}>
                    {result.title}
                  </h2>
                  <span className="badge badge-preview">preview</span>
                </div>
                {/* A plain div, never a second <main>: the page already has
                    exactly one (the daily document or the empty state) and
                    neither is named, so a second one would be an indistinguishable
                    landmark. Styling is class-based, so the box is unchanged. */}
                <div className="doc-body">
                  <Renderer node={result.root} />
                </div>
              </ThemeSurface>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
