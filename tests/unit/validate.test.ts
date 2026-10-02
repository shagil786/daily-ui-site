import { describe, expect, it } from "vitest";
import { uiDocumentSchema, type Node, type Theme, type UiDocument } from "../../lib/schema";
import { validateDocument } from "../../lib/validate";

const validTheme: Theme = {
  bg: "#ffffff",
  fg: "#111111",
  accent: "#2563eb",
  font: "sans",
  dark: false,
};

function makeNode(
  id: string,
  componentType: string,
  props: Record<string, unknown> = {},
  children?: Node[],
): Node {
  const node: Node = { id, componentType, props };
  if (children !== undefined) {
    node.children = children;
  }
  return node;
}

/** Chain of `depth` nodes (root counts as 1); all Stacks with a Text leaf. */
function makeChain(depth: number): Node {
  let node: Node = makeNode(`n${depth}`, "Text", { text: "leaf" });
  for (let i = depth - 1; i >= 1; i -= 1) {
    node = makeNode(`n${i}`, "Stack", {}, [node]);
  }
  return node;
}

/** Root Stack plus (totalNodes - 1) children of `childType`. */
function makeWide(
  totalNodes: number,
  childType = "Text",
  childProps: Record<string, unknown> = { text: "t" },
): Node {
  const children = Array.from({ length: totalNodes - 1 }, (_, i) =>
    makeNode(`c${i}`, childType, childProps),
  );
  return makeNode("root", "Stack", {}, children);
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

describe("validateDocument", () => {
  it("accepts a valid hand-built Stack/Text document", () => {
    const doc = makeDoc(
      makeNode("root", "Stack", { gap: 8 }, [makeNode("t1", "Text", { text: "hello" })]),
    );
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.title).toBe("Daily UI");
      expect(result.doc.root.componentType).toBe("Stack");
      expect(result.doc.root.children?.[0]?.componentType).toBe("Text");
      expect(result.doc.root.children?.[0]?.id).toBe("t1");
    }
  });

  it("rejects an unknown component type", () => {
    const result = validateDocument(makeDoc(makeNode("root", "Hax")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("unknown component: Hax");
    }
  });

  it("rejects invalid Counter props and names the node id", () => {
    const result = validateDocument(makeDoc(makeNode("c1", "Counter", { start: "abc" })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.includes("c1"));
      expect(err).toBeDefined();
      expect(err).toMatch(/^invalid props at c1 \(Counter\): /);
      expect(err).toContain("start");
    }
  });

  it("rejects a depth-9 document with a limits error (actual vs max)", () => {
    const result = validateDocument(makeDoc(makeChain(9)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.join(" | ");
      expect(msg).toMatch(/depth 9/);
      expect(msg).toMatch(/maximum of 8/);
    }
  });

  it("rejects a raw JSON string and null without throwing", () => {
    const asString = validateDocument('{"version":1}');
    expect(asString.ok).toBe(false);
    if (!asString.ok) expect(asString.errors.length).toBeGreaterThan(0);

    const asNull = validateDocument(null);
    expect(asNull.ok).toBe(false);
    if (!asNull.ok) expect(asNull.errors.length).toBeGreaterThan(0);
  });

  it("collects multiple errors in one pass (two bad nodes)", () => {
    const doc = makeDoc(
      makeNode("root", "Stack", {}, [
        makeNode("bad1", "Hax"),
        makeNode("bad2", "Counter", { start: "abc" }),
      ]),
    );
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes("unknown component: Hax"))).toBe(true);
      expect(result.errors.some((e) => e.includes("invalid props at bad2 (Counter)"))).toBe(true);
    }
  });

  // Carried ruling 1: stack-overflow guard — iterative pre-walk runs before
  // safeParse and returns the limits error instead of throwing. The `version: 2`
  // marker would produce a schema issue only if safeParse had run at all.
  it("pre-walks a depth bomb without throwing and skips safeParse entirely", () => {
    const bomb: unknown = { ...makeDoc(makeChain(9)), version: 2 };
    expect(() => validateDocument(bomb)).not.toThrow();
    const result = validateDocument(bomb);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("exceeds the maximum");
      expect(result.errors.join(" ")).not.toContain("version");
    }
  });

  // Carried ruling 1: never-throws for adversarially deep input — both halves
  // pinned. Raw Zod recursion overflows the stack (RangeError), and the gate
  // must turn the same input into ok:false. If a future zod/node change makes
  // deep parses graceful, the first assertion fails visibly.
  it("returns ok:false for a >5000-deep raw input instead of RangeError", () => {
    const deep = makeDoc(makeChain(5001));
    expect(() => uiDocumentSchema.safeParse(deep)).toThrow(RangeError);
    expect(() => validateDocument(deep)).not.toThrow();
    const result = validateDocument(deep);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/exceeds the maximum/);
    }
  });

  it("accepts a depth-8 chain at the limit", () => {
    const result = validateDocument(makeDoc(makeChain(8)));
    expect(result.ok).toBe(true);
  });

  it("accepts a 300-node tree at the limit", () => {
    const result = validateDocument(makeDoc(makeWide(300)));
    expect(result.ok).toBe(true);
  });

  it("rejects a 301-node tree with a node-count limits error", () => {
    const result = validateDocument(makeDoc(makeWide(301)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.join(" | ");
      expect(msg).toMatch(/301 nodes/);
      expect(msg).toMatch(/300/);
    }
  });

  it("caps the collected errors at 50 entries", () => {
    const result = validateDocument(makeDoc(makeWide(61, "Hax", {})));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(50);
    }
  });

  it("maps document-schema issues to path-joined strings", () => {
    const raw: unknown = { ...makeDoc(makeNode("root", "Stack")), version: 2 };
    const result = validateDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("version: "))).toBe(true);
    }
  });

  it("validates children structurally through the node schema", () => {
    const raw: unknown = {
      version: 1,
      date: "2026-10-02",
      title: "Broken children",
      theme: validTheme,
      root: { id: "root", componentType: "Stack", props: { gap: 4 }, children: "not-an-array" },
    };
    const result = validateDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("root.children");
    }
  });

  it("never throws on non-object raw input and always reports an error", () => {
    for (const raw of [null, undefined, "", "hello", 42, true, [1, 2, 3]]) {
      const result = validateDocument(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("turns a throwing accessor on raw input into ok:false instead of propagating", () => {
    const raw = {
      get root(): unknown {
        throw new Error("hostile getter");
      },
    };
    const result = validateDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("hostile getter");
    }
  });

  // Never-throws hardening: exceptionText must survive String()/toString()
  // throwing while building the failure message.
  it("never throws on an object with a hostile toString()", () => {
    const hostile = {
      toString(): string {
        throw new Error("toString boom");
      },
    };

    // As raw input the schema failure is graceful — no stringification needed.
    const asInput = validateDocument(hostile);
    expect(asInput.ok).toBe(false);

    // As the thrown value the catch handler must fall back, not propagate.
    const raw = {
      get root(): unknown {
        throw hostile;
      },
    };
    const asThrown = validateDocument(raw);
    expect(asThrown.ok).toBe(false);
    if (!asThrown.ok) {
      expect(asThrown.errors.join(" ")).toContain("unknown validation failure");
    }
  });
});
