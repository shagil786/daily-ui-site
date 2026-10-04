import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BeforeAfter, Card, Hero, ImageGallery, LinkList, TerminalSim, Text } from "../../lib/components/content";
import { ALLOWED_IMAGE_HOSTS } from "../../lib/component-props";
import { beforeAfterPropsSchema, cardPropsSchema, heroPropsSchema, imageGalleryPropsSchema, linkListPropsSchema, terminalSimPropsSchema, textPropsSchema } from "../../lib/component-props";
import { getComponent } from "../../lib/registry";

afterEach(cleanup);

const CONTENT_TYPES = [
  "Hero",
  "Text",
  "Card",
  "ImageGallery",
  "LinkList",
  "BeforeAfter",
  "TerminalSim",
] as const;

describe("Text", () => {
  it("renders its text", () => {
    render(<Text text="plain-text-content" />);
    expect(screen.queryByText("plain-text-content")).not.toBeNull();
  });

  it("renders each supported size", () => {
    render(<Text text="size-sm" size="sm" />);
    render(<Text text="size-lg" size="lg" />);
    expect(screen.queryByText("size-sm")).not.toBeNull();
    expect(screen.queryByText("size-lg")).not.toBeNull();
  });

  it("rejects { text: 42 } by its propsSchema", () => {
    expect(textPropsSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(textPropsSchema.safeParse({ text: "ok" }).success).toBe(true);
    expect(textPropsSchema.safeParse({ text: "ok", size: "xl" }).success).toBe(false);
  });
});

describe("ImageGallery", () => {
  it("accepts a https URL from an allowed host", () => {
    expect(
      imageGalleryPropsSchema.safeParse({
        images: [{ url: "https://images.example.com/x.png" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a non-allowlisted host", () => {
    expect(
      imageGalleryPropsSchema.safeParse({ images: [{ url: "https://evil.com/x.png" }] }).success,
    ).toBe(false);
  });

  it("rejects a non-https scheme", () => {
    expect(
      imageGalleryPropsSchema.safeParse({
        images: [{ url: "http://insecure.com/x.png" }],
      }).success,
    ).toBe(false);
  });

  it("documents example.com in the default allowlist (test adds none)", () => {
    expect(ALLOWED_IMAGE_HOSTS).toContain("example.com");
  });

  it("renders each image with its alt text", () => {
    render(
      <ImageGallery
        images={[
          { url: "https://images.example.com/one.png", alt: "gallery-one" },
          { url: "https://picsum.photos/seed/two/400/300", alt: "gallery-two" },
        ]}
      />,
    );
    const first = screen.getByAltText("gallery-one");
    const second = screen.getByAltText("gallery-two");
    expect(first.getAttribute("src")).toBe("https://images.example.com/one.png");
    expect(second.getAttribute("src")).toBe("https://picsum.photos/seed/two/400/300");
  });
});

describe("Hero", () => {
  it("renders the heading and the optional sub", () => {
    render(<Hero heading="hero-heading" sub="hero-sub" />);
    expect(screen.queryByRole("heading", { name: "hero-heading" })).not.toBeNull();
    expect(screen.queryByText("hero-sub")).not.toBeNull();
  });

  it("renders the heading without a sub when omitted", () => {
    render(<Hero heading="solo-heading" />);
    expect(screen.queryByRole("heading", { name: "solo-heading" })).not.toBeNull();
    expect(screen.queryByText("hero-sub")).toBeNull();
  });

  it("requires a heading string in its propsSchema", () => {
    expect(heroPropsSchema.safeParse({ heading: "hi" }).success).toBe(true);
    expect(heroPropsSchema.safeParse({ heading: "hi", sub: "there" }).success).toBe(true);
    expect(heroPropsSchema.safeParse({ sub: "no heading" }).success).toBe(false);
    expect(heroPropsSchema.safeParse({ heading: 7 }).success).toBe(false);
  });
});

describe("Card", () => {
  it("renders title and body", () => {
    render(<Card title="card-title" body="card-body" />);
    expect(screen.queryByRole("heading", { name: "card-title" })).not.toBeNull();
    expect(screen.queryByText("card-body")).not.toBeNull();
  });

  it("exposes the title as a level-3 heading (nested under a Section h2)", () => {
    render(<Card title="nested-heading" body="b" />);
    expect(screen.queryByRole("heading", { level: 3, name: "nested-heading" })).not.toBeNull();
  });

  it("requires both title and body", () => {
    expect(cardPropsSchema.safeParse({ title: "t", body: "b" }).success).toBe(true);
    expect(cardPropsSchema.safeParse({ title: "t" }).success).toBe(false);
    expect(cardPropsSchema.safeParse({ body: "b" }).success).toBe(false);
  });
});

describe("LinkList", () => {
  it("renders same-tab anchors with rel=noreferrer (no inert noopener)", () => {
    const { container } = render(
      <LinkList
        links={[
          { label: "Docs", href: "https://example.com/docs" },
          { label: "Blog", href: "https://images.unsplash.com/blog" },
        ]}
      />,
    );
    expect(container.querySelector("ul")?.getAttribute("role")).toBe("list");
    const anchors = screen.getAllByRole("link");
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/docs");
    expect(anchors[0]?.getAttribute("rel")).toBe("noreferrer");
    expect(anchors[1]?.getAttribute("rel")).toBe("noreferrer");
    // Same-tab navigation: an external target would break back-button flow.
    expect(anchors[0]?.getAttribute("target")).toBeNull();
    expect(screen.queryByText("Docs")).not.toBeNull();
    expect(screen.queryByText("Blog")).not.toBeNull();
  });

  it("requires https hrefs of any host", () => {
    expect(
      linkListPropsSchema.safeParse({ links: [{ label: "x", href: "https://any.host/x" }] })
        .success,
    ).toBe(true);
    expect(
      linkListPropsSchema.safeParse({ links: [{ label: "x", href: "http://any.host/x" }] })
        .success,
    ).toBe(false);
    expect(
      linkListPropsSchema.safeParse({ links: [{ label: "x", href: "/relative" }] }).success,
    ).toBe(false);
    expect(
      linkListPropsSchema.safeParse({ links: [{ label: 3, href: "https://any.host/x" }] })
        .success,
    ).toBe(false);
  });
});

describe("BeforeAfter", () => {
  it("renders both images and the caption", () => {
    render(
      <BeforeAfter
        before="https://images.example.com/before.png"
        after="https://images.example.com/after.png"
        caption="before-after-caption"
      />,
    );
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("src")).toBe("https://images.example.com/before.png");
    expect(images[1]?.getAttribute("src")).toBe("https://images.example.com/after.png");
    expect(screen.queryByText("before-after-caption")).not.toBeNull();
  });

  it("renders both images without a caption when omitted", () => {
    render(
      <BeforeAfter
        before="https://picsum.photos/seed/b/400/300"
        after="https://picsum.photos/seed/a/400/300"
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByText("before-after-caption")).toBeNull();
  });

  it("validates both urls against the shared image rule", () => {
    const ok = {
      before: "https://images.example.com/b.png",
      after: "https://images.example.com/a.png",
    };
    expect(beforeAfterPropsSchema.safeParse(ok).success).toBe(true);
    expect(
      beforeAfterPropsSchema.safeParse({ ...ok, after: "https://evil.com/a.png" }).success,
    ).toBe(false);
    expect(
      beforeAfterPropsSchema.safeParse({ ...ok, before: "http://insecure.com/b.png" }).success,
    ).toBe(false);
  });
});

describe("TerminalSim", () => {
  it("renders lines inside a <pre>", () => {
    const { container } = render(<TerminalSim lines={["$ ls", "app  lib  tests"]} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("$ ls");
    expect(pre?.textContent).toContain("app  lib  tests");
  });

  it("requires a string array", () => {
    expect(terminalSimPropsSchema.safeParse({ lines: ["$ pwd"] }).success).toBe(true);
    expect(terminalSimPropsSchema.safeParse({ lines: [] }).success).toBe(true);
    expect(terminalSimPropsSchema.safeParse({ lines: [42] }).success).toBe(false);
    expect(terminalSimPropsSchema.safeParse({ lines: "$ pwd" }).success).toBe(false);
  });
});

describe("content registry entries", () => {
  it("registers every content component with a component and a props schema", () => {
    for (const type of CONTENT_TYPES) {
      const entry = getComponent(type);
      expect(entry, `missing registry entry for ${type}`).toBeDefined();
      expect(typeof entry?.Component).toBe("function");
      expect(entry?.propsSchema).toBeDefined();
    }
  });
});
