"use client";

import { Children, useState, type CSSProperties, type ReactNode } from "react";
import type { TabsProps } from "../component-props";

/**
 * Tabbed panels — a CLIENT component, deliberately kept out of
 * `layout.tsx`.
 *
 * `layout.tsx` must stay server-safe: `lib/generate.ts` imports the registry to
 * build the generation prompt, so a `"use client"` module there turns its Zod
 * schemas into client references on the server and every layout component
 * reaches the model as "no documented props". The interactive component lives
 * here instead, and only the schema stays in the server-safe module.
 *
 * Panels arrive as React children in document order, one per tab. When the
 * counts line up the tabs really switch; when they do not (a document already in
 * the archive may supply fewer children than labels) it degrades to a static
 * segmented control with every panel visible, so stored documents keep
 * rendering exactly as they did.
 */
export function Tabs({ tabs, children }: TabsProps) {
  // Panels arrive as React children in document order, one per tab. When the
  // counts line up the tabs really switch; when they do not (a document already
  // in the archive may supply fewer children than labels) it degrades to the
  // original static segmented control with every panel visible, so stored
  // documents keep rendering exactly as they did.
  const panels = Children.toArray(children);
  const interactive = panels.length === tabs.length && tabs.length > 0;
  const [active, setActive] = useState(0);

  const styleFor = (isActive: boolean): CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: "14px",
    fontWeight: 600,
    // White on a possibly-light --accent: a soft dark shadow keeps
    // the active label legible when the accent is pale (ruling 7).
    color: isActive ? "#ffffff" : "var(--fg, #111111)",
    background: isActive ? "var(--accent, #2563eb)" : "transparent",
    textShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.6)" : undefined,
  });

  const stripStyle: CSSProperties = {
    display: "inline-flex",
    alignSelf: "flex-start",
    gap: 4,
    padding: 4,
    borderRadius: 8,
    border: "1px solid rgba(127, 127, 127, 0.35)",
    background: "rgba(127, 127, 127, 0.08)",
  };

  const move = (next: number): void => {
    const bounded = (next + tabs.length) % tabs.length;
    setActive(bounded);
    // Roving focus, so the arrow keys actually move the user between tabs.
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[bounded]?.focus();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={stripStyle} role={interactive ? "tablist" : undefined}>
        {tabs.map((tab, index) =>
          interactive ? (
            <button
              key={`${tab.label}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              data-active={index === active ? "true" : "false"}
              style={{ ...styleFor(index === active), border: "none", cursor: "pointer", font: "inherit" }}
              onClick={() => {
                setActive(index);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(index + 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(index - 1);
                }
              }}
            >
              {tab.label}
            </button>
          ) : (
            <span
              key={`${tab.label}-${index}`}
              data-active={index === 0 ? "true" : "false"}
              style={styleFor(index === 0)}
            >
              {tab.label}
            </span>
          ),
        )}
      </div>
      {interactive ? (
        <div role="tabpanel">{panels[active]}</div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}
