import type { Id, Room, Side } from '../data/schema';

export interface SlotRef {
  side: Side;
  slot: number;
}

export function findSlot(room: Room, itemId: Id): SlotRef | null {
  for (const w of room.walls) for (const s of w.slots) if (s.itemId === itemId) return { side: w.side, slot: s.index };
  return null;
}

export function slotItem(room: Room, ref: SlotRef): Id | null {
  return room.walls.find((w) => w.side === ref.side)?.slots[ref.slot]?.itemId ?? null;
}

/** Removes an item from wherever it hangs. Returns the same room when it was not placed. */
export function clearItem(room: Room, itemId: Id): Room {
  if (!findSlot(room, itemId)) return room;
  const next = structuredClone(room);
  for (const w of next.walls) for (const s of w.slots) if (s.itemId === itemId) s.itemId = null;
  return next;
}

/**
 * Puts an item into a specific slot, vacating its previous slot. The target must be empty (or already hold this item).
 * Throws on an occupied target so callers cannot silently displace something.
 */
export function assignSlot(room: Room, itemId: Id, ref: SlotRef): Room {
  const wall = room.walls.find((w) => w.side === ref.side);
  const slot = wall?.slots[ref.slot];
  if (!wall || !slot) throw new Error('No such spot on that wall');
  if (slot.itemId && slot.itemId !== itemId) throw new Error('That spot is already taken');
  const next = structuredClone(room);
  for (const w of next.walls) for (const s of w.slots) if (s.itemId === itemId) s.itemId = null;
  next.walls.find((w) => w.side === ref.side)!.slots[ref.slot].itemId = itemId;
  return next;
}

export function freeSlots(room: Room): SlotRef[] {
  const out: SlotRef[] = [];
  for (const w of room.walls) for (const s of w.slots) if (!s.itemId) out.push({ side: w.side, slot: s.index });
  return out;
}
