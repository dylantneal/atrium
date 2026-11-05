import type { Door, Id, Landmark, NodeKind, Room, RoomKind, Side, Slot, StyleParams, Wall, WallType } from '../../data/schema';
import { hash32, makeRng } from './prng';
import { bayCount, bayU, CLASSES, SIDES, slotGeometry, wallLength, type Size } from './layout';

export interface LayoutItem {
  id: Id;
  name: string;
  kind: NodeKind;
}
export interface LayoutFolder {
  id: Id;
  name: string;
}

export interface GenInput {
  roomId: Id;
  kind: RoomKind;
  items: LayoutItem[];
  folders: LayoutFolder[];
  parentId: Id | null;
  title?: string;
  query?: string;
  /** Override the seed (search rooms use a hash of the query). */
  seed?: number;
  /** Keep the given item order (search results are already ranked) instead of sorting by name. */
  keepOrder?: boolean;
  palette?: number;
}

export const PALETTES = [
  { wall: 0xd9ccb8, floor: 0x5a4636, trim: 0x3a2c22, accent: 0xe0a458, ceil: 0xf2eadf },
  { wall: 0xb7c4b0, floor: 0x4b5548, trim: 0x2f3a2d, accent: 0xd6b25e, ceil: 0xe7ede2 },
  { wall: 0x9fb0c8, floor: 0x2f3647, trim: 0x1f2535, accent: 0xffb25b, ceil: 0xdde4ef },
  { wall: 0xc99a82, floor: 0x3d2c28, trim: 0x2a1d1a, accent: 0xf2d388, ceil: 0xefe0d6 },
  { wall: 0x9a86a8, floor: 0x2d2535, trim: 0x1c1624, accent: 0xffc27d, ceil: 0xe4dcea },
  { wall: 0xe3d5b4, floor: 0x7a6a50, trim: 0x4a3f2e, accent: 0x4f8f9a, ceil: 0xf6f0e0 },
  { wall: 0x8fb5b2, floor: 0x2a3b3b, trim: 0x1a2929, accent: 0xf0a36b, ceil: 0xdcecea },
  { wall: 0xd7a9ad, floor: 0x4a3438, trim: 0x2d1f22, accent: 0xf6dd9a, ceil: 0xf5e6e7 },
  { wall: 0x7d8087, floor: 0x24262b, trim: 0x15161a, accent: 0xff8f5a, ceil: 0xcfd3da },
  { wall: 0xb2b27a, floor: 0x4a4a2c, trim: 0x2e2e1a, accent: 0xd98f5f, ceil: 0xeeeed9 },
  { wall: 0x7f8fb5, floor: 0x232a42, trim: 0x151a2c, accent: 0xffd27a, ceil: 0xd9deef },
  { wall: 0xefe6d2, floor: 0x8a7358, trim: 0x5a4636, accent: 0xb05a4a, ceil: 0xfaf5ea },
  // 12: the pale "workshop" used only for temporary search rooms, so they never look like a real folder
  { wall: 0xe9ecef, floor: 0xb7bcc2, trim: 0x8c939b, accent: 0x4f8f9a, ceil: 0xffffff },
] as const;

export const FOLDER_PALETTES = 12;
export const WORKSHOP_PALETTE = 12;

export const LANDMARK_KINDS = ['pillar', 'fountain', 'stairs', 'skylight', 'statue', 'plant', 'rug', 'lamp'] as const;
/** Collision radius per landmark kind (0 = walk-through). */
export const LANDMARK_RADIUS = [0.4, 1.0, 0.9, 0, 0.45, 0.4, 0, 0.25];

export type Family = 'gallery' | 'screen' | 'corkboard' | 'shelf';

export function familyOf(kind: NodeKind): Family {
  switch (kind) {
    case 'image':
    case 'pdf':
      return 'gallery';
    case 'video':
      return 'screen';
    case 'text':
    case 'markdown':
      return 'corkboard';
    default:
      return 'shelf';
  }
}

const natural = (a: LayoutItem, b: LayoutItem) => a.name.localeCompare(b.name, undefined, { numeric: true }) || (a.id < b.id ? -1 : 1);

/** Wall-type heuristic from the design doc, applied to the items not yet placed. */
export function chooseWallType(remaining: LayoutItem[]): WallType | null {
  const r = remaining.length;
  if (r === 0) return null;
  const count = (f: Family) => remaining.filter((i) => familyOf(i.kind) === f).length;
  if (count('gallery') / r > 0.6) return 'gallery';
  if (count('screen') / r > 0.6) return 'screen';
  if (count('corkboard') / r > 0.6 && r < 20) return 'corkboard';
  return 'shelf';
}

