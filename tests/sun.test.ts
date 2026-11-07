import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { daylightFactor, skyPalette, sunInWindow, sunPosition, WALL_AZIMUTH } from '../src/apps/ambient/sun';

const deg = (r: number) => (r * 180) / Math.PI;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const NYC = { lat: 40.71, lon: -74.0 };

describe('sunPosition against known real values', () => {
  it('is nearly overhead at the equator on the equinox', () => {
    expect(deg(sunPosition(utc(2026, 3, 20, 12), 0, 0).altitude)).toBeGreaterThan(84);
  });
  it('reaches 90 - lat + 23.44 degrees at the June solstice solar noon (New York)', () => {
    // solar noon in New York is about 16:56 UTC at the June solstice
    expect(deg(sunPosition(utc(2026, 6, 21, 16, 56), NYC.lat, NYC.lon).altitude)).toBeCloseTo(72.7, 0);
  });
  it('reaches 90 - lat - 23.44 degrees at the December solstice solar noon', () => {
    expect(deg(sunPosition(utc(2026, 12, 21, 16, 55), NYC.lat, NYC.lon).altitude)).toBeCloseTo(25.9, 0);
  });
  it('is below the horizon at local midnight', () => {
    expect(sunPosition(utc(2026, 6, 21, 4, 0), NYC.lat, NYC.lon).altitude).toBeLessThan(0);
    expect(sunPosition(utc(2026, 12, 21, 5, 0), NYC.lat, NYC.lon).altitude).toBeLessThan(0);
  });
  it('rises in the east and sets in the west', () => {
    const morning = deg(sunPosition(utc(2026, 3, 20, 11, 0), NYC.lat, NYC.lon).azimuth); // 7am EDT
    const evening = deg(sunPosition(utc(2026, 3, 20, 23, 0), NYC.lat, NYC.lon).azimuth); // 7pm EDT
    expect(morning).toBeGreaterThan(60);
    expect(morning).toBeLessThan(110);
    expect(evening).toBeGreaterThan(250);
    expect(evening).toBeLessThan(300);
  });
  it('is due south at solar noon in the northern hemisphere', () => {
    const az = deg(sunPosition(utc(2026, 3, 20, 16, 56), NYC.lat, NYC.lon).azimuth);
    expect(Math.abs(az - 180)).toBeLessThan(8);
  });
  it('property: altitude stays within [-90, 90] and azimuth within [0, 360) for any time and place', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), fc.double({ min: -89, max: 89, noNaN: true }), fc.double({ min: -180, max: 180, noNaN: true }), (ms, lat, lon) => {
        const s = sunPosition(ms, lat, lon);
        expect(deg(s.altitude)).toBeGreaterThanOrEqual(-90);
        expect(deg(s.altitude)).toBeLessThanOrEqual(90);
        expect(s.azimuth).toBeGreaterThanOrEqual(0);
        expect(s.azimuth).toBeLessThan(2 * Math.PI);
      }),
    );
  });
});

describe('daylight and sky colour', () => {
  it('daylight eases from 0 at night to 1 at midday', () => {
    expect(daylightFactor(-0.5)).toBe(0);
    expect(daylightFactor(Math.PI / 4)).toBe(1);
    const a = daylightFactor((-3 * Math.PI) / 180);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.5);
    fc.assert(
      fc.property(fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -1.5, max: 1.5, noNaN: true }), (x, y) => {
        const [lo, hi] = x < y ? [x, y] : [y, x];
        expect(daylightFactor(hi)).toBeGreaterThanOrEqual(daylightFactor(lo));
      }),
    );
  });
  const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
  it('the horizon gets brighter as the sun climbs, and stars only show at night', () => {
    const night = skyPalette(-0.4, 0);
    const dawn = skyPalette(0, 0);
    const noon = skyPalette(1.0, 0);
    expect(lum(night.horizon)).toBeLessThan(lum(dawn.horizon));
    expect(lum(dawn.horizon)).toBeLessThan(lum(noon.horizon) + 60);
    expect(lum(noon.zenith)).toBeGreaterThan(lum(night.zenith));
    expect(night.stars).toBeGreaterThan(0.9);
    expect(noon.stars).toBe(0);
  });
  it('dawn is warm (red above blue at the horizon); midday is cool', () => {
    const dawn = skyPalette(0, 0).horizon;
    const noon = skyPalette(1.0, 0).horizon;
    expect((dawn >> 16) & 255).toBeGreaterThan(dawn & 255);
    expect(noon & 255).toBeGreaterThan((noon >> 16) & 255);
  });
  it('cloud cover greys the day sky towards neutral', () => {
    const clear = skyPalette(1.0, 0).horizon;
    const overcast = skyPalette(1.0, 1).horizon;
    const sat = (c: number) => Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) - Math.min((c >> 16) & 255, (c >> 8) & 255, c & 255);
    expect(sat(overcast)).toBeLessThan(sat(clear));
  });
});

