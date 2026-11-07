import type * as THREE from 'three';
import type { Door, Id, Room, Side } from '../data/schema';
import type { AmbientSnapshot } from '../apps/ambient/ambient';
import type { ItemInfo } from './itemTiles';

export interface DoorInfo {
  name: string;
  /** Item count in the target, when known. */
  count?: number;
  isParent: boolean;
  /** Activity of the room behind the door (0..1) and how long it has sat untouched. */
  activity?: number;
  idleDays?: number;
}

export type Pick =
  | { type: 'item'; itemId: Id; side: Side; slot: number; distance: number }
  | { type: 'door'; door: Door; distance: number }
  | { type: 'slot'; side: Side; slot: number; distance: number }
  /** Something an app placed in the world (a calendar card, a window, a keypad key). */
  | { type: 'object'; appId: string; objectId: string; distance: number };

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

/**
 * What the session needs from any room it can put the player in. Folder rooms (`RoomView`) implement it, and so do
 * rooms that apps provide (the Hall, the weather deck, the calendar's time hall). Everything optional has a safe no-op
 * default in `RoomBase`.
 */
export interface RoomLike {
  readonly group: THREE.Group;
  /** Door graph and identity. App rooms supply a synthetic `Room` (kind 'app') with doors and no wall slots. */
  readonly room: Room;
  spawn(from: Id | null): Spawn;
  spawnBefore(door: Door, dist: number): Spawn;
  /** Keep a circle of radius r inside the walkable area. */
  resolve(x: number, z: number, r: number): { x: number; z: number };
  doorEntered(x: number, z: number, vx: number, vz: number): Door | null;
  pick(camera: THREE.Camera, ndcX?: number, ndcY?: number, maxDist?: number): Pick | null;
  /** Per-frame update (light easing, animations). */
  tick(dt: number): void;
  setHeld(held: Set<Id>): void;
  setCarrying(on: boolean, held: Set<Id>): void;
  setActivityTarget(a: number): void;
  /** The sky and clock changed: windows, daylight and the wall clock follow. */
  setAmbient(a: AmbientSnapshot): void;
  setDoorState(doorId: string, info: DoorInfo): void;
  doorBrightness(doorId: string): number | null;
  itemOrder(): Id[];
  itemPose(itemId: Id): { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null;
  refreshItem(item: ItemInfo): void;
  /** Resolves when textures and previews are painted (tests wait on this). */
  whenSettled(): Promise<void>;
  readonly itemCount: number;
  appearance(): { cobwebs: number; glowing: number; activity: number; dustiestBlue: number };
  dispose(): void;
}
