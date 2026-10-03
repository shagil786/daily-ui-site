import { describe, expect, it } from "vitest";
import { Cooldown } from "../../lib/cooldown";

describe("Cooldown", () => {
  it("allows the first use of a key and blocks it inside the window", () => {
    const cooldown = new Cooldown(1000);
    expect(cooldown.tryConsume("a", 0)).toBe(true);
    expect(cooldown.tryConsume("a", 500)).toBe(false);
    expect(cooldown.tryConsume("a", 999)).toBe(false);
  });

  it("allows the key again once the window has passed", () => {
    const cooldown = new Cooldown(1000);
    expect(cooldown.tryConsume("a", 0)).toBe(true);
    expect(cooldown.tryConsume("a", 1000)).toBe(true);
  });

  it("keys independently", () => {
    const cooldown = new Cooldown(1000);
    expect(cooldown.tryConsume("a", 0)).toBe(true);
    expect(cooldown.tryConsume("b", 0)).toBe(true);
    expect(cooldown.tryConsume("b", 10)).toBe(false);
  });

  it("does not record a blocked attempt (the window is not extended)", () => {
    const cooldown = new Cooldown(1000);
    cooldown.tryConsume("a", 0);
    cooldown.tryConsume("a", 900);
    expect(cooldown.tryConsume("a", 1000)).toBe(true);
  });

  it("sweeps expired entries so memory stays bounded", () => {
    const cooldown = new Cooldown(1000);
    for (let i = 0; i < 50; i += 1) {
      cooldown.tryConsume(`key-${i}`, 0);
    }
    expect(cooldown.size).toBe(50);

    // Any later use drops every entry whose window has closed.
    cooldown.tryConsume("fresh", 5000);
    expect(cooldown.size).toBe(1);
  });

  it("defaults to the current time", () => {
    const cooldown = new Cooldown(60_000);
    expect(cooldown.tryConsume("a")).toBe(true);
    expect(cooldown.tryConsume("a")).toBe(false);
  });
});