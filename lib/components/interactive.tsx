"use client";

import {
  accordionPropsSchema,
  canvasNoisePropsSchema,
  clickerPropsSchema,
  clockPropsSchema,
  counterPropsSchema,
  marqueePropsSchema,
  pollPropsSchema,
  progressBarPropsSchema,
  todoPropsSchema,
} from "../component-props";
import type {
  AccordionProps,
  CanvasNoiseProps,
  ClickerProps,
  ClockProps,
  CounterProps,
  MarqueeProps,
  PollProps,
  ProgressBarProps,
  TodoProps,
} from "../component-props";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

/**
 * Interactive components: stateful client components (hence `"use client"`).
 * Like the server-safe sets they use plain CSS via inline styles and the theme
 * CSS variables (`--fg`, `--accent`) with fallbacks; the only `<style>` tag is
 * Marquee's `@keyframes` — there are no external stylesheets.
 */

export function Counter({ start = 0, label }: CounterProps) {
  const [count, setCount] = useState(start);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      {label === undefined ? null : (
        <span style={{ fontSize: "15px", color: "var(--fg, #111111)" }}>{label}</span>
      )}
      <output
        aria-live="polite"
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg, #111111)",
        }}
      >
        {count}
      </output>
      <button
        type="button"
        aria-label="Increment"
        onClick={() => setCount((value) => value + 1)}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: "none",
          background: "var(--accent, #2563eb)",
          color: "#ffffff",
          fontSize: "1.125rem",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        +
      </button>
    </div>
  );
}

export function Todo({ title }: TodoProps) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const addDraft = () => {
    const next = draft.trim();
    if (next === "") return;
    setItems((previous) => [...previous, next]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {title === undefined ? null : (
        <h3
          style={{
            margin: 0,
            fontSize: "1.125rem",
            fontWeight: 700,
            color: "var(--fg, #111111)",
          }}
        >
          {title}
        </h3>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          addDraft();
        }}
        style={{ display: "flex" }}
      >
        <input
          type="text"
          value={draft}
          aria-label="New todo"
          placeholder="Add a todo, then press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Enter confirms an IME candidate; adding the item there would
            // submit half-typed text.
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            addDraft();
          }}
          style={{
            flex: "1 1 auto",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(127, 127, 127, 0.35)",
            background: "transparent",
            fontSize: "15px",
            color: "var(--fg, #111111)",
          }}
        />
      </form>
      <ul
        role="list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(127, 127, 127, 0.35)",
              fontSize: "15px",
              color: "var(--fg, #111111)",
            }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Poll({ question, options }: PollProps) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {question === undefined ? null : (
        <p
          style={{
            margin: 0,
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--fg, #111111)",
          }}
        >
          {question}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((option, index) => {
          const isSelected = selected === index;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(index)}
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(127, 127, 127, 0.35)",
                background: isSelected ? "var(--accent, #2563eb)" : "transparent",
                color: isSelected ? "#ffffff" : "var(--fg, #111111)",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `toLocaleTimeString` can emit a narrow no-break space (U+202F) before
 * "AM/PM" depending on the ICU version; normalize so output is identical
 * across environments.
 */
function formatTime(date: Date, format: "12h" | "24h"): string {
  return date
    .toLocaleTimeString("en-US", {
      hour: format === "12h" ? "numeric" : "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: format === "12h",
    })
    .replace(/[\u202f\u00a0]/g, " ");
}

export function Clock({ format = "24h" }: ClockProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time
      dateTime={now.toISOString()}
      style={{
        fontSize: "1.5rem",
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "var(--fg, #111111)",
      }}
    >
      {formatTime(now, format)}
    </time>
  );
}

export function Clicker({ label = "Click me" }: ClickerProps) {
  const [count, setCount] = useState(0);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <button
        type="button"
        onClick={() => setCount((value) => value + 1)}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent, #2563eb)",
          color: "#ffffff",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
      <output
        aria-live="polite"
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg, #111111)",
        }}
      >
        {count}
      </output>
    </div>
  );
}

