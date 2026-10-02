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
export const ALLOWED_IMAGE_HOSTS = [
  "example.com",
  "images.unsplash.com",
  "upload.wikimedia.org",
  "picsum.photos",
] as const;

function isAllowedImageHost(hostname: string): boolean {
  return ALLOWED_IMAGE_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

/**
 * `new URL` returns `undefined` instead of throwing: Zod runs `.refine()`
 * callbacks even when an earlier `.url()` check already failed, so the input
 * may be unparseable (e.g. `/relative`).
 */
function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** https-only URL whose hostname is on the `ALLOWED_IMAGE_HOSTS` allowlist. */
const imageHttpsUrl = z
  .string()
  .url("must be a valid URL")
  .refine((url) => parseUrl(url)?.protocol === "https:", "image URL must use https:")
  .refine(
    (url) => {
      const parsed = parseUrl(url);
      return parsed !== undefined && isAllowedImageHost(parsed.hostname);
    },
    `image host must be one of: ${ALLOWED_IMAGE_HOSTS.join(", ")}`,
  );

/** https-only URL of any host (links navigate; they are not embedded media). */
const httpsHref = z
  .string()
  .url("must be a valid URL")
  .refine((url) => parseUrl(url)?.protocol === "https:", "href must use https:");

export const heroPropsSchema = z
  .object({
    heading: z.string(),
    sub: z.string().optional(),
  })
  .describe("Page hero. Props: heading: string; sub?: string.");

export type HeroProps = z.infer<typeof heroPropsSchema>;

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

export const textPropsSchema = z
  .object({
    text: z.string(),
    size: z.enum(["sm", "md", "lg"]).optional(),
  })
  .describe('Paragraph of text. Props: text: string; size?: "sm" | "md" | "lg".');

export type TextProps = z.infer<typeof textPropsSchema>;

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

export const cardPropsSchema = z
  .object({
    title: z.string(),
    body: z.string(),
  })
  .describe("Card with a title above body copy. Props: title: string; body: string.");

export type CardProps = z.infer<typeof cardPropsSchema>;

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

export const imageGalleryPropsSchema = z
  .object({
    images: z.array(z.object({ url: imageHttpsUrl, alt: z.string().optional() })),
  })
  .describe(
    "Grid of images from allowlisted https hosts. Props: images: { url: string; alt?: string }[].",
  );

export type ImageGalleryProps = z.infer<typeof imageGalleryPropsSchema>;

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

export const linkListPropsSchema = z
  .object({
    links: z.array(z.object({ label: z.string(), href: httpsHref })),
  })
  .describe("List of https links. Props: links: { label: string; href: string }[].");

export type LinkListProps = z.infer<typeof linkListPropsSchema>;

export function LinkList({ links }: LinkListProps) {
  return (
    <ul
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
            rel="noopener noreferrer"
            style={{ color: "var(--accent, #2563eb)", fontSize: "15px" }}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export const beforeAfterPropsSchema = z
  .object({
    before: imageHttpsUrl,
    after: imageHttpsUrl,
    caption: z.string().optional(),
  })
  .describe(
    "Side-by-side before/after images from allowlisted https hosts. Props: before: string; after: string; caption?: string.",
  );

export type BeforeAfterProps = z.infer<typeof beforeAfterPropsSchema>;

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

export const terminalSimPropsSchema = z
  .object({
    lines: z.array(z.string()),
  })
  .describe("Terminal output rendered inside a <pre>. Props: lines: string[].");

export type TerminalSimProps = z.infer<typeof terminalSimPropsSchema>;

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
