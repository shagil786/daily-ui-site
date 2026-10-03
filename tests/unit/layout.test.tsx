import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Center, Grid, Section, SplitPane, Stack, Tabs, Timeline } from "../../lib/components/layout";

afterEach(cleanup);

/** The single root element a layout component renders. */
function wrapperOf(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!element) {
    throw new Error("expected a rendered root element");
  }
  return element as HTMLElement;
}

describe("Stack", () => {
  it("renders both children in a flex column with the given gap", () => {
    const { container } = render(
      <Stack gap={4}>
        <p>stack-first</p>
        <p>stack-second</p>
      </Stack>,
    );
    expect(screen.queryByText("stack-first")).not.toBeNull();
    expect(screen.queryByText("stack-second")).not.toBeNull();

    const wrapper = wrapperOf(container);
    expect(wrapper.style.display).toBe("flex");
    expect(wrapper.style.flexDirection).toBe("column");
    expect(wrapper.style.gap).toBe("4px");
  });
});

describe("Center", () => {
  it("flex-centers children inside a maxWidth constraint", () => {
    const { container } = render(
      <Center maxWidth={640}>
        <p>centered-copy</p>
      </Center>,
    );
    expect(screen.queryByText("centered-copy")).not.toBeNull();

    const outer = wrapperOf(container);
    expect(outer.style.display).toBe("flex");
    expect(outer.style.justifyContent).toBe("center");
    expect(outer.style.alignItems).toBe("center");

    const inner = outer.firstElementChild as HTMLElement;
    expect(inner.style.maxWidth).toBe("640px");
  });
});

describe("Grid", () => {
  it("renders children in a CSS grid with the requested column count", () => {
    const { container } = render(
      <Grid columns={3}>
        <span>grid-a</span>
        <span>grid-b</span>
        <span>grid-c</span>
      </Grid>,
    );
    expect(screen.queryByText("grid-a")).not.toBeNull();
    expect(screen.queryByText("grid-b")).not.toBeNull();
    expect(screen.queryByText("grid-c")).not.toBeNull();

    const wrapper = wrapperOf(container);
    expect(wrapper.style.display).toBe("grid");
    expect(wrapper.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });
});

describe("Section", () => {
  it("renders the heading above its children", () => {
    render(
      <Section heading="Section heading">
        <p>section-body</p>
      </Section>,
    );
    expect(screen.queryByRole("heading", { name: "Section heading" })).not.toBeNull();
    expect(screen.queryByText("section-body")).not.toBeNull();
  });

  it("renders children without a heading when none is given", () => {
    render(
      <Section>
        <p>headingless-body</p>
      </Section>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("headingless-body")).not.toBeNull();
  });
});

describe("SplitPane", () => {
  it("lays two children side by side", () => {
    const { container } = render(
      <SplitPane>
        <p>pane-left</p>
        <p>pane-right</p>
      </SplitPane>,
    );
    expect(screen.queryByText("pane-left")).not.toBeNull();
    expect(screen.queryByText("pane-right")).not.toBeNull();

    const wrapper = wrapperOf(container);
    expect(wrapper.style.display).toBe("flex");
    expect(wrapper.style.flexDirection).toBe("row");
    expect(wrapper.children).toHaveLength(2);
  });
});

describe("Tabs", () => {
  it("renders tab labels as a segmented control over a single children region", () => {
    const { container } = render(
      <Tabs
        tabs={[
          { label: "Alpha" },
          { label: "Beta" },
        ]}
      >
        <p>tabs-panel</p>
      </Tabs>,
    );
    expect(screen.queryByText("Alpha")).not.toBeNull();
    expect(screen.queryByText("Beta")).not.toBeNull();
    expect(screen.queryByText("tabs-panel")).not.toBeNull();

    const wrapper = wrapperOf(container);
    expect(wrapper.children).toHaveLength(2);
    const segments = wrapper.querySelectorAll("[data-active]");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.getAttribute("data-active")).toBe("true");
    expect(segments[1]?.getAttribute("data-active")).toBe("false");
  });
});

describe("Timeline", () => {
  it("renders every event's date and text", () => {
    render(
      <Timeline
        events={[
          { date: "2026-10-01", text: "timeline-first-event" },
          { date: "2026-10-02", text: "timeline-second-event" },
        ]}
      />,
    );
    expect(screen.queryByText("2026-10-01")).not.toBeNull();
    expect(screen.queryByText("timeline-first-event")).not.toBeNull();
    expect(screen.queryByText("2026-10-02")).not.toBeNull();
    expect(screen.queryByText("timeline-second-event")).not.toBeNull();
  });

  it("keeps list semantics despite list-style: none", () => {
    const { container } = render(<Timeline events={[{ date: "2026-10-01", text: "a11y-event" }]} />);
    // Safari VoiceOver drops list semantics when list-style is none, so the
    // role has to be explicit rather than implicit.
    expect(container.querySelector("ol")?.getAttribute("role")).toBe("list");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
