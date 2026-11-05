import type { Id, Room } from '../data/schema';
import { getRoom, putRoom } from '../data/idb';
import type { VFS } from '../vfs/vfs';
import { assignSlot, clearItem, findSlot, type SlotRef } from './placement';
import type { Inventory } from './inventory';
import type { Command } from './undo';

/** What commands need from the session: a way to run several file/room changes as one rebuild. */
export interface HandCtx {
  vfs: VFS;
  inventory: Inventory;
  batch<T>(fn: () => Promise<T>): Promise<T>;
}

async function roomOf(id: Id): Promise<Room | undefined> {
  return getRoom(id);
}

/** Put an item back where it hung, if that spot is still free; otherwise leave it to the next reconcile. */
async function rehang(roomId: Id | null, itemId: Id, ref: SlotRef | null) {
  if (!roomId || !ref) return;
  const room = await roomOf(roomId);
  if (!room) return;
  try {
    await putRoom(assignSlot(room, itemId, ref));
  } catch {
    /* spot was taken meanwhile: reconcile will find a free one */
  }
}

async function unhang(roomId: Id, itemId: Id) {
  const room = await roomOf(roomId);
  if (room) await putRoom(clearItem(room, itemId));
}

/** Place a carried item on a specific wall spot of `roomId` (move by default, copy when asked). */
export function placeCmd(ctx: HandCtx, itemId: Id, roomId: Id, ref: SlotRef, copy: boolean): Command {
  let name = '';
  let srcParent: Id | null = null;
  let srcRef: SlotRef | null = null;
  let created: Id | null = null;
  let reslot = false;
  return {
    get label() {
      return copy ? `Copied "${name}" here` : reslot ? `Moved "${name}" to another spot` : `Moved "${name}" here`;
    },
    async run() {
      await ctx.batch(async () => {
        const node = await ctx.vfs.stat(itemId);
        name = node.name;
        srcParent = node.parent;
        const dest = await roomOf(roomId);
        if (!dest) throw new Error('This room is not ready yet');
        if (copy) {
          created = await ctx.vfs.copy(itemId, roomId);
          await putRoom(assignSlot((await roomOf(roomId))!, created, ref));
          return;
        }
        reslot = node.parent === roomId;
        srcRef = findSlot((await roomOf(node.parent!)) ?? dest, itemId);
        await putRoom(assignSlot(dest, itemId, ref));
        if (!reslot) await ctx.vfs.move(itemId, roomId);
      });
      if (!copy) ctx.inventory.remove(itemId);
    },
    async undo() {
      await ctx.batch(async () => {
        if (copy && created) {
          await unhang(roomId, created);
          await ctx.vfs.trash(created);
          return;
        }
        await unhang(roomId, itemId);
        await rehang(srcParent, itemId, srcRef);
        if (!reslot && srcParent) await ctx.vfs.move(itemId, srcParent, name);
      });
    },
  };
}

/** Drop a carried item into another room through its door (moves the file into that folder). */
export function dropIntoCmd(ctx: HandCtx, itemId: Id, targetFolder: Id, targetName: string): Command {
  let name = '';
  let srcParent: Id | null = null;
  let srcRef: SlotRef | null = null;
  return {
    get label() {
      return `Moved "${name}" into ${targetName}`;
    },
    async run() {
      await ctx.batch(async () => {
        const node = await ctx.vfs.stat(itemId);
        name = node.name;
        if (node.parent === targetFolder) throw new Error('It is already in that room');
        srcParent = node.parent;
        const srcRoom = srcParent ? await roomOf(srcParent) : undefined;
        srcRef = srcRoom ? findSlot(srcRoom, itemId) : null;
        await ctx.vfs.move(itemId, targetFolder);
      });
      ctx.inventory.remove(itemId);
    },
    async undo() {
      await ctx.batch(async () => {
        await rehang(srcParent, itemId, srcRef);
        if (srcParent) await ctx.vfs.move(itemId, srcParent, name);
      });
    },
  };
}

/** Move an item to the recoverable trash. Only emptying the trash destroys anything. */
export function trashCmd(ctx: HandCtx, itemId: Id): Command {
  let name = '';
  let srcParent: Id | null = null;
  let srcRef: SlotRef | null = null;
  return {
    get label() {
      return `Moved "${name}" to the trash`;
    },
    async run() {
      await ctx.batch(async () => {
        const node = await ctx.vfs.stat(itemId);
        name = node.name;
        srcParent = node.parent;
        const room = srcParent ? await roomOf(srcParent) : undefined;
        srcRef = room ? findSlot(room, itemId) : null;
        await ctx.vfs.trash(itemId);
      });
      ctx.inventory.remove(itemId);
    },
    async undo() {
      await ctx.batch(async () => {
        await rehang(srcParent, itemId, srcRef);
        await ctx.vfs.restore(itemId);
        if ((await ctx.vfs.stat(itemId)).name !== name) await ctx.vfs.rename(itemId, name);
      });
    },
  };
}

/** Bring a trashed item back to where it came from. Undo puts it back in the trash. */
export function restoreCmd(ctx: HandCtx, itemId: Id): Command {
  let name = '';
  return {
    get label() {
      return `Restored "${name}"`;
    },
    async run() {
      name = (await ctx.vfs.stat(itemId)).name;
      await ctx.batch(() => ctx.vfs.restore(itemId));
    },
    async undo() {
      await ctx.batch(() => ctx.vfs.trash(itemId));
    },
  };
}
