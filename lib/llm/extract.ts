/**
 * Extract the first JSON object/array out of LLM output.
 *
 * The scan starts at the first `{` or `[` (so markdown fences and surrounding
 * prose fall away naturally) and tracks the bracket depth while honoring
 * double-quoted strings — including `\"`, `\\` and other backslash escapes —
 * so braces and quotes inside string values never confuse the balance count.
 */

/** Thrown whenever no parseable JSON container can be extracted from text. */
export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

/** First balanced `{...}` / `[...]` substring of `text`, or null if none. */
function findBalanced(text: string): string | null {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return null;
  }

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  // Unterminated container (or string) — not extractable.
  return null;
}

/**
 * Find the first balanced JSON container in `text`, `JSON.parse` it, and
 * return the value. Throws `ExtractError` when nothing balanced is found or
 * the candidate fails to parse.
 */
export function extractJson(text: string): unknown {
  const candidate = findBalanced(text);
  if (candidate === null) {
    throw new ExtractError("no balanced JSON object or array found in text");
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ExtractError(`balanced container is not valid JSON: ${detail}`);
  }
}
