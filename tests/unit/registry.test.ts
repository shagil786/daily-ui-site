import { describe, expect, it } from "vitest";
import { getComponent, inventoryForPrompt, registry } from "../../lib/registry";

const LAYOUT_TYPES = ["Stack", "Center", "Grid", "Section", "SplitPane", "Tabs", "Timeline"] as const;

describe("registry", () => {
  it("registers every layout component with a component and a props schema", () => {
    for (const type of LAYOUT_TYPES) {
      const entry = getComponent(type);
      expect(entry, `missing registry entry for ${type}`).toBeDefined();
      expect(typeof entry?.Component).toBe("function");
      expect(entry?.propsSchema).toBeDefined();
    }
  });

  it("exposes the registry keyed by component type", () => {
    expect(Object.keys(registry)).toEqual(expect.arrayContaining([...LAYOUT_TYPES]));
  });
});

describe("getComponent", () => {
  it("returns the Stack entry", () => {
    const entry = getComponent("Stack");
    expect(entry).toBeDefined();
    expect(typeof entry?.Component).toBe("function");
  });

  it("returns undefined for an unknown type", () => {
    expect(getComponent("Nope")).toBeUndefined();
  });

  it("never throws and ignores Object.prototype keys", () => {
    expect(() => getComponent("toString")).not.toThrow();
    expect(getComponent("toString")).toBeUndefined();
    expect(getComponent("constructor")).toBeUndefined();
    expect(getComponent("")).toBeUndefined();
  });
});

describe("Stack propsSchema", () => {
  it("accepts { gap: 2 }", () => {
    const entry = getComponent("Stack");
    expect(entry?.propsSchema.safeParse({ gap: 2 }).success).toBe(true);
  });

  it('rejects { gap: "x" }', () => {
    const entry = getComponent("Stack");
    expect(entry?.propsSchema.safeParse({ gap: "x" }).success).toBe(false);
  });
});

describe("layout propsSchemas", () => {
  it("Grid accepts columns 1-12 and rejects out-of-range or wrong types", () => {
    const schema = getComponent("Grid")?.propsSchema;
    expect(schema?.safeParse({ columns: 1 }).success).toBe(true);
    expect(schema?.safeParse({ columns: 12 }).success).toBe(true);
    expect(schema?.safeParse({ columns: 13 }).success).toBe(false);
    expect(schema?.safeParse({ columns: 0 }).success).toBe(false);
    expect(schema?.safeParse({ columns: 2.5 }).success).toBe(false);
    expect(schema?.safeParse({ columns: "3" }).success).toBe(false);
  });

  it("Center accepts a numeric maxWidth and rejects a string", () => {
    const schema = getComponent("Center")?.propsSchema;
    expect(schema?.safeParse({ maxWidth: 640 }).success).toBe(true);
    expect(schema?.safeParse({ maxWidth: "640" }).success).toBe(false);
  });

  it("Tabs requires a tabs array of { label } objects", () => {
    const schema = getComponent("Tabs")?.propsSchema;
    expect(schema?.safeParse({ tabs: [{ label: "One" }] }).success).toBe(true);
    expect(schema?.safeParse({}).success).toBe(false);
    expect(schema?.safeParse({ tabs: [{ label: 3 }] }).success).toBe(false);
  });

  it("Timeline requires events with both date and text", () => {
    const schema = getComponent("Timeline")?.propsSchema;
    expect(schema?.safeParse({ events: [{ date: "2026-10-02", text: "Ship it" }] }).success).toBe(
      true,
    );
    expect(schema?.safeParse({ events: [{ date: "2026-10-02" }] }).success).toBe(false);
    expect(schema?.safeParse({ events: [{ text: "Ship it" }] }).success).toBe(false);
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it("Section accepts an optional heading", () => {
    const schema = getComponent("Section")?.propsSchema;
    expect(schema?.safeParse({}).success).toBe(true);
    expect(schema?.safeParse({ heading: "About" }).success).toBe(true);
    expect(schema?.safeParse({ heading: 7 }).success).toBe(false);
  });
});

describe("inventoryForPrompt", () => {
  it("contains Stack and Center", () => {
    const inventory = inventoryForPrompt() as Array<{ type: string; propsDescription: string }>;
    const types = inventory.map((item) => item.type);
    expect(types).toContain("Stack");
    expect(types).toContain("Center");
  });

  it("is JSON-safe and lists every layout type with a non-empty description", () => {
    const inventory = inventoryForPrompt();
    const roundTripped: unknown = JSON.parse(JSON.stringify(inventory));
    expect(roundTripped).toStrictEqual(inventory);

    const items = roundTripped as Array<{ type: string; propsDescription: string }>;
    for (const type of LAYOUT_TYPES) {
      expect(
        items.some((item) => item.type === type),
        `inventory is missing ${type}`,
      ).toBe(true);
    }
    for (const item of items) {
      expect(typeof item.type).toBe("string");
      expect(typeof item.propsDescription).toBe("string");
      expect(item.propsDescription.length).toBeGreaterThan(0);
    }
  });
});
