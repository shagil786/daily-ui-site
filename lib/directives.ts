/**
 * Design directives: one curated visual direction per generated day.
 *
 * The list is the source of truth for both the generation prompt and the
 * `directive` column stored with each day; ordering matters because
 * `pickDirective` indexes into it deterministically — append new entries
 * rather than reordering existing ones, or previously generated days will
 * no longer match the directive they were created under.
 */

export type Directive = { id: string; brief: string };

export const DIRECTIVES: ReadonlyArray<Directive> = [
  {
    id: "retro-terminal",
    brief:
      "Monochrome CRT terminal aesthetic: green or amber on near-black, monospace type, " +
      "scanline texture, command-line metaphors and blinking cursors.",
  },
  {
    id: "brutalist",
    brief:
      "Raw brutalist web design: stark black and white, heavy visible borders, oversized " +
      "type, no decoration, structure left exposed.",
  },
  {
    id: "pastel",
    brief:
      "Soft pastel palette with rounded shapes, gentle shadows, airy spacing, and a " +
      "playful, friendly tone.",
  },
  {
    id: "game-like",
    brief:
      "Playful game-inspired UI: scoreboards, pixel or arcade accents, chunky buttons, " +
      "HUD-style framing and progress meters.",
  },
  {
    id: "minimal-portfolio",
    brief:
      "Minimalist portfolio: generous whitespace, restrained typography, a single accent " +
      "color, and the work itself front and center.",
  },
  {
    id: "data-dashboard",
    brief:
      "Analytics dashboard look: dense grids, stat cards, chart-like decoration, with " +
      "labels and numbers brought to the foreground.",
  },
  {
    id: "neon-cyber",
    brief:
      "Neon cyberpunk: dark background, glowing cyan and magenta accents, glitchy display " +
      "type, futuristic framing.",
  },
  {
    id: "organic-zen",
    brief:
      "Organic zen: natural earth tones, soft shapes, calm generous spacing, understated " +
      "nature-inspired harmony.",
  },
];

/**
 * djb2 over the date string, kept unsigned so the index is stable across
 * platforms and runs. Deterministic: the same date always yields the same
 * directive; different dates may occasionally collide, which is acceptable.
 */
function hashDate(date: string): number {
  let hash = 5381;
  for (let i = 0; i < date.length; i++) {
    hash = ((hash << 5) + hash + date.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** The directive for `date` (a YYYY-MM-DD string): deterministic, never throws. */
export function pickDirective(date: string): Directive {
  return DIRECTIVES[hashDate(date) % DIRECTIVES.length];
}
