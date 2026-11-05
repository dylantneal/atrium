import { describe, expect, it } from 'vitest';
import { ScaleController } from '../src/world/quality';

const run = (c: ScaleController, ms: number | ((i: number) => number), n: number) => {
  const steps: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = c.frame(typeof ms === 'number' ? ms : ms(i));
    if (r !== null) steps.push(r);
  }
  return steps;
};

describe('ScaleController', () => {
  it('steps down once frames stay slow, one step at a time, and never below min', () => {
    const c = new ScaleController(0.6, 1, 0.1);
    expect(run(c, 50, 25)).toEqual([]); // the average has not even crossed 40 ms yet
    const steps = run(c, 50, 400);
    expect(steps[0]).toBe(0.9);
    expect(steps).toEqual([0.9, 0.8, 0.7, 0.6]);
    expect(c.scale).toBe(0.6);
  });
  it('treats alternating long and short frames as slow (catch-up frames must not hide a slow device)', () => {
    const c = new ScaleController(0.6, 1, 0.1);
    const steps = run(c, (i) => (i % 2 ? 8 : 190), 200); // average about 99 ms
    expect(steps.length).toBeGreaterThan(0);
    expect(c.scale).toBeLessThan(1);
  });
  it('leaves a healthy device alone, including the occasional hitch', () => {
    const c = new ScaleController();
    expect(run(c, (i) => (i % 50 === 0 ? 90 : 16), 1000)).toEqual([]);
    expect(c.scale).toBe(1);
  });
  it('recovers slowly after sustained fast frames, up to max', () => {
    const c = new ScaleController(0.6, 1, 0.1);
    run(c, 60, 80);
    const low = c.scale;
    expect(low).toBeLessThan(1);
    const steps = run(c, 8, 600);
    expect(steps.length).toBeGreaterThan(0);
    expect(c.scale).toBeGreaterThan(low);
    expect(c.scale).toBeLessThanOrEqual(1);
  });
  it('setMax clamps the current scale', () => {
    const c = new ScaleController();
    c.setMax(0.7);
    expect(c.scale).toBe(0.7);
  });
});
