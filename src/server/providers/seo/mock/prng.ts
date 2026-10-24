/** Small seeded random number tools for the mock provider. Same seed gives the same numbers. */

/** 32-bit hash of a string (cyrb53 folded down). */
export function hashString(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 ^ h1) >>> 0;
}

/** mulberry32: returns a function that gives numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

/** A random generator seeded by any strings. Has helpers for common draws. */
export function makeRng(...parts: (string | number)[]) {
  const next = mulberry32(hashString(parts.join("|")));
  return {
    next,
    /** Integer from min to max, both included. */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** One item of the list. */
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)]!;
    },
    /** True with the given chance (0 to 1). */
    chance(p: number): boolean {
      return next() < p;
    },
    /** Approximately normal number (Box-Muller). */
    normal(mean = 0, sd = 1): number {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/** UTC date as YYYY-MM-DD. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days since 1970-01-01 (UTC). */
export function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}
