import { addAccess, addVersion, putBlob } from '../data/idb';
import type { Id } from '../data/schema';
import type { Command } from './undo';
import type { VFS } from '../vfs/vfs';

export function renameCmd(vfs: VFS, id: Id, newName: string): Command {
  let oldName = '';
  return {
    label: `Renamed to "${newName}"`,
    async run() {
      oldName = (await vfs.stat(id)).name;
      await vfs.rename(id, newName);
    },
    async undo() {
      await vfs.rename(id, oldName);
    },
  };
}

export function setTagsCmd(vfs: VFS, id: Id, tags: string[]): Command {
  let old: string[] = [];
  return {
    label: tags.length ? `Tagged ${tags.join(', ')}` : 'Cleared tags',
    async run() {
      old = (await vfs.stat(id)).tags;
      await vfs.setTags(id, tags);
    },
    async undo() {
      await vfs.setTags(id, old);
    },
  };
}

/**
 * Snapshots the current content as a version (so the previous state is recoverable), then writes.
 * Used by the focus-mode editors. `snapshot` is false for follow-up saves in the same session.
 */
export async function saveWithVersion(vfs: VFS, id: Id, data: string | Blob, snapshot: boolean): Promise<void> {
  if (snapshot) {
    const node = await vfs.stat(id);
    const blob = await vfs.read(id);
    const ts = Date.now();
    const key = `v:${id}:${ts}`;
    await putBlob(key, blob);
    await addVersion({ nodeId: id, ts, blobKey: key, size: node.size });
  }
  await vfs.write(id, data);
  await addAccess({ nodeId: id, ts: Date.now(), type: 'edit' });
}

export async function recordOpen(id: Id) {
  await addAccess({ nodeId: id, ts: Date.now(), type: 'open' });
}
