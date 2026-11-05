import { describe, expect, it } from 'vitest';
import { ScaleController } from '../src/world/quality';

describe('ScaleController', () => {
  it('steps down after 30 consecutive slow frames and never below min', () => {
    const c = new ScaleController(0.6, 1, 0.1);
    let changes = 0;
    for (let i = 0; i < 29; i++) expect(c.frame(50)).toBeNull();
    expect(c.frame(50)).toBe(0.9);
    changes++;
    for (let i = 0; i < 400; i++) if (c.frame(50) !== null) changes++;
    expect(c.scale).toBe(0.6);
    expect(changes).toBe(4);
  });
  it('one normal frame resets the slow streak', () => {
    const c = new ScaleController();
    for (let i = 0; i < 20; i++) c.frame(50);
    c.frame(30);
    for (let i = 0; i < 20; i++) expect(c.frame(50)).toBeNull();
    expect(c.scale).toBe(1);
  });
  it('recovers slowly after sustained fast frames, up to max', () => {
    const c = new ScaleController(0.6, 1, 0.1);
    for (let i = 0; i < 30; i++) c.frame(50);
    expect(c.scale).toBe(0.9);
    for (let i = 0; i < 179; i++) expect(c.frame(10)).toBeNull();
    expect(c.frame(10)).toBe(1);
  });
  it('setMax clamps the current scale', () => {
    const c = new ScaleController();
    c.setMax(0.7);
    expect(c.scale).toBe(0.7);
  });
});
