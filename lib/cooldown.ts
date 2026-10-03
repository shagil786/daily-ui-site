/**
 * In-memory fixed-window cooldown, one entry per key.
 *
 * Used for both generation attempt windows (on-demand POST and the spec §6
 * render-time attempt) so neither can be used to hammer the LLM. Per-process
 * by design: single-process self-hosting is the deployment target.
 *
 * Expired entries are swept whenever a key is consumed, so the map stays
 * proportional to the keys used inside one window instead of growing for the
 * lifetime of the process.
 */
export class Cooldown {
  private readonly lastUsedByKey = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /** True when the key was outside its window (the attempt is allowed). */
  tryConsume(key: string, now: number = Date.now()): boolean {
    this.sweep(now);
    const last = this.lastUsedByKey.get(key);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    this.lastUsedByKey.set(key, now);
    return true;
  }

  /** Entries currently held — exposed for tests and diagnostics. */
  get size(): number {
    return this.lastUsedByKey.size;
  }

  private sweep(now: number): void {
    for (const [key, at] of this.lastUsedByKey) {
      if (now - at >= this.windowMs) {
        this.lastUsedByKey.delete(key);
      }
    }
  }
}
