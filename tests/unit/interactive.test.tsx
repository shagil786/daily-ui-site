import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accordion, CanvasNoise, Clicker, Clock, Counter, Marquee, Poll, ProgressBar, Todo } from "../../lib/components/interactive";
import { accordionPropsSchema, canvasNoisePropsSchema, clickerPropsSchema, clockPropsSchema, counterPropsSchema, marqueePropsSchema, pollPropsSchema, progressBarPropsSchema, todoPropsSchema } from "../../lib/component-props";
import { getComponent, inventoryForPrompt } from "../../lib/registry";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The exact 23-type registry the plan pins: 7 layout + 7 content + 9 interactive. */
const ALL_TYPES = [
  "Stack",
  "Grid",
  "SplitPane",
  "Tabs",
  "Timeline",
  "Center",
  "Section",
  "Hero",
  "Text",
  "Card",
  "ImageGallery",
  "LinkList",
  "BeforeAfter",
  "TerminalSim",
  "Counter",
  "Todo",
  "Poll",
  "Clock",
  "Clicker",
  "Marquee",
  "CanvasNoise",
  "ProgressBar",
  "Accordion",
] as const;

const INTERACTIVE_TYPES = [
  "Counter",
  "Todo",
  "Poll",
  "Clock",
  "Clicker",
  "Marquee",
  "CanvasNoise",
  "ProgressBar",
  "Accordion",
] as const;

describe("registry inventory", () => {
  it("inventoryForPrompt() lists exactly the 23 registered types", () => {
    const inventory = inventoryForPrompt() as Array<{ type: string; propsDescription: string }>;
    expect(inventory.map((item) => item.type)).toEqual([...ALL_TYPES].sort());
  });

  it("registers every interactive component with a component and a props schema", () => {
    for (const type of INTERACTIVE_TYPES) {
      const entry = getComponent(type);
      expect(entry, `missing registry entry for ${type}`).toBeDefined();
      expect(typeof entry?.Component).toBe("function");
      expect(entry?.propsSchema).toBeDefined();
    }
  });
});

