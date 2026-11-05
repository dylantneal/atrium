import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildDemoSpec, materializeDemo } from '../src/demo/generator';
import { hash32 } from '../src/util/hash';
import { makeRng } from '../src/world/generator/prng';

describe('prng', () => {
  it('same seed gives the same sequence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const a = makeRng(seed);
        const b = makeRng(seed);
        for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
      }),
    );
  });
  it('stays in [0,1) and int() respects bounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }), (seed, min, span) => {
        const r = makeRng(seed);
        const max = min + span;
        for (let i = 0; i < 50; i++) {
          const f = r.next();
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
          const n = r.int(min, max);
          expect(n).toBeGreaterThanOrEqual(min);
          expect(n).toBeLessThanOrEqual(max);
        }
      }),
    );
  });
  it('hash32 is stable', () => {
    expect(hash32('atrium')).toBe(hash32('atrium'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });
});

describe('demo generator', () => {
  const NOW = Date.UTC(2026, 10, 5);
  it('spec is deterministic and has the activity story', () => {
    const a = buildDemoSpec(1, NOW);
    const b = buildDemoSpec(1, NOW);
    expect(a).toEqual(b);
    const newestByProject = new Map<string, number>();
    for (const f of a.files) {
      const proj = f.path.split('/')[0];
      newestByProject.set(proj, Math.max(newestByProject.get(proj) ?? 0, f.mtime));
    }
    const days = (p: string) => (NOW - newestByProject.get(p)!) / 86400000;
    expect(days('Crow Short Film')).toBeLessThan(1);
    expect(days('Night Static (Band)')).toBeLessThan(2);
    expect(days('Taxes & Admin')).toBeGreaterThan(100);
    expect(days('Archive 2022')).toBeGreaterThan(300);
  });
  it('materializes valid PNG and WAV bytes', async () => {
    const seed = await materializeDemo(buildDemoSpec(1, NOW));
    const img = seed.nodes.find((n) => n.kind === 'image')!;
    const png = new Uint8Array(await seed.blobs.get(img.id)!.arrayBuffer());
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(img.color).toBeTypeOf('number');
    const wav = seed.nodes.find((n) => n.kind === 'audio')!;
    const bytes = new Uint8Array(await seed.blobs.get(wav.id)!.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(seed.nodes.length).toBeGreaterThan(150);
    // ids unique, parents exist
    const ids = new Set(seed.nodes.map((n) => n.id));
    expect(ids.size).toBe(seed.nodes.length);
    for (const n of seed.nodes) expect(n.parent === null || n.parent === 'root' || ids.has(n.parent)).toBe(true);
  });
});
