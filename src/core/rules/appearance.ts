/** Pure rules from data to appearance. Section 2 of the design doc is the spec; tests pin these numbers. */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface RoomLight {
  /** 0.15 (dormant) to 1.0 (active). */
  intensity: number;
  /** 4500 K (dormant, cool grey) to 2700 K (active, warm). */
  kelvin: number;
}

/**
 * Activity above ~0.75 already counts as fully lit: a project edited today but not yet opened 20 times tops out at 0.6,
 * and it should still read as bright.
 */
export function roomLight(activity: number): RoomLight {
  const t = clamp01(activity / 0.75);
  return { intensity: 0.15 + 0.85 * t, kelvin: 4500 - 1800 * t };
}

/** Kelvin to linear-ish RGB in 0..1 (Tanner Helland approximation). */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => clamp01(v / 255);
  return [c(r), c(g), c(b)];
}

/** Dust: nothing for a month, then builds linearly to full at six months idle. */
export function dustLevel(idleDays: number): number {
  return clamp01((idleDays - 30) / 150);
}

export const COBWEB_DAYS = 90;
export const NEGLECTED_DAYS = 60;

export const hasCobwebs = (idleDays: number) => idleDays >= COBWEB_DAYS;
export const isNeglected = (idleDays: number) => idleDays >= NEGLECTED_DAYS;

/** Recently modified items glow: full at the moment of change, fading to nothing over 24 hours. */
export function glowLevel(hoursSinceMod: number): number {
  if (hoursSinceMod >= 24) return 0;
  return smooth(1 - Math.max(0, hoursSinceMod) / 24);
}

/** Material roughness added by wear (doc: +0.0 to +0.4) and dust overlay alpha (0 to 0.6). */
export function wear(idleDays: number) {
  const d = dustLevel(idleDays);
  return { roughness: 0.4 * d, dustAlpha: 0.6 * d };
}
