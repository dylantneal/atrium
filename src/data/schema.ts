export type Id = string;

export type NodeKind = 'folder' | 'image' | 'video' | 'audio' | 'text' | 'markdown' | 'pdf' | 'model3d' | 'other';

export interface Pose {
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface Node {
  id: Id;
  parent: Id | null;
  kind: NodeKind;
  name: string;
  size: number;
  mtime: number;
  fingerprint: string;
  tags: string[];
  /** Dominant color as 0xRRGGBB, filled by the thumbnail pipeline. */
  color?: number;
  /** Spatial-only note, stored here so it survives external renames. */
  trashedFrom?: Id;
}

export type WallType = 'gallery' | 'shelf' | 'screen' | 'corkboard';
export type Side = 'N' | 'E' | 'S' | 'W';

export interface Slot {
  index: number;
  itemId: Id | null;
  locked: boolean;
}

export interface Wall {
  id: Id;
  side: Side;
  type: WallType;
  /** True once the user chose the type; heuristic never overrides it. */
  override: boolean;
  slots: Slot[];
}

export interface Door {
  id: Id;
  from: Id;
  to: Id;
  side: Side;
  /** Position along the wall, 0..1. */
  t: number;
  label: string;
  portal: boolean;
}

/** Landmarks are placed in normalized room coordinates (-1..1) so they survive footprint changes. */
export interface Landmark {
  kind: number;
  fx: number;
  fz: number;
}

export interface StyleParams {
  palette: number;
  /** East-west extent in metres. */
  width: number;
  /** North-south extent in metres. */
  depth: number;
  height: number;
  floor: number;
  trim: number;
  landmarks: Landmark[];
}

export interface RoomContext {
  px: number;
  pz: number;
  yaw: number;
  focusItem?: Id;
}

export type RoomKind = 'folder' | 'search' | 'saved-view';

export interface Room {
  id: Id;
  seed: number;
  style: StyleParams;
  walls: Wall[];
  doors: Door[];
  activity: number;
  context?: RoomContext;
  kind: RoomKind;
  title?: string;
  query?: string;
}

export interface Thread {
  id: Id;
  a: Id;
  b: Id;
  type: 'derived' | 'project' | 'reference';
  note?: string;
}

export interface Inventory {
  slots: (Id | null)[];
}

export interface VersionRef {
  id?: number;
  nodeId: Id;
  ts: number;
  blobKey: string;
  size: number;
}

export interface AccessEvent {
  id?: number;
  nodeId: Id;
  ts: number;
  type: 'open' | 'edit' | 'move';
}

export const SCHEMA_VERSION = 1;
export const INVENTORY_SLOTS = 8;