function accepts(type: WallType, item: LayoutItem): boolean {
  return type === 'shelf' || familyOf(item.kind) === type;
}

export function makeStyle(seed: number, size: Size, landmarkCap: number, paletteOverride?: number): StyleParams {
  const rng = makeRng(seed);
  const drawn = rng.int(0, FOLDER_PALETTES - 1);
  const palette = paletteOverride ?? drawn;
  const height = 3 + rng.int(0, 20) / 10;
  const floor = rng.int(0, 3);
  const trim = rng.int(0, 2);
  const n = Math.min(rng.int(2, 3), landmarkCap);
  const small = size.w <= 6;
  const gentle = [3, 5, 6, 7]; // skylight, plant, rug, lamp: never block a small room
  const landmarks: Landmark[] = [];
  const used = new Set<number>();
  for (let i = 0; i < 3; i++) {
    // Always draw the same number of values so room size never changes later draws.
    let kind = rng.int(0, LANDMARK_KINDS.length - 1);
    if (small) kind = gentle[kind % gentle.length];
    const fx = rng.range(-0.6, 0.6);
    const fz = rng.range(-0.5, 0.5);
    if (i >= n || used.has(kind)) continue;
    used.add(kind);
    // keep landmarks apart in normalized space
    if (landmarks.some((l) => Math.hypot(l.fx - fx, l.fz - fz) < 0.45)) continue;
    landmarks.push({ kind, fx: round3(fx), fz: round3(fz) });
  }
  if (landmarks.length === 0) landmarks.push({ kind: 3, fx: 0, fz: 0 });
  return { palette, width: size.w, depth: size.d, height: round1(height), floor, trim, landmarks };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function allBays(size: Size, reserveParent: boolean): { side: Side; i: number }[] {
  const out: { side: Side; i: number }[] = [];
  for (const side of SIDES) {
    const k = bayCount(wallLength(size, side));
    for (let i = 0; i < k; i++) {
      if (reserveParent && side === 'S' && i === 0) continue;
      out.push({ side, i });
    }
  }
  return out;
}

export function doorAt(roomId: Id, to: Id, label: string, side: Side, i: number, size: Size, portal = false): Door {
  const k = bayCount(wallLength(size, side));
  return { id: `${roomId}>${to}`, from: roomId, to, side, t: (i + 0.5) / k, label, portal };
}

export function bayIndexOfDoor(door: Door, size: Size): number {
  const k = bayCount(wallLength(size, door.side));
  return Math.round(door.t * k - 0.5);
}

function newWall(roomId: Id, side: Side, type: WallType, size: Size, height: number, seed: number, items: LayoutItem[], override = false): { wall: Wall; placed: Set<Id> } {
  const geom = slotGeometry(size, side, type, height, seed);
  const slots: Slot[] = geom.map((g) => ({ index: g.index, itemId: null, locked: false }));
  const placed = new Set<Id>();
  let s = 0;
  for (const item of items) {
    if (s >= slots.length) break;
    if (!accepts(type, item)) continue;
    slots[s++].itemId = item.id;
    placed.add(item.id);
  }
  return { wall: { id: `${roomId}:${side}`, side, type, override, slots }, placed };
}

function attempt(input: GenInput, seed: number, size: Size, sorted: LayoutItem[]) {
  const style = makeStyle(seed, size, size.w <= 6 ? 1 : 3, input.palette);
  const walls: Wall[] = [];
  let remaining = sorted;
  for (const [idx, side] of SIDES.entries()) {
    // A wall with nothing left to hold stays a plain gallery wall: no furniture is drawn until something hangs on it.
    const type = chooseWallType(remaining) ?? 'gallery';
    const pool = remaining.filter((i) => accepts(type, i));
    // shelves prefer leftovers of any kind but never starve other families: shelf takes everything not claimed above
    const { wall, placed } = newWall(input.roomId, side, type, size, style.height, seed + idx, pool);
    walls.push(wall);
    remaining = remaining.filter((i) => !placed.has(i.id));
  }
  return { style, walls, remaining };
}

/** Builds a room from scratch. Deterministic in (seed, sorted items, folders). */
export function generateRoom(input: GenInput): Room {
  const seed = input.seed ?? hash32(input.roomId);
  const sorted = input.keepOrder ? [...input.items] : [...input.items].sort(natural);
  const folders = [...input.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const reserveParent = input.parentId !== null;
  let result: ReturnType<typeof attempt> | null = null;
  let size = CLASSES[CLASSES.length - 1];
  for (const cls of CLASSES) {
    const r = attempt(input, seed, cls, sorted);
    const capacity = r.walls.reduce((n, w) => n + w.slots.length, 0);
    const bays = allBays(cls, reserveParent).length;
    // spare slots for new files, and two spare doorways for new folders or kept searches
    const fits = r.remaining.length === 0 && capacity >= sorted.length + 3 && bays >= folders.length + 2;
    result = r;
    size = cls;
    if (fits) break;
  }
  const r = result!;
  const doors: Door[] = [];
  if (input.parentId) doors.push(doorAt(input.roomId, input.parentId, 'Back', 'S', 0, size));
  const bays = allBays(size, reserveParent);
  folders.slice(0, bays.length).forEach((f, j) => doors.push(doorAt(input.roomId, f.id, f.name, bays[j].side, bays[j].i, size)));

  return {
    id: input.roomId,
    seed,
    style: r.style,
    walls: r.walls,
    doors,
    activity: 0.5,
    kind: input.kind,
    title: input.title,
    query: input.query,
  };
}

export interface Reconciled {
  room: Room;
  changed: boolean;
  /** Items that have no slot (room is full). Reachable through list view and search. */
  overflowItems: Id[];
  overflowFolders: Id[];
}

/**
 * Brings a saved room in line with its folder's current contents without ever moving an existing item:
 * vanished items leave empty slots, new items take the first free compatible slot, new folders take the next free bay.
 */
export function reconcileRoom(room: Room, items: LayoutItem[], folders: LayoutFolder[], parentId: Id | null): Reconciled {
  const next: Room = structuredClone(room);
  let changed = false;
  const size: Size = { w: next.style.width, d: next.style.depth };
  const live = new Map(items.map((i) => [i.id, i]));

  const placed = new Set<Id>();
  for (const wall of next.walls) {
    for (const slot of wall.slots) {
      if (slot.itemId && !live.has(slot.itemId)) {
        slot.itemId = null;
        changed = true;
      } else if (slot.itemId) placed.add(slot.itemId);
    }
  }

  const fresh = items.filter((i) => !placed.has(i.id)).sort(natural);
  const overflowItems: Id[] = [];
  for (const item of fresh) {
    const fam = familyOf(item.kind);
    const order = [...next.walls].sort((a, b) => Number(b.type === fam) - Number(a.type === fam) || Number(b.type === 'shelf') - Number(a.type === 'shelf'));
    let done = false;
    for (const wall of order) {
      if (!accepts(wall.type, item) && wall.type !== 'shelf' && wall.type !== fam) continue;
      const slot = wall.slots.find((s) => s.itemId === null);
      if (!slot) continue;
      slot.itemId = item.id;
      changed = done = true;
      break;
    }
    if (!done) {
      // second pass: any free slot anywhere (a frame can hold any item as a poster)
      for (const wall of next.walls) {
        const slot = wall.slots.find((s) => s.itemId === null);
        if (slot) {
          slot.itemId = item.id;
          changed = done = true;
          break;
        }
      }
    }
    if (!done) overflowItems.push(item.id);
  }

  // doors
  const liveFolders = new Map(folders.map((f) => [f.id, f]));
  const kept = next.doors.filter((d) => d.portal || d.to === parentId || liveFolders.has(d.to));
  if (kept.length !== next.doors.length) changed = true;
  next.doors = kept;
  for (const d of next.doors) {
    const f = liveFolders.get(d.to);
    if (f && d.label !== f.name) {
      d.label = f.name;
      changed = true;
    }
  }
  if (parentId && !next.doors.some((d) => d.to === parentId)) {
    next.doors.push(doorAt(next.id, parentId, 'Back', 'S', 0, size));
    changed = true;
  }
  const taken = new Set(next.doors.map((d) => `${d.side}:${bayIndexOfDoor(d, size)}`));
  const free = allBays(size, parentId !== null).filter((b) => !taken.has(`${b.side}:${b.i}`));
  const overflowFolders: Id[] = [];
  for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    if (next.doors.some((d) => d.to === f.id)) continue;
    const bay = free.shift();
    if (!bay) {
      overflowFolders.push(f.id);
      continue;
    }
    next.doors.push(doorAt(next.id, f.id, f.name, bay.side, bay.i, size));
    changed = true;
  }
  return { room: changed ? next : room, changed, overflowItems, overflowFolders };
}
