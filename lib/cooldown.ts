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

  /**
   * Milliseconds left before `key` may be consumed again; 0 when it may.
   *
   * Reads the map WITHOUT sweeping: this is a read, and a read that evicted
   * entries would make "how much is left?" a mutating operation with side
   * effects on other keys' state.
   */
  remainingMs(key: string, now: number = Date.now()): number {
    const last = this.lastUsedByKey.get(key);
    if (last === undefined) {
      return 0;
    }
    return Math.max(0, this.windowMs - (now - last));
  }

  /**
   * Forget `key` entirely, so it may be consumed again right away.
   *
   * For undoing a consume that was made pointless by a later check — the
   * preview route consumes a client's cooldown and can then refuse the same
   * request at the daily cap, and without this the caller would carry a
   * cooldown slot for a generation that never happened. Releasing an unknown
   * key is a no-op, and no other key is affected.
   */
  release(key: string): void {
    this.lastUsedByKey.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, at] of this.lastUsedByKey) {
      if (now - at >= this.windowMs) {
        this.lastUsedByKey.delete(key);
      }
    }
  }
}
