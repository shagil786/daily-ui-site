import {
  centerPropsSchema,
  gridPropsSchema,
  sectionPropsSchema,
  splitPanePropsSchema,
  stackPropsSchema,
  tabsPropsSchema,
  timelinePropsSchema,
} from "../component-props";
import type {
  CenterProps,
  GridProps,
  SectionProps,
  SplitPaneProps,
  StackProps,
  TabsProps,
  TimelineProps,
} from "../component-props";
import { Children, type ReactNode } from "react";
import { z } from "zod";

/**
 * Layout primitives. Plain CSS via inline styles only; colors reference the
 * theme CSS variables (`--fg`, `--accent`) set on the document root, with
 * fallbacks so components still render sanely before the theme lands.
 */

export function Stack({ gap = 16, children }: StackProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {children}
    </div>
  );
}

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

/** `splitPanePropsSchema` validates no props; the pane shape comes from `children`. */
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
