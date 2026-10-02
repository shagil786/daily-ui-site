import { describe, expect, it } from "vitest";
import {
  LIMITS,
  countNodes,
  depthOf,
  uiDocumentSchema,
  type Node,
  type Theme,
  type UiDocument,
} from "../../lib/schema";

const validTheme: Theme = {
  bg: "#ffffff",
  fg: "#111111",
  accent: "#2563eb",
  font: "sans",
  dark: false,
};

function makeNode(id: string, children?: Node[]): Node {
  const node: Node = { id, componentType: "Box", props: {} };
  if (children !== undefined) {
    node.children = children;
  }
  return node;
}

/** Vertical chain of `depth` nodes; root counts as depth 1. */
function makeChain(depth: number): Node {
  let node = makeNode(`n${depth}`);
  for (let i = depth - 1; i >= 1; i -= 1) {
    node = makeNode(`n${i}`, [node]);
  }
  return node;
}

/** Root plus (totalNodes - 1) leaf children. */
function makeWide(totalNodes: number): Node {
  const children = Array.from({ length: totalNodes - 1 }, (_, i) => makeNode(`c${i}`));
  return makeNode("root", children);
}

function makeDoc(root: Node, overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    version: 1,
    date: "2026-10-02",
    title: "Daily UI",
    theme: validTheme,
    root,
    ...overrides,
  };
}

describe("LIMITS", () => {
  it("pins the hard limits", () => {
    expect(LIMITS).toEqual({ maxDepth: 8, maxNodes: 300 });
  });
});

describe("uiDocumentSchema", () => {
  it("accepts a valid minimal document", () => {
    const result = uiDocumentSchema.safeParse(makeDoc(makeNode("root")));
    expect(result.success).toBe(true);
  });

  it.each(["2026-10-02", "1999-01-31"])("accepts date %s in YYYY-MM-DD format", (date) => {
    expect(uiDocumentSchema.safeParse(makeDoc(makeNode("root"), { date })).success).toBe(true);
  });

  it.each(["2026-10-2", "2026/10/02", "10-02-2026", "2026-10-02T00:00:00Z", "October 2, 2026"])(
    "rejects date %s because it is not YYYY-MM-DD",
    (date) => {
      expect(uiDocumentSchema.safeParse(makeDoc(makeNode("root"), { date })).success).toBe(false);
    },
  );

  it("accepts a depth-8 tree (root counts as 1)", () => {
    const tree = makeChain(8);
    expect(depthOf(tree)).toBe(8);
    expect(uiDocumentSchema.safeParse(makeDoc(tree)).success).toBe(true);
  });

  it("rejects a depth-9 tree", () => {
    const tree = makeChain(9);
    expect(depthOf(tree)).toBe(9);
    expect(uiDocumentSchema.safeParse(makeDoc(tree)).success).toBe(false);
  });

  it("accepts a 300-node tree", () => {
    const tree = makeWide(300);
    expect(countNodes(tree)).toBe(300);
    expect(uiDocumentSchema.safeParse(makeDoc(tree)).success).toBe(true);
  });

  it("rejects a 301-node tree", () => {
    const tree = makeWide(301);
    expect(countNodes(tree)).toBe(301);
    expect(uiDocumentSchema.safeParse(makeDoc(tree)).success).toBe(false);
  });

  it.each(["serif", "sans", "mono", "display"] as const)("accepts theme.font %s", (font) => {
    const result = uiDocumentSchema.safeParse(
      makeDoc(makeNode("root"), { theme: { ...validTheme, font } }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects theme.font outside the four allowed values", () => {
    const doc = makeDoc(makeNode("root"));
    const result = uiDocumentSchema.safeParse({
      ...doc,
      theme: { ...doc.theme, font: "cursive" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects version !== 1", () => {
    const doc = makeDoc(makeNode("root"));
    expect(uiDocumentSchema.safeParse({ ...doc, version: 2 }).success).toBe(false);
    expect(uiDocumentSchema.safeParse({ ...doc, version: "1" }).success).toBe(false);
  });

  it("rejects an empty theme color", () => {
    const doc = makeDoc(makeNode("root"));
    const result = uiDocumentSchema.safeParse({ ...doc, theme: { ...doc.theme, bg: "" } });
    expect(result.success).toBe(false);
  });
});

describe("countNodes", () => {
  it("counts the root as one node", () => {
    expect(countNodes(makeNode("root"))).toBe(1);
  });

  it("counts every descendant", () => {
    const tree = makeNode("root", [makeNode("a", [makeNode("a1"), makeNode("a2")]), makeNode("b")]);
    expect(countNodes(tree)).toBe(5);
  });
});

describe("depthOf", () => {
  it("counts the root as depth 1", () => {
    expect(depthOf(makeNode("root"))).toBe(1);
  });

  it("returns the length of the longest branch", () => {
    const tree = makeNode("root", [makeNode("a", [makeNode("a1")]), makeNode("b")]);
    expect(depthOf(tree)).toBe(3);
  });
});
