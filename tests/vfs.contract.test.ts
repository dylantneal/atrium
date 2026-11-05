import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDb, setDbName } from '../src/data/idb';
import { DemoVFS, ROOT_ID, TRASH_ID } from '../src/vfs/demo';
import type { VFS } from '../src/vfs/vfs';
import { VfsError } from '../src/vfs/vfs';

/** Contract every VFS backend must satisfy. Add FsaVFS (against OPFS) to `backends` later. */
const backends: { name: string; make: () => Promise<VFS> }[] = [
  {
    name: 'DemoVFS',
    make: async () => {
      setDbName(`vfs-test-${Math.random()}`);
      let t = 1_000;
      return DemoVFS.open({ clock: () => (t += 10) });
    },
  },
];

for (const b of backends) {
  describe(`VFS contract: ${b.name}`, () => {
    let vfs: VFS;
    beforeEach(async () => {
      vfs = await b.make();
    });

    it('creates folders and files and lists them (folders first)', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      await vfs.create(vfs.rootId, 'z.txt', 'hi');
      await vfs.create(vfs.rootId, 'b.md', '# b');
      const names = (await vfs.list(vfs.rootId)).map((n) => n.name);
      expect(names).toEqual(['A', 'b.md', 'z.txt']);
      expect((await vfs.stat(a)).kind).toBe('folder');
    });

    it('hides the trash folder from root listings', async () => {
      const names = (await vfs.list(vfs.rootId)).map((n) => n.name);
      expect(names).not.toContain('.atrium-trash');
    });

    it('writes and reads back content, updating size and mtime', async () => {
      const f = await vfs.create(vfs.rootId, 'n.txt', 'one');
      const before = await vfs.stat(f);
      await vfs.write(f, 'three');
      const after = await vfs.stat(f);
      expect(await (await vfs.read(f)).text()).toBe('three');
      expect(after.size).toBe(5);
      expect(after.mtime).toBeGreaterThan(before.mtime);
    });

    it('moves keep the id and rename on clash', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      const f = await vfs.create(vfs.rootId, 'n.txt', 'x');
      await vfs.create(a, 'n.txt', 'other');
      await vfs.move(f, a);
      const moved = await vfs.stat(f);
      expect(moved.parent).toBe(a);
      expect(moved.name).toBe('n (2).txt');
      expect(await (await vfs.read(f)).text()).toBe('x');
    });

    it('refuses to move a folder into itself or a descendant', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      const b = await vfs.create(a, 'B');
      await expect(vfs.move(a, a)).rejects.toBeInstanceOf(VfsError);
      await expect(vfs.move(a, b)).rejects.toBeInstanceOf(VfsError);
    });

    it('copies files and folders deeply with new ids', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      const f = await vfs.create(a, 'n.txt', 'deep');
      const dest = await vfs.create(vfs.rootId, 'Dest');
      const copied = await vfs.copy(a, dest);
      expect(copied).not.toBe(a);
      const kids = await vfs.list(copied);
      expect(kids.map((k) => k.name)).toEqual(['n.txt']);
      expect(kids[0].id).not.toBe(f);
      expect(await (await vfs.read(kids[0].id)).text()).toBe('deep');
      // original untouched
      expect(await (await vfs.read(f)).text()).toBe('deep');
    });

    it('trash is reversible and remembers the origin', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      const f = await vfs.create(a, 'n.txt', 'keep me');
      await vfs.trash(f);
      expect((await vfs.list(a)).length).toBe(0);
      expect((await vfs.list(await vfs.trashId())).map((n) => n.id)).toContain(f);
      await vfs.restore(f);
      const back = await vfs.stat(f);
      expect(back.parent).toBe(a);
      expect(back.trashedFrom).toBeUndefined();
      expect(await (await vfs.read(f)).text()).toBe('keep me');
    });

    it('restores to root when the origin folder is gone', async () => {
      const a = await vfs.create(vfs.rootId, 'A');
      const f = await vfs.create(a, 'n.txt', 'x');
      await vfs.trash(f);
      await vfs.trash(a);
      await vfs.restore(f);
      expect((await vfs.stat(f)).parent).toBe(ROOT_ID);
    });

    it('emptyTrash is the only operation that destroys data', async () => {
      const f = await vfs.create(vfs.rootId, 'n.txt', 'x');
      await vfs.trash(f);
      await vfs.emptyTrash();
      await expect(vfs.stat(f)).rejects.toMatchObject({ code: 'not-found' });
      expect(await vfs.list(TRASH_ID)).toEqual([]);
    });

    it('emits change events', async () => {
      const seen: string[] = [];
      const off = vfs.watch((cs) => cs.forEach((c) => seen.push(c.type)));
      const f = await vfs.create(vfs.rootId, 'n.txt', 'x');
      await vfs.write(f, 'y');
      await vfs.move(f, TRASH_ID);
      off();
      await vfs.write(f, 'z');
      expect(seen).toEqual(['add', 'modify', 'move']);
    });

    it('dedupes and trims tags', async () => {
      const f = await vfs.create(vfs.rootId, 'n.txt', 'x');
      await vfs.setTags(f, [' a ', 'a', '', 'b']);
      expect((await vfs.stat(f)).tags).toEqual(['a', 'b']);
    });
  });
}

// teardown for the in-memory db names
import { afterAll } from 'vitest';
afterAll(async () => {
  await deleteDb();
});
