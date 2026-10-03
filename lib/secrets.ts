import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Credential comparison for server-held secrets (e.g. `GENERATE_SECRET`).
 *
 * `===` leaks the matching prefix length through timing; hashing both sides
 * first makes the comparison constant-time over fixed-width digests, so a
 * caller cannot learn the secret byte by byte. The digest also sidesteps the
 * length mismatch that makes `timingSafeEqual` throw.
 *
 * Fails closed: an unset or empty expected secret never authorizes.
 */
export function secretMatches(provided: string | undefined | null, expected: string | undefined | null): boolean {
  if (expected === undefined || expected === null || expected.length === 0) {
    return false;
  }
  if (provided === undefined || provided === null) {
    return false;
  }
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
