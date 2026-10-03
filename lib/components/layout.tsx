import { Children, type ReactNode } from "react";
import { z } from "zod";

/**
 * Layout primitives. Plain CSS via inline styles only; colors reference the
 * theme CSS variables (`--fg`, `--accent`) set on the document root, with
 * fallbacks so components still render sanely before the theme lands.
 */

export const stackPropsSchema = z
  .object({
    gap: z.number().optional(),
  })
  .describe("Vertical stack of children. Props: gap?: number (px spacing).");

export type StackProps = z.infer<typeof stackPropsSchema> & { children?: ReactNode };

export function Stack({ gap = 16, children }: StackProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {children}
    </div>
  );
}

export const centerPropsSchema = z
  .object({
    maxWidth: z.number().optional(),
  })
  .describe("Centers children horizontally and vertically. Props: maxWidth?: number (px).");

export type CenterProps = z.infer<typeof centerPropsSchema> & { children?: ReactNode };

export function Center({ maxWidth, children }: CenterProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: maxWidth === undefined ? undefined : `${maxWidth}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const gridPropsSchema = z
  .object({
    columns: z.number().int().min(1).max(12).optional(),
  })
  .describe("CSS grid of children. Props: columns?: number (integer 1-12).");

export type GridProps = z.infer<typeof gridPropsSchema> & { children?: ReactNode };

export function Grid({ columns = 2, children }: GridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

export const sectionPropsSchema = z
  .object({
    heading: z.string().optional(),
  })
  .describe("Section with an optional heading above its children. Props: heading?: string.");

export type SectionProps = z.infer<typeof sectionPropsSchema> & { children?: ReactNode };

export function Section({ heading, children }: SectionProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {heading === undefined ? null : (
        <h2
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--fg, #111111)",
          }}
        >
          {heading}
        </h2>
      )}
      {children}
    </section>
  );
}

export const splitPanePropsSchema = z.object({}).describe(
  "Two children rendered side by side. Props: none.",
);

/** `splitPanePropsSchema` validates no props; the pane shape comes from `children`. */
export type SplitPaneProps = { children?: ReactNode };

export function SplitPane({ children }: SplitPaneProps) {
  const panes = Children.toArray(children);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: 16,
        width: "100%",
      }}
    >
      {panes.map((pane, index) => (
        <div key={index} style={{ flex: "1 1 0%", minWidth: 0 }}>
          {pane}
        </div>
      ))}
    </div>
  );
}

export const tabsPropsSchema = z
  .object({
    tabs: z.array(z.object({ label: z.string() })),
  })
  .describe("Tab labels as a segmented control over a single children region. Props: tabs: { label: string }[].");

export type TabsProps = z.infer<typeof tabsPropsSchema> & { children?: ReactNode };

export function Tabs({ tabs, children }: TabsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          gap: 4,
          padding: 4,
          borderRadius: 8,
          border: "1px solid rgba(127, 127, 127, 0.35)",
          background: "rgba(127, 127, 127, 0.08)",
        }}
      >
        {tabs.map((tab, index) => (
          <span
            key={`${tab.label}-${index}`}
            data-active={index === 0 ? "true" : "false"}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: "14px",
              fontWeight: 600,
              // White on a possibly-light --accent: a soft dark shadow keeps
              // the active label legible when the accent is pale (ruling 7).
              color: index === 0 ? "#ffffff" : "var(--fg, #111111)",
              background: index === 0 ? "var(--accent, #2563eb)" : "transparent",
              textShadow:
                index === 0 ? "0 1px 2px rgba(0, 0, 0, 0.6)" : undefined,
            }}
          >
            {tab.label}
          </span>
        ))}
      </div>
      <div>{children}</div>
    </div>
  );
}

export const timelinePropsSchema = z
  .object({
    events: z.array(z.object({ date: z.string(), text: z.string() })),
  })
  .describe("Vertical timeline of dated events. Props: events: { date: string; text: string }[].");

export type TimelineProps = z.infer<typeof timelinePropsSchema>;

export function Timeline({ events }: TimelineProps) {
  return (
    <ol
      // Explicit role: Safari VoiceOver drops list semantics when the marker
      // is removed with `list-style: none`.
      role="list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {events.map((event, index) => (
        <li
          key={`${event.date}-${index}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingLeft: 12,
            borderLeft: "2px solid var(--accent, #2563eb)",
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent, #2563eb)" }}>
            {event.date}
          </span>
          <span style={{ fontSize: "15px", lineHeight: 1.5, color: "var(--fg, #111111)" }}>
            {event.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
