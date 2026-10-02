import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer } from "../../lib/renderer";
import { registry } from "../../lib/registry";
import type { Node } from "../../lib/schema";

afterEach(() => {
  // Test-only component: never leaves this file's scope behind.
  delete registry.Boom;
  vi.unstubAllEnvs();
  cleanup();
});

describe("Renderer", () => {
  it("renders a Stack→Text tree with the text visible", () => {
    const tree: Node = {
      id: "root",
      componentType: "Stack",
      props: { gap: 8 },
      children: [
        // `children` omitted on the Text node: exercises the `children ?? []` guard.
        { id: "line", componentType: "Text", props: { text: "renderer-text-visible" } },
      ],
    };

    render(<Renderer node={tree} />);

    expect(screen.getByText("renderer-text-visible")).not.toBeNull();
  });

  it("walks nested children to depth 3 and renders the deepest text", () => {
    const tree: Node = {
      id: "d1",
      componentType: "Stack",
      props: { gap: 4 },
      children: [
        {
          id: "d2",
          componentType: "Stack",
          props: { gap: 4 },
          children: [
            {
              id: "d3",
              componentType: "Stack",
              props: { gap: 4 },
              children: [
                { id: "d4", componentType: "Text", props: { text: "deepest-text" } },
              ],
            },
          ],
        },
      ],
    };

    render(<Renderer node={tree} />);

    expect(screen.getByText("deepest-text")).not.toBeNull();
  });

  it("renders an unknown componentType as a placeholder without throwing", () => {
    const ghost: Node = {
      id: "ghost",
      componentType: "Ghost",
      props: { payload: "must-not-render" },
      children: [
        { id: "hidden", componentType: "Text", props: { text: "hidden-child" } },
      ],
    };

    render(<Renderer node={ghost} />);

    const placeholder = screen.getByTestId("unknown-component");
    expect(placeholder.getAttribute("role")).toBe("presentation");
    // Non-production (vitest runs with NODE_ENV=test) shows the type name.
    expect(placeholder.textContent).toBe("Ghost");
    // Placeholder renders neither props nor children.
    expect(screen.queryByText("must-not-render")).toBeNull();
    expect(screen.queryByText("hidden-child")).toBeNull();
  });

  it("shows nothing identifying in the unknown placeholder under NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(
      <Renderer
        node={{ id: "ghost-prod", componentType: "Ghost", props: { payload: "secret" } }}
      />,
    );
    expect(screen.getByTestId("unknown-component").textContent).toBe("");
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("isolates a throwing component behind its own boundary while siblings stay visible", () => {
    const Boom: ComponentType = () => {
      throw new Error("boom-explosion");
    };
    registry.Boom = { propsSchema: z.object({}), Component: Boom };

    // React logs caught errors through console.error; keep test output pristine.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tree: Node = {
        id: "root",
        componentType: "Stack",
        props: { gap: 4 },
        children: [
          { id: "bad", componentType: "Boom", props: {} },
          { id: "fine", componentType: "Text", props: { text: "sibling-still-visible" } },
        ],
      };

      render(<Renderer node={tree} />);

      expect(screen.getByTestId("node-error")).not.toBeNull();
      expect(screen.getByText("sibling-still-visible")).not.toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});
