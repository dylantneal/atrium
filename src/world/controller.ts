import type * as THREE from 'three';
import type { Door } from '../data/schema';
import type { Input } from './input';
import type { RoomView } from './roomView';

export const PLAYER_RADIUS = 0.5;
export const EYE_HEIGHT = 1.6;
const WALK = 3.5;
const SPRINT = 5.6;

/** First-person movement with room collision. Position is x/z on the floor; the camera sits at eye height. */
export class PlayerController {
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  /** Set when the player walks into a doorway; the session consumes it. */
  pendingDoor: Door | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.pendingDoor = null;
    this.apply();
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0045;
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch - dy * 0.0045));
  }

  update(dt: number, input: Input, view: RoomView | null) {
    const m = input.poll();
    this.yaw += input.turn * 1.9 * dt;
    if (view && !this.pendingDoor) {
      const speed = input.sprint ? SPRINT : WALK;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let vx = (fx * m.y + rx * m.x) * speed;
      let vz = (fz * m.y + rz * m.x) * speed;
      const len = Math.hypot(vx, vz);
      if (len > speed) {
        vx = (vx / len) * speed;
        vz = (vz / len) * speed;
      }
      if (len > 1e-4) {
        const next = view.resolve(this.x + vx * dt, this.z + vz * dt, PLAYER_RADIUS);
        this.x = next.x;
        this.z = next.z;
        const door = view.doorEntered(this.x, this.z, vx, vz);
        if (door) this.pendingDoor = door;
      }
    }
    this.apply();
  }

  private apply() {
    this.camera.position.set(this.x, EYE_HEIGHT, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
