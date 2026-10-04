import type { ReactNode } from "react";
import { z } from "zod";

/**
 * Every component's props schema, in ONE server-safe module.
 *
 * This file must never import a component and must never carry `"use client"`.
 * `lib/generate.ts` builds the generation prompt from `inventoryForPrompt()`,
 * which reads these schemas' `.describe()` text. A schema that lives inside a
 * `"use client"` module reaches the server as an unusable client reference, and
 * the model is then told "no documented props" — silently, with every test still
 * green. Keeping the schemas here makes that failure mode impossible rather than
 * something to remember.
 *
 * The components themselves stay where they are and import their schema from
 * here, so there is exactly one definition per props shape.
 */

/* ── Layout components ─────────────────────────────────────────── */

export type CenterProps = z.infer<typeof centerPropsSchema> & { children?: ReactNode };

export type GridProps = z.infer<typeof gridPropsSchema> & { children?: ReactNode };

export type SectionProps = z.infer<typeof sectionPropsSchema> & { children?: ReactNode };

export type SplitPaneProps = { children?: ReactNode };

export type StackProps = z.infer<typeof stackPropsSchema> & { children?: ReactNode };

export type TabsProps = z.infer<typeof tabsPropsSchema> & { children?: ReactNode };

export type TimelineProps = z.infer<typeof timelinePropsSchema>;

export const centerPropsSchema = z
  .object({
    maxWidth: z.number().optional(),
  })
  .describe("Centers children horizontally and vertically. Props: maxWidth?: number (px).");

export const gridPropsSchema = z
  .object({
    columns: z.number().int().min(1).max(12).optional(),
  })
  .describe("CSS grid of children. Props: columns?: number (integer 1-12).");

export const sectionPropsSchema = z
  .object({
    heading: z.string().optional(),
  })
  .describe("Section with an optional heading above its children. Props: heading?: string.");

export const splitPanePropsSchema = z.object({}).describe(
  "Two children rendered side by side. Props: none.",
);

export const stackPropsSchema = z
  .object({
    gap: z.number().optional(),
  })
  .describe("Vertical stack of children. Props: gap?: number (px spacing).");

export const tabsPropsSchema = z
  .object({
    tabs: z.array(z.object({ label: z.string() })),
  })
  .describe(
    "Tabbed panels. Props: tabs: { label: string }[]. Supply EXACTLY ONE child per tab, in the same order — child 1 fills the first tab, child 2 the second, and so on. Each tab shows only its own child, so a three-tab UI needs three children.",
  );

export const timelinePropsSchema = z
  .object({
    events: z.array(z.object({ date: z.string(), text: z.string() })),
  })
  .describe("Vertical timeline of dated events. Props: events: { date: string; text: string }[].");

/** https-only URL of any host (links navigate; they are not embedded media). */
const httpsHref = z
  .string()
  .url("must be a valid URL")
  .refine((url) => parseUrl(url)?.protocol === "https:", "href must use https:");

/* ── Content components ───────────────────────────────────────── */

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


export type BeforeAfterProps = z.infer<typeof beforeAfterPropsSchema>;

export type CardProps = z.infer<typeof cardPropsSchema>;

export type HeroProps = z.infer<typeof heroPropsSchema>;

export type ImageGalleryProps = z.infer<typeof imageGalleryPropsSchema>;

export type LinkListProps = z.infer<typeof linkListPropsSchema>;

export type TerminalSimProps = z.infer<typeof terminalSimPropsSchema>;

export type TextProps = z.infer<typeof textPropsSchema>;

export const beforeAfterPropsSchema = z
  .object({
    before: imageHttpsUrl,
    after: imageHttpsUrl,
    caption: z.string().optional(),
  })
  .describe(
    "Side-by-side before/after images from allowlisted https hosts. Props: before: string; after: string; caption?: string.",
  );

export const cardPropsSchema = z
  .object({
    title: z.string(),
    body: z.string(),
  })
  .describe("Card with a title above body copy. Props: title: string; body: string.");

export const heroPropsSchema = z
  .object({
    heading: z.string(),
    sub: z.string().optional(),
  })
  .describe("Page hero. Props: heading: string; sub?: string.");

export const imageGalleryPropsSchema = z
  .object({
    images: z.array(z.object({ url: imageHttpsUrl, alt: z.string().optional() })),
  })
  .describe(
    "Grid of images from allowlisted https hosts. Props: images: { url: string; alt?: string }[].",
  );

export const linkListPropsSchema = z
  .object({
    links: z.array(z.object({ label: z.string(), href: httpsHref })),
  })
  .describe("List of https links. Props: links: { label: string; href: string }[].");

export const terminalSimPropsSchema = z
  .object({
    lines: z.array(z.string()),
  })
  .describe("Terminal output rendered inside a <pre>. Props: lines: string[].");

export const textPropsSchema = z
  .object({
    text: z.string(),
    size: z.enum(["sm", "md", "lg"]).optional(),
  })
  .describe('Paragraph of text. Props: text: string; size?: "sm" | "md" | "lg".');

/* ── Interactive components ────────────────────────────────────── */

export type AccordionProps = z.infer<typeof accordionPropsSchema>;

export type CanvasNoiseProps = z.infer<typeof canvasNoisePropsSchema>;

export type ClickerProps = z.infer<typeof clickerPropsSchema>;

export type ClockProps = z.infer<typeof clockPropsSchema>;

export type CounterProps = z.infer<typeof counterPropsSchema>;

export type MarqueeProps = z.infer<typeof marqueePropsSchema>;

export type PollProps = z.infer<typeof pollPropsSchema>;

export type ProgressBarProps = z.infer<typeof progressBarPropsSchema>;

export type TodoProps = z.infer<typeof todoPropsSchema>;

export const accordionPropsSchema = z
  .object({
    items: z.array(z.object({ title: z.string(), body: z.string() })),
  })
  .describe("Accordion where clicking a header reveals its body. Props: items: { title: string; body: string }[].");

export const canvasNoisePropsSchema = z
  .object({
    opacity: z.number().min(0).max(1).optional(),
  })
  .describe("Animated canvas noise panel; falls back to a static gradient without a 2d context. Props: opacity?: number (0-1).");

export const clickerPropsSchema = z
  .object({
    label: z.string().optional(),
  })
  .describe("Button that counts how many times it was clicked. Props: label?: string.");

export const clockPropsSchema = z
  .object({
    format: z.enum(["12h", "24h"]).optional(),
  })
  .describe('Live clock updated every second. Props: format?: "12h" | "24h" (default "24h").');

export const counterPropsSchema = z
  .object({
    start: z.number().optional(),
    label: z.string().optional(),
  })
  .describe("Numeric counter with an increment button. Props: start?: number; label?: string.");

export const marqueePropsSchema = z
  .object({
    text: z.string(),
    speed: z.number().min(1).max(20).optional(),
  })
  .describe("Scrolling marquee that duplicates its text. Props: text: string; speed?: number (1-20).");

export const pollPropsSchema = z
  .object({
    question: z.string().optional(),
    options: z.array(z.string()),
  })
  .describe("Single-choice poll; the picked option is marked. Props: question?: string; options: string[].");

export const progressBarPropsSchema = z
  .object({
    value: z.number().min(0).max(100),
  })
  .describe("Progress bar filled to a percentage. Props: value: number (0-100).");

export const todoPropsSchema = z
  .object({
    title: z.string().optional(),
  })
  .describe("Todo list: type into the input and press Enter to append. Props: title?: string.");
