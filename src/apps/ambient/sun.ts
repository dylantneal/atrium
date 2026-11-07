/** Sun position and sky colours. Pure maths, no clock and no DOM, so it is easy to test against known values. */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface SunPosition {
  /** Radians above the horizon (negative below). */
  altitude: number;
  /** Radians clockwise from north (0 = north, PI/2 = east). */
  azimuth: number;
}

/** Low-precision solar position (good to about a degree). `ms` is a UTC timestamp. */
export function sunPosition(ms: number, latDeg: number, lonDeg: number): SunPosition {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const g = rad(357.529 + 0.98560028 * d); // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)); // ecliptic longitude
  const e = rad(23.439 - 0.00000036 * d); // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  const lst = rad((((gmstHours * 15 + lonDeg) % 360) + 360) % 360);
  const H = lst - ra; // hour angle
  const lat = rad(latDeg);
  const altitude = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  // azimuth measured from the south, then shifted to run clockwise from north
  const azFromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  const azimuth = (azFromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI);
  return { altitude, azimuth };
}

/** 0 at night, 1 in full day, easing through twilight (-6 to +8 degrees). */
export function daylightFactor(altitude: number): number {
  return smooth(clamp01((deg(altitude) + 6) / 14));
}

export type Rgb = [number, number, number];

const hexToRgb = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const rgbToHex = (c: Rgb) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Stop {
  alt: number; // degrees
  zenith: number;
  horizon: number;
}

const STOPS: Stop[] = [
  { alt: -18, zenith: 0x04060d, horizon: 0x080d1c },
  { alt: -6, zenith: 0x141c3a, horizon: 0x3a3558 },
  { alt: 0, zenith: 0x2b3a67, horizon: 0xf2874a },
  { alt: 8, zenith: 0x3b6cc0, horizon: 0xf5c690 },
  { alt: 25, zenith: 0x3d7fd6, horizon: 0xbfe0ff },
  { alt: 90, zenith: 0x2f6fd0, horizon: 0xcde8ff },
];

const OVERCAST: Rgb = [150, 158, 170];

export interface SkyPalette {
  zenith: number;
  horizon: number;
  /** 0..1 star visibility. */
  stars: number;
  /** Colour of the sun disc and its glow. */
  sun: number;
}

/** Sky gradient colours for a sun altitude and a cloud cover (0..1). */
export function skyPalette(altitude: number, cloud: number): SkyPalette {
  const a = deg(altitude);
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (a >= STOPS[i].alt && a <= STOPS[i + 1].alt) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const t = a <= STOPS[0].alt ? 0 : a >= STOPS[STOPS.length - 1].alt ? 1 : (a - lo.alt) / (hi.alt - lo.alt);
  const grey = clamp01(cloud) * 0.75 * (0.25 + 0.75 * daylightFactor(altitude)); // clouds grey the sky less at night
  const zenith = mix(mix(hexToRgb(lo.zenith), hexToRgb(hi.zenith), t), mix(hexToRgb(lo.zenith), OVERCAST, 0.9), grey * 0.6 + 0);
  const horizon = mix(mix(hexToRgb(lo.horizon), hexToRgb(hi.horizon), t), OVERCAST, grey);
  const low = clamp01((a + 4) / 10); // sun reddens near the horizon
  const sun: Rgb = mix([255, 120, 60], [255, 244, 214], low);
  return { zenith: rgbToHex(zenith), horizon: rgbToHex(horizon), stars: clamp01(1 - daylightFactor(altitude) * 1.4) * (1 - clamp01(cloud) * 0.8), sun: rgbToHex(sun) };
}

/** Direction a wall's outward normal faces, as an azimuth in radians (north wall faces north). */
export const WALL_AZIMUTH: Record<'N' | 'E' | 'S' | 'W', number> = { N: 0, E: Math.PI / 2, S: Math.PI, W: (3 * Math.PI) / 2 };

/**
 * Where the sun (or moon) appears in a window looking along `facing`: x and y in 0..1 window space, or null when it is outside
 * the window's field of view (about 80 degrees wide, from -8 to +62 degrees up).
 */
export function sunInWindow(sun: SunPosition, facing: number): { x: number; y: number } | null {
  let da = sun.azimuth - facing;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const fovH = rad(80);
  const x = 0.5 + da / fovH;
  const y = (deg(sun.altitude) + 8) / 70;
  if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
  return { x, y };
}

export type SunEvent = 'sunrise' | 'sunset' | 'noon' | 'midnight';

const HORIZON = rad(-0.833); // the sun's upper edge touches the horizon

/**
 * The next time (after `from`) of a sun event at a place. Scans in 5-minute steps for a crossing or extreme, then refines.
 * Used by the demo commands that jump the clock to "sunset" and by tests.
 */
export function nextSunEvent(from: number, latDeg: number, lonDeg: number, event: SunEvent): number {
  const step = 5 * 60_000;
  const alt = (t: number) => sunPosition(t, latDeg, lonDeg).altitude;
  const horizon = event === 'sunrise' || event === 'sunset';
  if (horizon) {
    const rising = event === 'sunrise';
    let prev = alt(from) - HORIZON;
    for (let t = from + step; t < from + 50 * 3600_000; t += step) {
      const cur = alt(t) - HORIZON;
      if (rising ? prev < 0 && cur >= 0 : prev > 0 && cur <= 0) {
        let lo = t - step;
        let hi = t;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          const v = alt(mid) - HORIZON;
          if (rising ? v < 0 : v > 0) lo = mid;
          else hi = mid;
        }
        return Math.round((lo + hi) / 2);
      }
      prev = cur;
    }
    return from; // polar day or night: no crossing
  }
  // noon is the altitude maximum, midnight the minimum: find where the slope changes sign
  const sign = event === 'noon' ? 1 : -1;
  let prevSlope = sign * (alt(from + step) - alt(from));
  for (let t = from + step; t < from + 50 * 3600_000; t += step) {
    const slope = sign * (alt(t + step) - alt(t));
    if (prevSlope > 0 && slope <= 0) {
      let lo = t - step;
      let hi = t + step;
      for (let i = 0; i < 40; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (sign * alt(m1) < sign * alt(m2)) lo = m1;
        else hi = m2;
      }
      return Math.round((lo + hi) / 2);
    }
    prevSlope = slope;
  }
  return from;
}
