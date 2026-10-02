import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Site-wide fallback metadata. Individual pages override `title` (and add a
 * row-date description) via their own `metadata` / `generateMetadata` exports —
 * the document title comes from `doc.title`, never from `doc.date`.
 *
 * No `next/font/google`: the theme ruling is zero external font fetches, so
 * fonts are CSS fallback stacks declared in globals.css (`.font-serif` etc.).
 */
export const metadata: Metadata = {
  title: "Daily UI Site",
  description: "A new randomly generated UI, every day.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
