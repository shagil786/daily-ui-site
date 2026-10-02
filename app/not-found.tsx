import Link from "next/link";

/**
 * Global 404. Also renders for `/archive/[date]` when the row is missing or
 * corrupt (`notFound()` in that page), hence the empty-state wording.
 */
export default function NotFound() {
  return (
    <main className="empty-state" data-testid="not-found">
      <p>Nothing generated yet</p>
      <Link href="/">Back to today</Link>
    </main>
  );
}
