import * as THREE from 'three';
import type { Door, Id, Room, StyleParams } from '../data/schema';
import { bayCount, wallLength } from '../world/generator/layout';
import { doorAt } from '../world/generator/rooms';
import type { Pick } from '../world/roomLike';
import { RoomView, type RoomViewDeps } from '../world/roomView';
import { hash32 } from '../util/hash';
import type { Side } from '../data/schema';

export interface AppRoomDoor {
  to: Id;
  label: string;
  side: Side;
  /** Bay index along that wall (0 is the first from the left as seen from inside). */
  bay: number;
}

export interface AppRoomData {
  id: Id;
  title: string;
  width: number;
  depth: number;
  height?: number;
  palette?: number;
  /** Where the Back door leads (it sits on the south wall, bay 0). */
  backTo: Id;
  doors?: AppRoomDoor[];
  activity?: number;
}

/** The `Room` record for a room an app provides: a rectangle with doors and no wall slots. Never persisted. */
export function makeAppRoom(d: AppRoomData): Room {
  const size = { w: d.width, d: d.depth };
  const style: StyleParams = { palette: d.palette ?? 5, width: d.width, depth: d.depth, height: d.height ?? 3.6, floor: 0, trim: 0, landmarks: [] };
  const doors: Door[] = [doorAt(d.id, d.backTo, 'Back', 'S', 0, size)];
  for (const x of d.doors ?? []) {
    const k = bayCount(wallLength(size, x.side));
    if (x.bay < 0 || x.bay >= k) throw new Error(`${d.id}: wall ${x.side} has ${k} bays, no bay ${x.bay}`);
    doors.push(doorAt(d.id, x.to, x.label, x.side, x.bay, size));
  }
  return { id: d.id, seed: hash32(d.id), style, walls: [], doors, activity: d.activity ?? 0.7, kind: 'app', title: d.title };
}

/**
 * A folder-style room (shell, doors, light, windows later) that apps decorate with their own 3D objects.
 * Objects are registered with an id so taps and the crosshair can find them; the room owns disposal.
 */
export class AppRoom extends RoomView {
  private objects: THREE.Object3D[] = [];
  private objRay = new THREE.Raycaster();
  private disposers: (() => void)[] = [];
  /** Called every frame, after the base room has updated. */
  onTick: ((dt: number) => void) | null = null;

  constructor(deps: RoomViewDeps, private appId: string) {
    super(deps);
  }

  addObject(obj: THREE.Object3D, objectId: string) {
    obj.userData.appObject = { appId: this.appId, objectId };
    obj.traverse((o) => (o.userData.appObjectRoot = obj));
    this.group.add(obj);
    this.objects.push(obj);
    return obj;
  }

  /** Run when the room is torn down (unsubscribe from services here). */
  addDisposer(fn: () => void) {
    this.disposers.push(fn);
  }

  /** Plain, unpickable decoration (still disposed with the room). */
  addDecor(obj: THREE.Object3D) {
    this.group.add(obj);
    this.objects.push(obj);
    return obj;
  }

  override tick(dt: number) {
    super.tick(dt);
    this.onTick?.(dt);
  }

  override pick(camera: THREE.Camera, ndcX = 0, ndcY = 0, maxDist = 7): Pick | null {
    const base = super.pick(camera, ndcX, ndcY, maxDist);
    this.objRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    this.objRay.far = maxDist;
    const targets = this.objects.filter((o) => o.userData.appObject);
    const hits = this.objRay.intersectObjects(targets, true);
    for (const h of hits) {
      const root = (h.object.userData.appObjectRoot ?? h.object) as THREE.Object3D;
      const info = root.userData.appObject as { appId: string; objectId: string } | undefined;
      if (info && (!base || h.distance < base.distance)) return { type: 'object', appId: info.appId, objectId: info.objectId, distance: h.distance };
    }
    return base;
  }

  override dispose() {
    for (const d of this.disposers) d();
    this.disposers = [];
    for (const o of this.objects) {
      o.traverse((n) => {
        const m = n as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          (mat as THREE.MeshBasicMaterial).map?.dispose?.();
          mat.dispose();
        }
      });
    }
    this.objects = [];
    super.dispose();
  }
}
