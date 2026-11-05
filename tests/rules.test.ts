import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { activityScore, computeActivity, DAY } from '../src/core/rules/activity';
import { COBWEB_DAYS, dustLevel, glowLevel, hasCobwebs, isNeglected, kelvinToRgb, roomLight, wear } from '../src/core/rules/appearance';
import type { AccessEvent, Node } from '../src/data/schema';

describe('activity score (doc section 2)', () => {
  it('matches the formula at known points', () => {
    expect(activityScore(0, 0)).toBeCloseTo(0.6, 6);
    expect(activityScore(0, 20)).toBeCloseTo(1.0, 6);
    expect(activityScore(14, 0)).toBeCloseTo(0.6 / Math.E, 6);
    expect(activityScore(42, 0)).toBeCloseTo(0.6 * Math.exp(-3), 6); // six weeks: about 0.03
    expect(activityScore(42, 0)).toBeLessThan(0.05);
    expect(activityScore(1000, 40)).toBeCloseTo(0.4, 6); // opens saturate at 20
  });
  it('property: stays in [0,1], falls with age, rises with opens', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 2000, noNaN: true }), fc.float({ min: 0, max: 2000, noNaN: true }), fc.nat(60), fc.nat(60), (d1, d2, o1, o2) => {
        const a = activityScore(d1, o1);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1 + 1e-9);
        if (d1 <= d2) expect(activityScore(d1, o1)).toBeGreaterThanOrEqual(activityScore(d2, o1) - 1e-12);
        if (o1 <= o2) expect(activityScore(d1, o1)).toBeLessThanOrEqual(activityScore(d1, o2) + 1e-12);
      }),
    );
  });
});

describe('computeActivity', () => {
  const NOW = 1_800_000_000_000;
  const node = (id: string, parent: string | null, kind: Node['kind'], daysAgo: number): Node => ({ id, parent, kind, name: id, size: 1, mtime: NOW - daysAgo * DAY, tags: [], fingerprint: id });
  const nodes = [
    node('root', null, 'folder', 0),
    node('fresh', 'root', 'folder', 0), node('f1', 'fresh', 'text', 0.5), node('f2', 'fresh', 'text', 90),
    node('old', 'root', 'folder', 0), node('o1', 'old', 'text', 200),
    node('empty', 'root', 'folder', 400),
    node('deep', 'old', 'folder', 0), node('d1', 'deep', 'text', 3),
  ];
  const events: AccessEvent[] = [
    { nodeId: 'o1', ts: NOW - 2 * DAY, type: 'open' },
    { nodeId: 'o1', ts: NOW - 40 * DAY, type: 'open' }, // outside 30 days: not counted as an open, but counts as a touch
  ];
  const r = computeActivity(nodes, events, NOW);

  it('uses the newest change anywhere in the subtree', () => {
    expect(r.get('fresh')!.activity).toBeCloseTo(activityScore(0.5, 0), 6);
    expect(r.get('old')!.newest).toBe(NOW - 3 * DAY); // from the nested folder
    expect(r.get('root')!.newest).toBe(NOW - 0.5 * DAY);
  });
  it('counts opens within 30 days only, summed over the tree', () => {
    expect(r.get('old')!.opens30).toBe(1);
  });
  it('an untouched empty folder falls back to its own mtime', () => {
    expect(r.get('empty')!.idleDays).toBe(400);
    expect(r.get('empty')!.activity).toBeLessThan(0.001);
  });
  it('idle days account for opens as touches', () => {
    expect(r.get('old')!.idleDays).toBe(2); // opened 2 days ago, newer than any modification there
  });
});

describe('appearance rules', () => {
  it('room light spans 0.15..1.0 and 4500K..2700K', () => {
    expect(roomLight(0)).toEqual({ intensity: 0.15, kelvin: 4500 });
    expect(roomLight(1)).toEqual({ intensity: 1, kelvin: 2700 });
    expect(roomLight(0.6).intensity).toBeGreaterThan(0.8); // edited today reads as bright
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), fc.float({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(roomLight(hi).intensity).toBeGreaterThanOrEqual(roomLight(lo).intensity);
        expect(roomLight(hi).kelvin).toBeLessThanOrEqual(roomLight(lo).kelvin);
      }),
    );
  });
  it('warm light is redder than cool light', () => {
    const warm = kelvinToRgb(2700);
    const cool = kelvinToRgb(4500);
    expect(warm[0]).toBeGreaterThanOrEqual(cool[0]);
    expect(warm[2]).toBeLessThan(cool[2]);
  });
  it('dust and wear follow the documented ranges', () => {
    expect(dustLevel(10)).toBe(0);
    expect(dustLevel(30)).toBe(0);
    expect(dustLevel(105)).toBeCloseTo(0.5, 6);
    expect(dustLevel(500)).toBe(1);
    expect(wear(1000)).toEqual({ roughness: 0.4, dustAlpha: 0.6 });
    expect(wear(0)).toEqual({ roughness: 0, dustAlpha: 0 });
  });
  it('cobwebs after 90 days, neglected after 60, glow only inside 24 hours', () => {
    expect(hasCobwebs(COBWEB_DAYS - 1)).toBe(false);
    expect(hasCobwebs(COBWEB_DAYS)).toBe(true);
    expect(isNeglected(59)).toBe(false);
    expect(isNeglected(60)).toBe(true);
    expect(glowLevel(0)).toBe(1);
    expect(glowLevel(24)).toBe(0);
    expect(glowLevel(100)).toBe(0);
    expect(glowLevel(12)).toBeCloseTo(0.5, 6);
  });
});