describe("Counter", () => {
  it("clicking + increments 5 → 6", () => {
    render(<Counter start={5} />);
    expect(screen.getByText("5")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(screen.getByText("6")).not.toBeNull();
    expect(screen.queryByText("5")).toBeNull();
  });

  it("renders its optional label", () => {
    render(<Counter start={0} label="Points" />);
    expect(screen.getByText("Points")).not.toBeNull();
  });

  it("requires a numeric start when given", () => {
    expect(counterPropsSchema.safeParse({ start: 5 }).success).toBe(true);
    expect(counterPropsSchema.safeParse({}).success).toBe(true);
    expect(counterPropsSchema.safeParse({ start: "5" }).success).toBe(false);
    expect(counterPropsSchema.safeParse({ label: 7 }).success).toBe(false);
  });
});

describe("Todo", () => {
  it("keeps list semantics on the item list", () => {
    const { container } = render(<Todo title="Shopping" />);
    expect(container.querySelector("ul")?.getAttribute("role")).toBe("list");
  });

  it("typing + Enter adds an item to the list", () => {
    render(<Todo title="Shopping" />);
    expect(screen.queryByText("buy milk")).toBeNull();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "buy milk" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("buy milk")).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("does not submit while an IME composition is active", () => {
    render(<Todo title="Shopping" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "上衣" } });
    // Enter confirms the IME candidate; it must not add the item.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.queryByText("上衣")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("上衣");
  });

  it("ignores an empty Enter", () => {
    render(<Todo />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("requires a string title when given", () => {
    expect(todoPropsSchema.safeParse({ title: "Tasks" }).success).toBe(true);
    expect(todoPropsSchema.safeParse({}).success).toBe(true);
    expect(todoPropsSchema.safeParse({ title: 3 }).success).toBe(false);
  });
});

describe("Poll", () => {
  it("clicking an option marks it selected", () => {
    render(<Poll question="Pick one" options={["Alpha", "Beta"]} />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(beta);
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Pick one")).not.toBeNull();
  });

  it("requires a string array of options", () => {
    expect(pollPropsSchema.safeParse({ options: ["A", "B"] }).success).toBe(true);
    expect(pollPropsSchema.safeParse({ question: "Q?", options: ["A"] }).success).toBe(true);
    expect(pollPropsSchema.safeParse({ options: "A" }).success).toBe(false);
    expect(pollPropsSchema.safeParse({ options: [1, 2] }).success).toBe(false);
    expect(pollPropsSchema.safeParse({}).success).toBe(false);
  });
});

describe("Clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 14, 5, 9));
  });

  it("renders the current time and ticks every second", () => {
    render(<Clock format="24h" />);
    expect(screen.getByText("14:05:09")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("14:05:10")).not.toBeNull();
  });

  it("renders 12-hour time when asked", () => {
    render(<Clock format="12h" />);
    expect(screen.getByText("2:05:09 PM")).not.toBeNull();
  });

  it("clears its interval on unmount", () => {
    const { unmount } = render(<Clock format="24h" />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("only accepts a 12h or 24h format", () => {
    expect(clockPropsSchema.safeParse({}).success).toBe(true);
    expect(clockPropsSchema.safeParse({ format: "12h" }).success).toBe(true);
    expect(clockPropsSchema.safeParse({ format: "24h" }).success).toBe(true);
    expect(clockPropsSchema.safeParse({ format: "12" }).success).toBe(false);
    expect(clockPropsSchema.safeParse({ format: 24 }).success).toBe(false);
  });
});

describe("Clicker", () => {
  it("clicking the target increments the count", () => {
    render(<Clicker label="hit-target" />);
    expect(screen.getByText("0")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "hit-target" }));
    expect(screen.getByText("1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "hit-target" }));
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("requires a string label when given", () => {
    expect(clickerPropsSchema.safeParse({}).success).toBe(true);
    expect(clickerPropsSchema.safeParse({ label: "Tap" }).success).toBe(true);
    expect(clickerPropsSchema.safeParse({ label: 1 }).success).toBe(false);
  });
});

describe("Marquee", () => {
  it("renders duplicated text in an animated row", () => {
    const { container } = render(<Marquee text="marquee-text" speed={4} />);
    expect(screen.getAllByText("marquee-text")).toHaveLength(2);

    const style = container.querySelector("style");
    expect(style?.textContent ?? "").toContain("@keyframes");

    const row = container.querySelector("[data-marquee-row]");
    expect(row).not.toBeNull();
    const rowStyle = row?.getAttribute("style") ?? "";
    expect(rowStyle).toContain("animation");
    expect(rowStyle).toContain("marquee-scroll");
  });

  it("sizes each copy to at least the container so the row fills it (no dead zone)", () => {
    const { container } = render(<Marquee text="tiny" />);
    const outer = container.querySelector("[data-marquee]");
    expect(outer?.getAttribute("style") ?? "").toContain("container-type: inline-size");
    const copies = container.querySelectorAll("[data-marquee-copy]");
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.getAttribute("style") ?? "").toContain("min-width: 100cqw");
    }
  });

  it("requires a text string and bounds speed", () => {
    expect(marqueePropsSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(marqueePropsSchema.safeParse({ text: "hi", speed: 4 }).success).toBe(true);
    expect(marqueePropsSchema.safeParse({}).success).toBe(false);
    expect(marqueePropsSchema.safeParse({ text: 7 }).success).toBe(false);
    expect(marqueePropsSchema.safeParse({ text: "hi", speed: 0 }).success).toBe(false);
    expect(marqueePropsSchema.safeParse({ text: "hi", speed: "fast" }).success).toBe(false);
  });
});

describe("CanvasNoise", () => {
  beforeEach(() => {
    // jsdom's real getContext logs "Not implemented" on every call; mock it to
    // return exactly what jsdom would (null) so the run stays pristine while
    // the component's guard is still exercised for real.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("renders <canvas> without throwing when getContext is null (jsdom)", () => {
    const { container } = render(<CanvasNoise opacity={0.4} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    // No 2d context: the component must bail to its static gradient.
    expect(container.querySelector("[data-noise-fallback]")?.getAttribute("data-noise-fallback")).toBe(
      "true",
    );
  });

  it("schedules one animation frame with a 2d context and cancels it on unmount", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      clearRect: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const requestSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(1);
    const cancelSpy = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    const { container, unmount } = render(<CanvasNoise />);
    expect(container.querySelector("[data-noise-fallback]")?.getAttribute("data-noise-fallback")).toBe(
      "false",
    );
    expect(requestSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(1);
  });

  it("bounds opacity to 0-1", () => {
    expect(canvasNoisePropsSchema.safeParse({}).success).toBe(true);
    expect(canvasNoisePropsSchema.safeParse({ opacity: 0.4 }).success).toBe(true);
    expect(canvasNoisePropsSchema.safeParse({ opacity: 1.5 }).success).toBe(false);
    expect(canvasNoisePropsSchema.safeParse({ opacity: -0.1 }).success).toBe(false);
    expect(canvasNoisePropsSchema.safeParse({ opacity: "0.4" }).success).toBe(false);
  });
});

describe("ProgressBar", () => {
  it("renders value 50 as width 50%", () => {
    const { container } = render(<ProgressBar value={50} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    const fill = container.querySelector("[data-progress-fill]") as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("bounds value to 0-100", () => {
    expect(progressBarPropsSchema.safeParse({ value: 0 }).success).toBe(true);
    expect(progressBarPropsSchema.safeParse({ value: 50 }).success).toBe(true);
    expect(progressBarPropsSchema.safeParse({ value: 100 }).success).toBe(true);
    expect(progressBarPropsSchema.safeParse({ value: 101 }).success).toBe(false);
    expect(progressBarPropsSchema.safeParse({ value: -1 }).success).toBe(false);
    expect(progressBarPropsSchema.safeParse({ value: "50" }).success).toBe(false);
    expect(progressBarPropsSchema.safeParse({}).success).toBe(false);
  });
});

describe("Accordion", () => {
  it("clicking a header reveals the body", () => {
    render(<Accordion items={[{ title: "Question one", body: "accordion-body" }]} />);
    expect(screen.queryByText("accordion-body")).toBeNull();
    const header = screen.getByRole("button", { name: "Question one" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(screen.getByText("accordion-body")).not.toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(screen.queryByText("accordion-body")).toBeNull();
  });

  it("requires items shaped { title, body }", () => {
    const items = [{ title: "t", body: "b" }];
    expect(accordionPropsSchema.safeParse({ items }).success).toBe(true);
    expect(accordionPropsSchema.safeParse({ items: [] }).success).toBe(true);
    expect(accordionPropsSchema.safeParse({ items: [{ title: "t" }] }).success).toBe(false);
    expect(accordionPropsSchema.safeParse({ items: [{ body: "b" }] }).success).toBe(false);
    expect(accordionPropsSchema.safeParse({ items: "t" }).success).toBe(false);
    expect(accordionPropsSchema.safeParse({}).success).toBe(false);
  });
});
