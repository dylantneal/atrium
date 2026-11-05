import type { Side, StyleParams, WallType } from '../../data/schema';

/**
 * Pure room geometry. Everything here is derived from stored data (size, wall type, side),
 * so slot positions are never persisted and cannot drift.
 *
 * Coordinates: room centred on the origin, floor at y=0. N is -z, S is +z, W is -x, E is +x.
 * Along-wall coordinate u runs left to right as seen by someone standing inside facing the wall.
 */

export const SIDES: Side[] = ['N', 'E', 'W', 'S'];
export const DOOR_W = 1.4;
export const DOOR_H = 2.4;
/** Half-width of the wall span reserved for a door bay (door plus margin). */
export const BAY_HALF = 0.85;

export interface Size {
  w: number;
  d: number;
}

export const CLASSES: Size[] = [
  { w: 6, d: 6 },
  { w: 10, d: 8 },
  { w: 14, d: 12 },
  { w: 20, d: 16 },
];

export function wallLength(size: Size, side: Side): number {
  return side === 'N' || side === 'S' ? size.w : size.d;
}

/** Number of door bays on a wall of a given length. */
export function bayCount(length: number): number {
  return Math.max(1, Math.floor(length / 5));
}

/** Centre of bay i (0-based) along the wall. */
export function bayU(length: number, i: number): number {
  return (length * (i + 0.5)) / bayCount(length);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Frame {
  /** World position of the point on the wall plane at along-wall coordinate u, height y. */
  pos: Vec3;
  /** Rotation about Y so that the object's +z faces into the room. */
  ry: number;
  /** Unit vector pointing from the wall into the room (x, z). */
  nx: number;
  nz: number;
}

export function wallPoint(size: Size, side: Side, u: number, y: number, inset = 0): Frame {
  const hw = size.w / 2;
  const hd = size.d / 2;
  switch (side) {
    case 'N':
      return { pos: { x: -hw + u, y, z: -hd + inset }, ry: 0, nx: 0, nz: 1 };
    case 'S':
      return { pos: { x: hw - u, y, z: hd - inset }, ry: Math.PI, nx: 0, nz: -1 };
    case 'W':
      return { pos: { x: -hw + inset, y, z: hd - u }, ry: Math.PI / 2, nx: 1, nz: 0 };
    case 'E':
      return { pos: { x: hw - inset, y, z: -hd + u }, ry: -Math.PI / 2, nx: -1, nz: 0 };
  }
}

export interface SlotGeom {
  index: number;
  u: number;
  y: number;
  w: number;
  h: number;
  /** Extra in-plane rotation in radians (corkboard cards). */
  tilt: number;
  /** Large display slot. */
  main?: boolean;
}

export interface GridSpec {
  pitch: number;
  w: number;
  h: number;
  margin: number;
  rows: number[];
}

export function gridFor(type: WallType, height: number): GridSpec {
  switch (type) {
    case 'gallery':
      return { pitch: 1.7, w: 1.2, h: 0.8, margin: 0.4, rows: height >= 3.4 ? [1.25, 2.35] : [1.55] };
    case 'shelf':
      return { pitch: 0.95, w: 0.55, h: 0.66, margin: 0.4, rows: height >= 3.4 ? [0.55, 1.3, 2.05, 2.8] : [0.55, 1.3, 2.05] };
    case 'screen':
      return { pitch: 0.95, w: 0.8, h: 0.5, margin: 0.4, rows: [0.75] };
    case 'corkboard':
      return { pitch: 0.85, w: 0.6, h: 0.75, margin: 0.4, rows: height >= 3.4 ? [1.2, 2.2] : [1.7] };
  }
}

/** Free [start, end] spans of a wall once door bays are removed. */
export function freeSpans(length: number, margin: number): [number, number][] {
  const spans: [number, number][] = [];
  let cursor = margin;
  const k = bayCount(length);
  for (let i = 0; i < k; i++) {
    const c = bayU(length, i);
    const a = c - BAY_HALF;
    if (a > cursor) spans.push([cursor, a]);
    cursor = Math.max(cursor, c + BAY_HALF);
  }
  if (length - margin > cursor) spans.push([cursor, length - margin]);
  return spans;
}

/** Deterministic cork-card jitter so cards look hand-pinned but never change. */
function jitter(seed: number, i: number): number {
  let x = (seed ^ (i * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296 - 0.5;
}

export function slotGeometry(size: Size, side: Side, type: WallType, height: number, seed: number): SlotGeom[] {
  const g = gridFor(type, height);
  const length = wallLength(size, side);
  const out: SlotGeom[] = [];
  let index = 0;

  if (type === 'screen') {
    // Slot 0 is the large display, placed in the widest free span; the rest form a filmstrip below it.
    const spans = freeSpans(length, g.margin);
    const widest = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), spans[0] ?? [g.margin, length - g.margin]);
    const mainW = Math.min(3.2, widest[1] - widest[0]);
    if (mainW >= 1.6) {
      out.push({ index: index++, u: (widest[0] + widest[1]) / 2, y: 2.0, w: mainW, h: mainW * (9 / 16), tilt: 0, main: true });
    }
    for (const [a, b] of spans) {
      const n = Math.floor((b - a) / g.pitch);
      const start = (a + b) / 2 - ((n - 1) * g.pitch) / 2;
      for (let i = 0; i < n; i++) out.push({ index: index++, u: start + i * g.pitch, y: g.rows[0], w: g.w, h: g.h, tilt: 0 });
    }
    return out;
  }

  for (const y of g.rows) {
    for (const [a, b] of freeSpans(length, g.margin)) {
      const n = Math.floor((b - a + (g.pitch - g.w)) / g.pitch);
      const start = (a + b) / 2 - ((n - 1) * g.pitch) / 2;
      for (let i = 0; i < n; i++) {
        const tilt = type === 'corkboard' ? jitter(seed, index) * 0.12 : 0;
        const du = type === 'corkboard' ? jitter(seed, index + 1000) * 0.08 : 0;
        out.push({ index: index++, u: start + i * g.pitch + du, y, w: g.w, h: g.h, tilt });
      }
    }
  }
  return out;
}

export function slotCapacity(size: Size, side: Side, type: WallType, height: number): number {
  return slotGeometry(size, side, type, height, 0).length;
}

/** World-space pose of a slot. */
export function slotPose(size: Size, side: Side, geom: SlotGeom, inset: number): Frame {
  return wallPoint(size, side, geom.u, geom.y, inset);
}

export function sizeOf(style: Pick<StyleParams, 'width' | 'depth'>): Size {
  return { w: style.width, d: style.depth };
}

/** World x/z of a landmark. Small rooms push landmarks to the sides so they never stand in the entrance view. */
export function landmarkPos(size: Size, fx: number, fz: number): { x: number; z: number } {
  if (size.w <= 6) {
    const side = fx >= 0 ? 1 : -1;
    return { x: side * (1.35 + 0.65 * Math.min(1, Math.abs(fx) / 0.6)), z: fz * 0.9 };
  }
  return { x: fx * (size.w / 2 - 2.2), z: fz * (size.d / 2 - 2.2) };
}
