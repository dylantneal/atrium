import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { Inventory } from '../src/core/inventory';
import { assignSlot, clearItem, findSlot, freeSlots } from '../src/core/placement';
import { closeDb, putInventory, setDbName } from '../src/data/idb';
import { generateRoom } from '../src/world/generator/rooms';

const items = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, name: `img${i}`, kind: 'image' as const }));
const room = () => generateRoom({ roomId: 'r', kind: 'folder', items, folders: [], parentId: 'p' });

describe('placement', () => {
  it('finds, clears and reassigns slots without touching other items', () => {
    const r = room();
    const home = findSlot(r, 'i2')!;
    const free = freeSlots(r)[0];
    const moved = assignSlot(r, 'i2', free);
    expect(findSlot(moved, 'i2')).toEqual(free);
    expect(findSlot(r, 'i2')).toEqual(home); // input is not mutated
    for (const id of ['i0', 'i1', 'i3', 'i4', 'i5']) expect(findSlot(moved, id)).toEqual(findSlot(r, id));
    expect(freeSlots(moved)).toContainEqual(home);
    expect(findSlot(clearItem(moved, 'i2'), 'i2')).toBeNull();
  });
  it('refuses to displace an occupied slot', () => {
    const r = room();
    expect(() => assignSlot(r, 'i0', findSlot(r, 'i1')!)).toThrow(/taken/);
    expect(() => assignSlot(r, 'i0', { side: 'N', slot: 9999 })).toThrow();
  });
  it('property: an item is never in two places after any sequence of placements', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.nat(40)), { maxLength: 25 }), (moves) => {
        let r = room();
        for (const [it, pick] of moves) {
          const free = freeSlots(r);
          if (free.length === 0) continue;
          r = assignSlot(r, `i${it}`, free[pick % free.length]);
        }
        const all = r.walls.flatMap((w) => w.slots.map((s) => s.itemId).filter(Boolean));
        expect(new Set(all).size).toBe(all.length);
        expect(all.sort()).toEqual(items.map((i) => i.id).sort());
      }),
    );
  });
});

describe('inventory', () => {
  beforeEach(async () => {
    await closeDb();
    setDbName(`inv-${Math.random()}`);
  });
  it('fills the first free slot, selects it, and reports full at 8', async () => {
    const inv = new Inventory();
    for (let i = 0; i < 8; i++) expect(inv.pickUp(`x${i}`)).toBe(true);
    expect(inv.isFull).toBe(true);
    expect(inv.pickUp('overflow')).toBe(false);
    inv.remove('x3');
    expect(inv.pickUp('later')).toBe(true);
    expect(inv.slots[3]).toBe('later');
    expect(inv.store.get().selected).toBe(3);
    await inv.flush();
  });
  it('picking an already-held item just selects it', async () => {
    const inv = new Inventory();
    inv.pickUp('a');
    inv.pickUp('b');
    inv.pickUp('a');
    expect(inv.slots.filter(Boolean)).toEqual(['a', 'b']);
    expect(inv.store.get().selected).toBe(0);
    await inv.flush();
  });
  it('persists across loads and drops references to vanished items', async () => {
    await putInventory({ slots: ['keep', 'gone', null, null, null, null, null, null] });
    const inv = new Inventory();
    await inv.load(async (id) => id === 'keep');
    expect(inv.slots[0]).toBe('keep');
    expect(inv.slots[1]).toBeNull();
  });
});
