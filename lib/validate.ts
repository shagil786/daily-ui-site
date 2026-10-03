import { z } from "zod";
import { getComponent } from "./registry";
import { LIMITS, uiDocumentSchema, type Node, type UiDocument } from "./schema";

/**
 * Single gate for untrusted UI documents: everything entering storage or render
 * passes through `validateDocument`. Never throws — every failure becomes
 * `ok: false` with at least one error string.
 */
export type ValidationResult =
  | { ok: true; doc: UiDocument }
  | { ok: false; errors: string[] };

/** Hard cap on reported errors so one bad document cannot flood the output. */
const MAX_ERRORS = 50;

type WalkEntry = { node: unknown; depth: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueText(issue: z.core.$ZodIssue): string {
  const path = issue.path.map((key) => String(key)).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

function exceptionText(err: unknown): string {
  // Doubly-hostile input: String() on a non-Error can throw, and an Error's
  // `message` getter can be overridden to throw — both must degrade to a
  // static string so the catch handler itself can never throw.
  try {
    if (err instanceof Error) {
      // `message` is typed as string but can be overridden with any value;
      // fall back rather than embed "[object Object]" in a diagnostic.
      return typeof err.message === "string" ? err.message : "unknown validation failure";
    }
    return String(err);
  } catch {
    return "unknown validation failure";
  }
}

/**
 * Iterative (explicit-stack, never-recursive) pre-walk of the raw input's node
 * tree, run BEFORE `uiDocumentSchema.safeParse`. Zod's lazy node schema
 * recurses one stack frame per tree level, so an adversarially deep document
 * would otherwise blow the stack inside `safeParse`. Returns limit violations
 * (actual vs max); a non-empty result means `safeParse` is skipped entirely.
 * The walk also terminates on cyclic input because `nodes` grows on every visit.
 */
function prewalkLimits(raw: unknown): string[] {
  if (!isRecord(raw)) {
    return [];
  }
  // Documents carry the tree at `root`; a bare node chain is walked as-is.
  const start: unknown = isRecord(raw.root) ? raw.root : raw;
  const stack: WalkEntry[] = [{ node: start, depth: 1 }];
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      break;
    }
    nodes += 1;
    const depthExceeded = entry.depth > LIMITS.maxDepth;
    const nodesExceeded = nodes > LIMITS.maxNodes;
    if (depthExceeded || nodesExceeded) {
      const errors: string[] = [];
      if (depthExceeded) {
        errors.push(`tree depth ${entry.depth} exceeds the maximum of ${LIMITS.maxDepth}`);
      }
      if (nodesExceeded) {
        errors.push(`tree has ${nodes} nodes, exceeding the maximum of ${LIMITS.maxNodes}`);
      }
      return errors;
    }
    if (isRecord(entry.node) && Array.isArray(entry.node.children)) {
      for (const child of entry.node.children) {
        if (isRecord(child)) {
          stack.push({ node: child, depth: entry.depth + 1 });
        }
      }
    }
  }
  return [];
}

/**
 * Registry + props walk over the schema-validated document. Recursion here is
 * safe: a successful schema parse proves depth <= `LIMITS.maxDepth`. Per-node
 * props are validated against `node.props` ONLY — `Node.children` is part of
 * the Node schema and must never be merged into a props parse (strip-mode
 * would silently drop it).
 */
function walkNodeErrors(doc: UiDocument): string[] {
  const errors: string[] = [];

  const visit = (node: Node): void => {
    if (errors.length >= MAX_ERRORS) {
      return;
    }
    const entry = getComponent(node.componentType);
    if (entry === undefined) {
      errors.push(`unknown component: ${node.componentType}`);
    } else {
      const parsed = entry.propsSchema.safeParse(node.props);
      if (!parsed.success) {
        const messages = parsed.error.issues.map(issueText).join("; ");
        errors.push(`invalid props at ${node.id} (${node.componentType}): ${messages}`);
      }
    }
    for (const child of node.children ?? []) {
      if (errors.length >= MAX_ERRORS) {
        break;
      }
      visit(child);
    }
  };

  visit(doc.root);
  return errors.slice(0, MAX_ERRORS);
}

/**
 * Validate an untrusted document: limits pre-walk, then the document schema,
 * then a per-node registry/props walk. Returns ALL errors (capped at 50) and
 * never throws.
 */
export function validateDocument(raw: unknown): ValidationResult {
  // The whole body — including the `safeParse` call — is wrapped so any throw
  // (schema bug, hostile getter, stack pressure) becomes ok:false, never an
  // exception. The limits pre-walk still runs before `safeParse`.
  try {
    const limitErrors = prewalkLimits(raw);
    if (limitErrors.length > 0) {
      return { ok: false, errors: limitErrors };
    }

    const parsed = uiDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(issueText).slice(0, MAX_ERRORS) };
    }

    const errors = walkNodeErrors(parsed.data);
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, doc: parsed.data };
  } catch (err) {
    return { ok: false, errors: [`validation threw: ${exceptionText(err)}`] };
  }
}
