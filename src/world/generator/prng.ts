import { hash32 } from '../../util/hash';

export { hash32 };

/** mulberry32: tiny, fast, deterministic. Returns floats in [0, 1). */
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

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  range(min: number, max: number): number;
}

export function makeRng(seed: number): Rng {
  const f = mulberry32(seed);
  return {
    next: f,
    int: (min, max) => min + Math.floor(f() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    chance: (p) => f() < p,
    range: (min, max) => min + f() * (max - min),
  };
}
