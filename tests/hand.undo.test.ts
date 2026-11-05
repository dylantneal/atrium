import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ActionBus } from '../src/core/actions';
import { dropIntoCmd, placeCmd, trashCmd, type HandCtx } from '../src/core/handCommands';
import { freeSlots } from '../src/core/placement';
import { Inventory } from '../src/core/inventory';
import { allRooms, closeDb, getRoom, putRoom, setDbName } from '../src/data/idb';
import type { Id, Node } from '../src/data/schema';
import { DemoVFS, TRASH_ID } from '../src/vfs/demo';
import { generateRoom } from '../src/world/generator/rooms';

const FOLDERS = ['A', 'B', 'C'];

async function world() {
  await closeDb();
  setDbName(`undo-${Math.random()}`);
  let t = 1000;
  const vfs = await DemoVFS.open({ clock: () => (t += 1) });
  const folders: Record<string, Id> = {};
  for (const f of FOLDERS) folders[f] = await vfs.create(vfs.rootId, f);
  const files: Id[] = [];
  for (const f of FOLDERS) {
    for (let i = 0; i < 6; i++) files.push(await vfs.create(folders[f], `img_${i}.png`, 'x', 'image')); // same names across folders on purpose
  }
  const rootKids = FOLDERS.map((f) => ({ id: folders[f], name: f }));
  await putRoom(generateRoom({ roomId: vfs.rootId, kind: 'folder', items: [], folders: rootKids, parentId: null }));
  for (const f of FOLDERS) {
    const kids = await vfs.list(folders[f]);
    await putRoom(generateRoom({ roomId: folders[f], kind: 'folder', items: kids.map((k) => ({ id: k.id, name: k.name, kind: k.kind })), folders: [], parentId: vfs.rootId }));
  }
  const inventory = new Inventory();
  const ctx: HandCtx = { vfs, inventory, batch: (fn) => fn() };
  return { vfs, folders, files, ctx };
}

async function snapshot(vfs: DemoVFS) {
  const all = await vfs.all();
  const byId = new Map(all.map((n) => [n.id, n]));
  const underTrash = (n: Node): boolean => (n.id === TRASH_ID ? true : n.parent ? underTrash(byId.get(n.parent)!) : false);
  const nodes = all.filter((n) => !underTrash(n)).map((n) => `${n.id}|${n.parent}|${n.name}`).sort();
  const rooms = (await allRooms()).map((r) => `${r.id}:` + r.walls.map((w) => w.slots.map((s) => s.itemId ?? '-').join(',')).join('/')).sort();
  return { nodes, rooms };
}

describe('hand commands: undo restores everything', () => {
  it('any sequence of place / copy / drop / trash is exactly reversible', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ op: fc.constantFrom('move', 'copy', 'drop', 'trash'), file: fc.nat(17), target: fc.nat(2), pick: fc.nat(30) }), { minLength: 1, maxLength: 8 }),
        async (ops) => {
          const { vfs, folders, files, ctx } = await world();
          const before = await snapshot(vfs);
          const bus = new ActionBus();
          for (const o of ops) {
            const id = files[o.file % files.length];
            const node = await vfs.stat(id).catch(() => null);
            if (!node || node.parent === TRASH_ID) continue;
            const targetId = folders[FOLDERS[o.target % 3]];
            if (o.op === 'trash') await bus.dispatch(trashCmd(ctx, id), { toast: false });
            else if (o.op === 'drop') await bus.dispatch(dropIntoCmd(ctx, id, targetId, 'x'), { toast: false });
            else {
              const room = (await getRoom(targetId))!;
              const free = freeSlots(room);
              if (free.length === 0) continue;
              await bus.dispatch(placeCmd(ctx, id, targetId, free[o.pick % free.length], o.op === 'copy'), { toast: false });
            }
          }
          while (bus.undoStack.canUndo) await bus.undo();
          const after = await snapshot(vfs);
          expect(after.nodes).toEqual(before.nodes);
          expect(after.rooms).toEqual(before.rooms);
        },
      ),
      { numRuns: 150 },
    );
  });
});
