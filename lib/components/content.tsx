import {
  beforeAfterPropsSchema,
  cardPropsSchema,
  heroPropsSchema,
  imageGalleryPropsSchema,
  linkListPropsSchema,
  terminalSimPropsSchema,
  textPropsSchema,
} from "../component-props";
import type {
  BeforeAfterProps,
  CardProps,
  HeroProps,
  ImageGalleryProps,
  LinkListProps,
  TerminalSimProps,
  TextProps,
} from "../component-props";
import { z } from "zod";

/**
 * Content components: text, media, links, terminal output. Plain CSS via
 * inline styles only; colors reference the theme CSS variables (`--fg`,
 * `--accent`) with fallbacks so components render before the theme lands.
 * Server-safe: no hooks, no "use client".
 */

/**
 * Hostnames allowed in image URLs, matched as an exact hostname or a
 * dot-delimited suffix (`example.com` allows `images.example.com`, not
 * `notexample.com`). Kept deliberately small; extend deliberately.
 */
export function Hero({ heading, sub }: HeroProps) {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h1
        style={{
          margin: 0,
          fontSize: "2.75rem",
          lineHeight: 1.15,
          fontWeight: 800,
          color: "var(--fg, #111111)",
        }}
      >
        {heading}
      </h1>
      {sub === undefined ? null : (
        <p
          style={{
            margin: 0,
            fontSize: "1.125rem",
            lineHeight: 1.5,
            color: "var(--fg, #111111)",
            opacity: 0.8,
          }}
        >
          {sub}
        </p>
      )}
    </header>
  );
}

const TEXT_SIZES = { sm: "14px", md: "16px", lg: "20px" } as const;

export function Text({ text, size = "md" }: TextProps) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: TEXT_SIZES[size],
        lineHeight: 1.6,
        color: "var(--fg, #111111)",
      }}
    >
      {text}
    </p>
  );
}

export function Card({ title, body }: CardProps) {
  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(127, 127, 127, 0.35)",
      }}
    >
      {/* Level 3: a Card usually nests inside a Section (h2), so h3 keeps the
          outline in order. */}
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
      <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.6, color: "var(--fg, #111111)" }}>
        {body}
      </p>
    </article>
  );
}

export function ImageGallery({ images }: ImageGalleryProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 16,
      }}
    >
      {images.map((image, index) => (
        <img
          key={`${image.url}-${index}`}
          src={image.url}
          alt={image.alt ?? ""}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            borderRadius: 8,
            objectFit: "cover",
          }}
        />
      ))}
    </div>
  );
}

export function LinkList({ links }: LinkListProps) {
  return (
    <ul
      role="list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {links.map((link, index) => (
        <li key={`${link.href}-${index}`}>
          <a
            href={link.href}
            // Same-tab navigation: `noopener` is inert without a target, but
            // `noreferrer` still keeps generated (untrusted) links from
            // leaking the visitor's referrer.
            rel="noreferrer"
            style={{ color: "var(--accent, #2563eb)", fontSize: "15px" }}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function BeforeAfter({ before, after, caption }: BeforeAfterProps) {
  const imageStyle = {
    display: "block",
    width: "100%",
    height: "auto",
    borderRadius: 8,
    objectFit: "cover",
  } as const;
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <img src={before} alt="Before" style={imageStyle} />
        <img src={after} alt="After" style={imageStyle} />
      </div>
      {caption === undefined ? null : (
        <figcaption style={{ fontSize: "13px", color: "var(--fg, #111111)", opacity: 0.75 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function TerminalSim({ lines }: TerminalSimProps) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 16,
        borderRadius: 8,
        overflowX: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "13px",
        lineHeight: 1.5,
        color: "#e6e6e6",
        background: "#111111",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}
