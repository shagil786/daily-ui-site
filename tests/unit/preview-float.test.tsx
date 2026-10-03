import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UiDocument } from "../../lib/schema";
import { PreviewBox } from "../../app/preview-box";

/**
 * Floating behaviour: a collapsed bubble, a draggable panel whose position is
 * remembered, and a full-viewport result. Dragging is pointer-only, so the
 * panel also has to be movable and dismissible from the keyboard.
 */

const doc: UiDocument = {
  version: 1,
  date: "2026-10-04",
  title: "Floating Result",
  theme: { bg: "#ffffff", fg: "#111111", accent: "#3355ff", font: "sans", dark: false },
  root: { id: "root", componentType: "Stack", props: { gap: 8 }, children: [] },
};

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

/**
 * jsdom performs no layout, so the panel's box is stubbed explicitly. It is
 * treated as a 380x260 panel at the given top-left corner.
 */
function stubLayout(at: { x: number; y: number } = { x: 900, y: 540 }): void {
  const panel = screen.getByTestId("preview-panel");
  Object.defineProperty(panel, "offsetWidth", { value: 380, configurable: true });
  Object.defineProperty(panel, "offsetHeight", { value: 260, configurable: true });
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    x: at.x,
    y: at.y,
    left: at.x,
    top: at.y,
    right: at.x + 380,
    bottom: at.y + 260,
    width: 380,
    height: 260,
    toJSON: () => ({}),
  } as DOMRect);
  window.innerWidth = 1280;
  window.innerHeight = 800;
}

function openPanel(brief = "a calm invoice dashboard"): void {
  fireEvent.click(screen.getByTestId("preview-toggle"));
  fireEvent.change(screen.getByTestId("preview-input"), { target: { value: brief } });
}

/** A drag: press on the header, move, release. jsdom needs pointerId 1. */
function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const header = screen.getByTestId("preview-header");
  fireEvent.pointerDown(header, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  fireEvent.pointerMove(header, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(header, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  // Explicit: this vitest config has no globals, so Testing Library's automatic
  // cleanup never registers and renders would otherwise accumulate.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PreviewBox bubble", () => {
  it("starts as a collapsed bubble with no panel", () => {
    render(<PreviewBox />);
    expect(screen.getByTestId("preview-toggle")).toBeDefined();
    expect(screen.queryByTestId("preview-panel")).toBeNull();
  });

  it("opens a draggable panel on click, replacing the launcher", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    expect(screen.getByTestId("preview-panel")).toBeDefined();
    expect(screen.getByTestId("preview-header")).toBeDefined();
    // The launcher occupied the same corner; leaving it up would overlap.
    expect(screen.queryByTestId("preview-toggle")).toBeNull();
  });

  it("re-opens the panel from the bubble after closing it", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    fireEvent.click(screen.getByTestId("preview-close"));

    expect(screen.getByTestId("preview-toggle")).toBeDefined();
    fireEvent.click(screen.getByTestId("preview-toggle"));
    expect(screen.getByTestId("preview-panel")).toBeDefined();
  });

  it("closes back to the bubble with Escape", () => {
    render(<PreviewBox />);
    openPanel();
    expect(screen.getByTestId("preview-panel")).toBeDefined();
    fireEvent.keyDown(screen.getByTestId("preview-panel"), { key: "Escape" });
    expect(screen.queryByTestId("preview-panel")).toBeNull();
  });
});

describe("PreviewBox dragging", () => {
  it("moves the panel and remembers the edge it snapped to", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    stubLayout();

    // Drop in the bottom-left quadrant → the panel snaps to that corner.
    drag({ x: 100, y: 700 }, { x: 10, y: 700 });

    const stored = window.localStorage.getItem("daily-ui:preview-panel-position");
    expect(stored).not.toBeNull();
    const saved = JSON.parse(stored ?? "{}") as { edge?: string };
    expect(saved.edge).toBe("bottom-left");

    // And the stored position is applied on the next open.
    fireEvent.click(screen.getByTestId("preview-close"));
    fireEvent.click(screen.getByTestId("preview-toggle"));
    expect(screen.getByTestId("preview-panel").getAttribute("data-edge")).toBe("bottom-left");
  });

  it("resets to the default corner and forgets the stored position", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    stubLayout();
    drag({ x: 100, y: 700 }, { x: 10, y: 700 });

    fireEvent.click(screen.getByTestId("preview-reset"));

    expect(window.localStorage.getItem("daily-ui:preview-panel-position")).toBeNull();
    expect(screen.getByTestId("preview-panel").getAttribute("data-edge")).toBe("bottom-right");
  });

  it("ignores a corrupt stored position rather than failing to open", () => {
    window.localStorage.setItem("daily-ui:preview-panel-position", "{not json");
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));

    expect(screen.getByTestId("preview-panel").getAttribute("data-edge")).toBe("bottom-right");
  });

  it("pressing Reset does not start a drag that re-snaps the panel", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    stubLayout({ x: 100, y: 100 }); // resting top-left
    drag({ x: 100, y: 700 }, { x: 10, y: 700 });
    expect(screen.getByTestId("preview-panel").getAttribute("data-edge")).toBe("bottom-left");

    // A real click on Reset: pointerdown must not reach the drag handle, or the
    // pointerup that follows would re-snap the panel to wherever it sits.
    const reset = screen.getByTestId("preview-reset");
    fireEvent.pointerDown(reset, { clientX: 50, clientY: 110, pointerId: 1, button: 0 });
    fireEvent.pointerUp(reset, { clientX: 50, clientY: 110, pointerId: 1 });
    fireEvent.click(reset);

    expect(screen.getByTestId("preview-panel").getAttribute("data-edge")).toBe("bottom-right");
  });

  it("moves the panel with the arrow keys so it is not pointer-only", () => {
    render(<PreviewBox />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    stubLayout();

    // The stubbed panel sits just right of the midline; one ArrowLeft nudge
    // carries its centre across to the left half, so it snaps bottom-left.
    stubLayout({ x: 400, y: 540 });
    fireEvent.keyDown(screen.getByTestId("preview-header"), { key: "ArrowLeft" });

    const saved = JSON.parse(
      window.localStorage.getItem("daily-ui:preview-panel-position") ?? "{}",
    ) as { edge?: string };
    expect(saved.edge).toBe("bottom-left");
  });
});

describe("PreviewBox result", () => {
  it("shows the generated document full-viewport with a way back", async () => {
    stubFetch({ doc });
    render(<PreviewBox />);
    openPanel();
    fireEvent.click(screen.getByTestId("preview-generate"));
    await screen.findByTestId("preview-result");

    const result = screen.getByTestId("preview-result");
    expect(result.getAttribute("role")).toBe("dialog");
    expect(screen.getByText("Floating Result")).toBeDefined();
    expect(screen.getByTestId("preview-back")).toBeDefined();
    // The composer is gone while the design is on screen.
    expect(screen.queryByTestId("preview-input")).toBeNull();
  });

  it("returns to the composer and keeps the brief after going back", async () => {
    stubFetch({ doc });
    render(<PreviewBox />);
    const brief = "a brutalist newspaper front page";
    openPanel(brief);
    fireEvent.click(screen.getByTestId("preview-generate"));
    await screen.findByTestId("preview-result");

    fireEvent.click(screen.getByTestId("preview-back"));

    expect(screen.getByTestId("preview-input")).toBeDefined();
    expect((screen.getByTestId("preview-input") as HTMLTextAreaElement).value).toBe(brief);
  });
});