describe('sunInWindow', () => {
  it('places the sun in a south-facing window at noon and not in a north-facing one', () => {
    const noon = { altitude: Math.PI / 5, azimuth: Math.PI };
    const s = sunInWindow(noon, WALL_AZIMUTH.S);
    expect(s).not.toBeNull();
    expect(s!.x).toBeCloseTo(0.5, 2);
    expect(sunInWindow(noon, WALL_AZIMUTH.N)).toBeNull();
  });
  it('moves right as the sun moves clockwise, and lower as it sinks', () => {
    const a = sunInWindow({ altitude: 0.5, azimuth: Math.PI - 0.3 }, Math.PI)!;
    const b = sunInWindow({ altitude: 0.5, azimuth: Math.PI + 0.3 }, Math.PI)!;
    expect(b.x).toBeGreaterThan(a.x);
    const hi = sunInWindow({ altitude: 0.8, azimuth: Math.PI }, Math.PI)!;
    const lo = sunInWindow({ altitude: 0.1, azimuth: Math.PI }, Math.PI)!;
    expect(lo.y).toBeLessThan(hi.y);
  });
});

import { nextSunEvent } from '../src/apps/ambient/sun';

describe('nextSunEvent', () => {
  const from = Date.UTC(2026, 5, 21, 5, 0); // June solstice, 1 am in New York: the next sunrise, noon and sunset follow in order
  const min = (a: number, b: number) => Math.abs(a - b) / 60_000;
  it('finds New York sunrise, solar noon and sunset within minutes of the published times', () => {
    // June 21 2026, New York: sunrise about 5:25 EDT (09:25 UTC), sunset about 20:31 EDT (00:31 UTC next day)
    expect(min(nextSunEvent(from, NYC.lat, NYC.lon, 'sunrise'), Date.UTC(2026, 5, 21, 9, 25))).toBeLessThan(12);
    expect(min(nextSunEvent(from, NYC.lat, NYC.lon, 'sunset'), Date.UTC(2026, 5, 22, 0, 31))).toBeLessThan(12);
    expect(min(nextSunEvent(from, NYC.lat, NYC.lon, 'noon'), Date.UTC(2026, 5, 21, 16, 57))).toBeLessThan(10);
  });
  it('the events are ordered and the sun really is at the stated altitude there', () => {
    const rise = nextSunEvent(from, NYC.lat, NYC.lon, 'sunrise');
    const noon = nextSunEvent(from, NYC.lat, NYC.lon, 'noon');
    const set = nextSunEvent(from, NYC.lat, NYC.lon, 'sunset');
    expect(rise).toBeLessThan(noon);
    expect(noon).toBeLessThan(set);
    expect(deg(sunPosition(rise, NYC.lat, NYC.lon).altitude)).toBeCloseTo(-0.83, 0);
    expect(deg(sunPosition(noon, NYC.lat, NYC.lon).altitude)).toBeGreaterThan(72);
    expect(deg(sunPosition(nextSunEvent(from, NYC.lat, NYC.lon, 'midnight'), NYC.lat, NYC.lon).altitude)).toBeLessThan(-25);
  });
  it('always returns a time at or after the start', () => {
    for (const ev of ['sunrise', 'sunset', 'noon', 'midnight'] as const) expect(nextSunEvent(from, NYC.lat, NYC.lon, ev)).toBeGreaterThanOrEqual(from);
  });
});