/** Keyframes for the scrolling row; injected per instance, never as an external file. */
const MARQUEE_KEYFRAMES = `@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}`;

export function Marquee({ text, speed = 6 }: MarqueeProps) {
  const durationSeconds = 30 / speed;
  return (
    <div
      data-marquee=""
      style={{
        overflow: "hidden",
        width: "100%",
        padding: "8px 0",
        border: "1px solid rgba(127, 127, 127, 0.35)",
        borderRadius: 8,
        // Size container for the copies' `min-width: 100cqw` below: each copy
        // fills the container (not its shrink-wrapped text), so the row always
        // spans two full viewports and -50% lands exactly on one unit — no
        // empty right-hand dead zone, no mid-container pop at the loop wrap.
        containerType: "inline-size",
      }}
    >
      <style>{MARQUEE_KEYFRAMES}</style>
      <div
        data-marquee-row=""
        style={{
          display: "inline-flex",
          gap: "2.5rem",
          whiteSpace: "nowrap",
          paddingRight: "2.5rem",
          animation: `marquee-scroll ${durationSeconds}s linear infinite`,
        }}
      >
        <div data-marquee-copy="" style={{ minWidth: "100cqw" }}>
          <span style={{ fontSize: "15px", color: "var(--fg, #111111)" }}>{text}</span>
        </div>
        <div data-marquee-copy="" aria-hidden="true" style={{ minWidth: "100cqw" }}>
          <span style={{ fontSize: "15px", color: "var(--fg, #111111)" }}>{text}</span>
        </div>
      </div>
    </div>
  );
}

/** jsdom returns `null` (or throws) from `getContext`; never let that escape. */
function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

export function CanvasNoise({ opacity = 0.4 }: CanvasNoiseProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas ? get2dContext(canvas) : null;
    if (!canvas || !context) {
      setFallback(true);
      return;
    }
    let frameId = 0;
    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 1200; i += 1) {
        const shade = Math.random() < 0.5 ? 0 : 255;
        context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${Math.random() * opacity})`;
        context.fillRect(
          Math.floor(Math.random() * canvas.width),
          Math.floor(Math.random() * canvas.height),
          1,
          1,
        );
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [opacity]);

  return (
    <div
      data-noise-fallback={fallback ? "true" : "false"}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: 12,
        overflow: "hidden",
        background: "#111111",
      }}
    >
      <canvas
        ref={canvasRef}
        width={320}
        height={180}
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      {fallback ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, rgba(255, 255, 255, 0.22), rgba(127, 127, 127, 0.12) 45%, rgba(255, 255, 255, 0.06))",
          }}
        />
      ) : null}
    </div>
  );
}

export function ProgressBar({ value }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 10,
        width: "100%",
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(127, 127, 127, 0.25)",
      }}
    >
      <div
        data-progress-fill=""
        style={{
          height: "100%",
          width: `${value}%`,
          background: "var(--accent, #2563eb)",
          transition: "width 200ms ease",
        }}
      />
    </div>
  );
}

export function Accordion({ items }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, index) => {
        const open = openIndex === index;
        return (
          <div
            key={`${item.title}-${index}`}
            style={{
              border: "1px solid rgba(127, 127, 127, 0.35)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : index)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                padding: "10px 12px",
                border: "none",
                background: "transparent",
                fontSize: "15px",
                fontWeight: 600,
                textAlign: "left",
                color: "var(--fg, #111111)",
                cursor: "pointer",
              }}
            >
              <span>{item.title}</span>
              <span aria-hidden="true" style={{ color: "var(--accent, #2563eb)" }}>
                {open ? "−" : "+"}
              </span>
            </button>
            {open ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 12px 12px",
                  fontSize: "15px",
                  lineHeight: 1.6,
                  color: "var(--fg, #111111)",
                }}
              >
                {item.body}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
