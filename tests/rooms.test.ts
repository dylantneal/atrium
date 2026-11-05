import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NodeKind } from '../src/data/schema';
import { BAY_HALF, bayCount, bayU, CLASSES, slotGeometry, wallLength } from '../src/world/generator/layout';
import { chooseWallType, generateRoom, reconcileRoom, type LayoutItem } from '../src/world/generator/rooms';

const kinds: NodeKind[] = ['image', 'video', 'audio', 'text', 'markdown', 'pdf', 'other'];
const mk = (n: number, kind: NodeKind, prefix = 'f'): LayoutItem[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${String(i).padStart(3, '0')}`, kind }));

describe('wall heuristic', () => {
  it('follows the doc rules', () => {
    expect(chooseWallType(mk(10, 'image'))).toBe('gallery');
    expect(chooseWallType(mk(6, 'video'))).toBe('screen');
    expect(chooseWallType(mk(8, 'markdown'))).toBe('corkboard');
    expect(chooseWallType(mk(30, 'markdown'))).toBe('shelf'); // too many for a corkboard
    expect(chooseWallType([...mk(5, 'image'), ...mk(5, 'audio', 'a')])).toBe('shelf');
    expect(chooseWallType([])).toBeNull();
  });
});

describe('slot geometry', () => {
  it('never overlaps door bays or leaves the wall, for every type and size', () => {
    for (const size of CLASSES) {
      for (const side of ['N', 'E', 'W', 'S'] as const) {
        const L = wallLength(size, side);
        for (const type of ['gallery', 'shelf', 'screen', 'corkboard'] as const) {
          const slots = slotGeometry(size, side, type, 3.6, 7);
          for (const s of slots) {
            expect(s.u - s.w / 2).toBeGreaterThanOrEqual(0.3);
            expect(s.u + s.w / 2).toBeLessThanOrEqual(L - 0.3);
            for (let i = 0; i < bayCount(L); i++) {
              const bu = bayU(L, i);
              const clear = s.u + s.w / 2 <= bu - BAY_HALF + 0.12 || s.u - s.w / 2 >= bu + BAY_HALF - 0.12;
              expect(clear, `${size.w}x${size.d} ${side} ${type} slot ${s.index}`).toBe(true);
            }
          }
          expect(slots.map((s) => s.index)).toEqual(slots.map((_, i) => i));
        }
      }
    }
  });
  it('is deterministic', () => {
    expect(slotGeometry(CLASSES[1], 'N', 'corkboard', 3.5, 9)).toEqual(slotGeometry(CLASSES[1], 'N', 'corkboard', 3.5, 9));
  });
});

describe('generateRoom', () => {
  const items = [...mk(14, 'image', 'i'), ...mk(5, 'markdown', 'm'), ...mk(4, 'audio', 'a'), ...mk(3, 'video', 'v')];
  const folders = [{ id: 'd1', name: 'Alpha' }, { id: 'd2', name: 'Beta' }];

  it('is byte-equal when generated twice', () => {
    const a = generateRoom({ roomId: 'r1', kind: 'folder', items, folders, parentId: 'p' });
    const b = generateRoom({ roomId: 'r1', kind: 'folder', items: [...items].reverse(), folders: [...folders].reverse(), parentId: 'p' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('places every item exactly once and keeps spare capacity', () => {
    const r = generateRoom({ roomId: 'r1', kind: 'folder', items, folders, parentId: 'p' });
    const ids = r.walls.flatMap((w) => w.slots.map((s) => s.itemId).filter(Boolean));
    expect(new Set(ids).size).toBe(items.length);
    expect(ids.length).toBe(items.length);
    expect(r.walls.reduce((n, w) => n + w.slots.length, 0)).toBeGreaterThanOrEqual(items.length + 3);
  });

  it('gives each folder a door plus a Back door on the south wall bay 0', () => {
    const r = generateRoom({ roomId: 'r1', kind: 'folder', items, folders, parentId: 'p' });
    expect(r.doors.map((d) => d.to).sort()).toEqual(['d1', 'd2', 'p']);
    const back = r.doors.find((d) => d.to === 'p')!;
    expect(back.side).toBe('S');
    expect(new Set(r.doors.map((d) => `${d.side}:${d.t}`)).size).toBe(r.doors.length);
  });

  it('grows the footprint with item count', () => {
    const small = generateRoom({ roomId: 's', kind: 'folder', items: mk(3, 'image'), folders: [], parentId: 'p' });
    const big = generateRoom({ roomId: 'b', kind: 'folder', items: mk(90, 'image'), folders: [], parentId: 'p' });
    expect(big.style.width * big.style.depth).toBeGreaterThan(small.style.width * small.style.depth);
  });

  it('property: item ids never duplicate and doors never collide, for random contents', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...kinds), { maxLength: 70 }),
        fc.integer({ min: 0, max: 14 }),
        fc.integer({ min: 1, max: 2 ** 31 }),
        (ks, nf, seed) => {
          const its = ks.map((kind, i) => ({ id: `x${i}`, name: `n${i}`, kind }));
          const fs = Array.from({ length: nf }, (_, i) => ({ id: `fo${i}`, name: `F${i}` }));
          const r = generateRoom({ roomId: 'q', kind: 'folder', items: its, folders: fs, parentId: 'p', seed });
          const ids = r.walls.flatMap((w) => w.slots.map((s) => s.itemId).filter(Boolean));
          expect(new Set(ids).size).toBe(ids.length);
          expect(new Set(r.doors.map((d) => `${d.side}:${d.t}`)).size).toBe(r.doors.length);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('reconcileRoom (stability)', () => {
  const base = [...mk(8, 'image', 'i'), ...mk(4, 'markdown', 'm')];
  const folders = [{ id: 'd1', name: 'Alpha' }];
  const room = generateRoom({ roomId: 'r', kind: 'folder', items: base, folders, parentId: 'p' });

  const slotMap = (r: typeof room) => {
    const m = new Map<string, string>();
    for (const w of r.walls) for (const s of w.slots) if (s.itemId) m.set(s.itemId, `${w.side}:${s.index}`);
    return m;
  };

  it('is a no-op when nothing changed', () => {
    const r = reconcileRoom(room, base, folders, 'p');
    expect(r.changed).toBe(false);
    expect(r.room).toBe(room);
  });

  it('property: adding files never moves an existing item', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...kinds), { minLength: 1, maxLength: 6 }), (ks) => {
        const added = ks.map((kind, i) => ({ id: `new${i}`, name: `zz${i}`, kind }));
        const r = reconcileRoom(room, [...base, ...added], folders, 'p');
        const before = slotMap(room);
        const after = slotMap(r.room);
        for (const [id, pos] of before) expect(after.get(id)).toBe(pos);
      }),
    );
  });

  it('removing a file leaves an empty slot and nothing else moves', () => {
    const r = reconcileRoom(room, base.filter((i) => i.id !== 'i3'), folders, 'p');
    const before = slotMap(room);
    const after = slotMap(r.room);
    expect(after.has('i3')).toBe(false);
    for (const [id, pos] of after) expect(before.get(id)).toBe(pos);
  });

  it('a new folder takes a free bay without moving existing doors', () => {
    const r = reconcileRoom(room, base, [...folders, { id: 'd2', name: 'Beta' }], 'p');
    const old = room.doors.map((d) => `${d.to}@${d.side}:${d.t}`);
    for (const o of old) expect(r.room.doors.map((d) => `${d.to}@${d.side}:${d.t}`)).toContain(o);
    expect(r.room.doors.some((d) => d.to === 'd2')).toBe(true);
  });

  it('reports overflow instead of silently dropping when full', () => {
    const tiny = generateRoom({ roomId: 't', kind: 'folder', items: mk(2, 'audio', 'a'), folders: [], parentId: 'p' });
    const cap = tiny.walls.reduce((n, w) => n + w.slots.length, 0);
    const r = reconcileRoom(tiny, mk(cap + 5, 'audio', 'z'), [], 'p');
    expect(r.overflowItems.length).toBe(5);
  });
});
