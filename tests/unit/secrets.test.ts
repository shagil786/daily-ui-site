import { describe, expect, it } from "vitest";
import { secretMatches } from "../../lib/secrets";

describe("secretMatches", () => {
  it("accepts an exact match", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(secretMatches("s3cret", "s3crev")).toBe(false);
    expect(secretMatches("s3cret", "s3cret-longer")).toBe(false);
    expect(secretMatches("s3cret ", "s3cret")).toBe(false);
  });

  it("rejects an unset or empty expected secret (fails closed)", () => {
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(secretMatches("anything", "")).toBe(false);
  });

  it("rejects a missing provided header", () => {
    expect(secretMatches(undefined, "s3cret")).toBe(false);
    expect(secretMatches("", "s3cret")).toBe(false);
  });

  it("handles multi-byte secrets without throwing", () => {
    expect(secretMatches("kéy", "kéy")).toBe(true);
    expect(secretMatches("kéy", "key")).toBe(false);
  });
});
