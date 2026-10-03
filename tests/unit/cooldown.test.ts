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

  it("reports the milliseconds left in a key's window", () => {
    const cooldown = new Cooldown(1000);
    expect(cooldown.remainingMs("a", 0)).toBe(0); // never consumed
    cooldown.tryConsume("a", 0);
    expect(cooldown.remainingMs("a", 0)).toBe(1000);
    expect(cooldown.remainingMs("a", 400)).toBe(600);
    expect(cooldown.remainingMs("a", 1000)).toBe(0);
  });

  it("remainingMs does not sweep: reading another key's window keeps every entry", () => {
    const cooldown = new Cooldown(1000);
    for (let i = 0; i < 50; i += 1) {
      cooldown.tryConsume(`key-${i}`, 0);
    }

    expect(cooldown.remainingMs("key-0", 5000)).toBe(0);
    expect(cooldown.size).toBe(50);
  });

  it("release frees a key so it can be consumed again immediately", () => {
    const cooldown = new Cooldown(1000);
    cooldown.tryConsume("a", 0);
    expect(cooldown.tryConsume("a", 10)).toBe(false);

    cooldown.release("a");

    expect(cooldown.tryConsume("a", 10)).toBe(true);
    expect(cooldown.size).toBe(1);
  });

  it("releasing an unknown key is a no-op", () => {
    const cooldown = new Cooldown(1000);
    cooldown.tryConsume("a", 0);

    cooldown.release("never-seen");

    expect(cooldown.size).toBe(1);
    expect(cooldown.remainingMs("never-seen", 0)).toBe(0);
    expect(cooldown.remainingMs("a", 0)).toBe(1000); // untouched
  });

  it("release leaves other keys' windows intact", () => {
    const cooldown = new Cooldown(1000);
    cooldown.tryConsume("a", 0);
    cooldown.tryConsume("b", 0);

    cooldown.release("a");

    expect(cooldown.remainingMs("a", 0)).toBe(0);
    expect(cooldown.remainingMs("b", 0)).toBe(1000);
    expect(cooldown.tryConsume("b", 10)).toBe(false);
  });
});
