import { z } from "zod";

export type Theme = {
  bg: string;
  fg: string;
  accent: string;
  font: "serif" | "sans" | "mono" | "display";
  dark: boolean;
};

export type Node = {
  id: string;
  componentType: string;
  props: Record<string, unknown>;
  children?: Node[];
};

export type UiDocument = {
  version: 1;
  date: string;
  title: string;
  theme: Theme;
  root: Node;
};

export const LIMITS = { maxDepth: 8, maxNodes: 300 } as const;

/** Counts `root` and every descendant; the root itself counts as one node. */
export function countNodes(root: Node): number {
  let total = 1;
  for (const child of root.children ?? []) {
    total += countNodes(child);
  }
  return total;
}

/** Depth of the longest branch; the root itself counts as depth 1. */
export function depthOf(root: Node): number {
  let deepest = 1;
  for (const child of root.children ?? []) {
    deepest = Math.max(deepest, 1 + depthOf(child));
  }
  return deepest;
}

/** Loose match for plain colors: hex, rgb()/hsl() functions, or named colors. */
const colorSchema = z
  .string()
  .min(1, "color must not be empty")
  .regex(/^[A-Za-z0-9#(),.%\s-]+$/, "must be a hex, rgb(), hsl(), or named color");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format");

const themeSchema = z.object({
  bg: colorSchema,
  fg: colorSchema,
  accent: colorSchema,
  font: z.enum(["serif", "sans", "mono", "display"]),
  dark: z.boolean(),
});

const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    id: z.string(),
    componentType: z.string(),
    props: z.record(z.string(), z.unknown()),
    children: z.array(nodeSchema).optional(),
  }),
);

export const uiDocumentSchema: z.ZodType<UiDocument> = z.object({
  version: z.literal(1),
  date: dateSchema,
  title: z.string(),
  theme: themeSchema,
  root: nodeSchema.superRefine((root, ctx) => {
    const depth = depthOf(root);
    if (depth > LIMITS.maxDepth) {
      ctx.addIssue({
        code: "custom",
        message: `tree depth ${depth} exceeds the maximum of ${LIMITS.maxDepth}`,
      });
    }
    const nodes = countNodes(root);
    if (nodes > LIMITS.maxNodes) {
      ctx.addIssue({
        code: "custom",
        message: `tree has ${nodes} nodes, exceeding the maximum of ${LIMITS.maxNodes}`,
      });
    }
  }),
});
