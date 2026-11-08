/** Bounded admission with a second chance for the oldest recently used entry. */
export class MessageCache<T, K = string> {
  private readonly values = new Map<K, { value: T; recent: boolean }>();
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Message cache limit must be a positive safe integer.');
  }

  get size() { return this.values.size; }

  get(key: K, create: () => T): T {
    const cached = this.values.get(key);
    if (cached !== undefined) {
      cached.recent = true;
      this.values.delete(key); this.values.set(key, cached);
      return cached.value;
    }
    // Construct before changing admission state: a formatting error leaves the cache intact.
    const value = create();
    if (this.values.size === this.limit) {
      const [oldest, entry] = this.values.entries().next().value!;
      if (entry.recent) {
        entry.recent = false;
        return value; // Bypass this insertion instead of evicting the next cyclic lookup.
      }
      this.values.delete(oldest);
    }
    this.values.set(key, { value, recent: true });
    return value;
  }
}
