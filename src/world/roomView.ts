import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Door, Id, Room, Side, WallType } from '../data/schema';
import { Atlas } from './atlas';
import { DOOR_H, DOOR_W, freeSpans, gridFor, landmarkPos, SIDES, slotGeometry, slotPose, sizeOf, wallLength, wallPoint, type SlotGeom } from './generator/layout';
import { LANDMARK_RADIUS, PALETTES } from './generator/rooms';
import { fillTile, type ItemInfo } from './itemTiles';
import type { ThumbService } from './thumbs';
import type { VFS } from '../vfs/vfs';
import { hex } from './tiles';

export interface DoorInfo {
  name: string;
  /** Item count in the target, when known. */
  count?: number;
  isParent: boolean;
}

export type Pick = { type: 'item'; itemId: Id; side: Side; slot: number; distance: number } | { type: 'door'; door: Door; distance: number };

export interface RoomViewDeps {
  room: Room;
  items: Map<Id, ItemInfo>;
  doorInfo: (d: Door) => DoorInfo;
  renderer: THREE.WebGLRenderer;
  vfs: VFS;
  thumbs: ThumbService;
  /** Items that did not fit: shown as a "+N more" note. */
  overflowCount?: number;
}

interface PicInstance {
  itemId: Id;
  side: Side;
  slot: number;
  matrix: THREE.Matrix4;
}

const TILE_ASPECT = 256 / 160;

function lambert(color: number) {
  return new THREE.MeshLambertMaterial({ color });
}

function labelTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Everything for one room: geometry, lights, pictures, picking and collision. Disposable. */
export class RoomView {
  readonly group = new THREE.Group();
  readonly room: Room;
  readonly size;
  readonly height: number;
  private atlas: Atlas;
  private pics!: THREE.InstancedMesh;
  private picInstances: PicInstance[] = [];
  private doorPanels: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private hemi: THREE.HemisphereLight;
  private picMat!: THREE.MeshBasicMaterial;
  private circles: { x: number; z: number; r: number }[] = [];
  private alive = true;
  private loading: Promise<void>[] = [];
  private tileOf = new Map<Id, number>();
  private disposables: { dispose(): void }[] = [];
  private activity = 0.5;

  constructor(private deps: RoomViewDeps) {
    this.room = deps.room;
    this.size = sizeOf(deps.room.style);
    this.height = deps.room.style.height;
    const pal = PALETTES[deps.room.style.palette];

    // Pictures that will be drawn, in wall order
    const wanted: { itemId: Id; side: Side; slot: number; geom: SlotGeom; type: WallType }[] = [];
    for (const wall of deps.room.walls) {
      const geoms = slotGeometry(this.size, wall.side, wall.type, this.height, deps.room.seed + SIDES.indexOf(wall.side));
      for (const slot of wall.slots) {
        const g = geoms[slot.index];
        if (slot.itemId && g && deps.items.has(slot.itemId)) wanted.push({ itemId: slot.itemId, side: wall.side, slot: slot.index, geom: g, type: wall.type });
      }
    }
    this.atlas = new Atlas(deps.renderer, wanted.length);
    this.hemi = new THREE.HemisphereLight(pal.ceil, pal.floor, 0.5);
    this.group.add(this.hemi);

    this.buildShell(pal);
    this.buildDoors(pal);
    this.buildWallFurniture(wanted, pal);
    this.buildLandmarks(pal);
    this.buildLights(pal);
    this.buildPictures(wanted);
    this.setActivity(deps.room.activity);
  }

  // ---------------------------------------------------------------- shell

  private rectsFor(side: Side, withLintels: boolean): { u0: number; u1: number; y0: number; y1: number }[] {
    const L = wallLength(this.size, side);
    const H = this.height;
    const holes = this.room.doors
      .filter((d) => d.side === side)
      .map((d) => {
        const uc = d.t * L;
        return [uc - DOOR_W / 2, uc + DOOR_W / 2] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    const rects: { u0: number; u1: number; y0: number; y1: number }[] = [];
    let cursor = 0;
    for (const [a, b] of holes) {
      if (a > cursor) rects.push({ u0: cursor, u1: a, y0: 0, y1: H });
      if (withLintels) rects.push({ u0: a, u1: b, y0: DOOR_H, y1: H });
      cursor = b;
    }
    if (cursor < L) rects.push({ u0: cursor, u1: L, y0: 0, y1: H });
    return rects;
  }

  private planeAt(side: Side, u0: number, u1: number, y0: number, y1: number, inset = 0) {
    const f = wallPoint(this.size, side, (u0 + u1) / 2, (y0 + y1) / 2, inset);
    const g = new THREE.PlaneGeometry(u1 - u0, y1 - y0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(f.ry).setPosition(f.pos.x, f.pos.y, f.pos.z));
    return g;
  }

  /** Box whose back face sits `inset` metres off the wall, centred along-wall at u and at height y. */
  private boxAt(side: Side, u: number, y: number, w: number, h: number, depth: number, inset: number) {
    const f = wallPoint(this.size, side, u, y, inset + depth / 2);
    const g = new THREE.BoxGeometry(w, h, depth);
    const m = new THREE.Matrix4().makeRotationY(f.ry).setPosition(f.pos.x + f.nx * 0, f.pos.y, f.pos.z);
    // wallPoint already offsets by `inset` along the normal
    g.applyMatrix4(m);
    return g;
  }

  private mesh(geoms: THREE.BufferGeometry[], mat: THREE.Material) {
    if (geoms.length === 0) return null;
    const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false)!;
    for (const x of geoms) if (x !== g) x.dispose();
    const m = new THREE.Mesh(g, mat);
    this.group.add(m);
    this.disposables.push(g, mat);
    return m;
  }

  private buildShell(pal: (typeof PALETTES)[number]) {
    const { w, d } = this.size;
    const H = this.height;

    const wallGeoms: THREE.BufferGeometry[] = [];
    const trimGeoms: THREE.BufferGeometry[] = [];
    for (const side of SIDES) {
      for (const r of this.rectsFor(side, true)) wallGeoms.push(this.planeAt(side, r.u0, r.u1, r.y0, r.y1));
      for (const r of this.rectsFor(side, false)) {
        const um = (r.u0 + r.u1) / 2;
        trimGeoms.push(this.boxAt(side, um, 0.07, r.u1 - r.u0, 0.14, 0.04, 0));
        trimGeoms.push(this.boxAt(side, um, H - 0.06, r.u1 - r.u0, 0.12, 0.06, 0));
      }
    }
    this.mesh(wallGeoms, lambert(pal.wall));
    this.mesh(trimGeoms, lambert(pal.trim));

    // floor
    const pattern = this.floorTexture(pal);
    pattern.repeat.set(w / 2, d / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: pattern }));
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    this.disposables.push(floor.geometry, floor.material as THREE.Material, pattern);

    // ceiling with light panels
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.ceil).multiplyScalar(0.6) }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    this.group.add(ceil);
    this.disposables.push(ceil.geometry, ceil.material as THREE.Material);
  }

  private floorTexture(pal: (typeof PALETTES)[number]) {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d')!;
    const base = new THREE.Color(pal.floor);
    const shade = (k: number) => '#' + base.clone().multiplyScalar(k).getHexString();
    const pattern = this.room.style.floor;
    g.fillStyle = shade(1);
    g.fillRect(0, 0, s, s);
    let seed = this.room.seed;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    if (pattern === 0) {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = shade(0.82 + rnd() * 0.35);
        g.fillRect(0, i * 16, s, 15);
        g.fillStyle = shade(0.6);
        g.fillRect(0, i * 16 + 15, s, 1);
      }
    } else if (pattern === 1) {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        g.fillStyle = shade(0.9 + rnd() * 0.25);
        g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
    } else if (pattern === 2) {
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = shade(0.8 + rnd() * 0.4);
        g.fillRect(rnd() * s, rnd() * s, 2, 2);
      }
    } else {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? shade(1.25) : shade(0.75);
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // ---------------------------------------------------------------- doors

  private buildDoors(pal: (typeof PALETTES)[number]) {
    const frameGeoms: THREE.BufferGeometry[] = [];
    for (const door of this.room.doors) {
      const L = wallLength(this.size, door.side);
      const uc = door.t * L;
      const info = this.deps.doorInfo(door);
      const post = 0.12;
      frameGeoms.push(this.boxAt(door.side, uc - DOOR_W / 2 - post / 2, DOOR_H / 2, post, DOOR_H, 0.16, 0));
      frameGeoms.push(this.boxAt(door.side, uc + DOOR_W / 2 + post / 2, DOOR_H / 2, post, DOOR_H, 0.16, 0));
      frameGeoms.push(this.boxAt(door.side, uc, DOOR_H + post / 2, DOOR_W + post * 2, post, 0.16, 0));

      const targetPal = PALETTES[Math.abs(hashStr(door.to)) % PALETTES.length];
      const tex = labelTexture((g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#0d0b12');
        grad.addColorStop(0.75, hex(targetPal.wall));
        grad.addColorStop(1, hex(targetPal.accent));
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.ellipse(w / 2, h * 0.62, w * 0.34, h * 0.36, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = '700 30px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(info.isParent ? '↑' : '→', w / 2, h - 34);
      }, 128, 192);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), new THREE.MeshBasicMaterial({ map: tex }));
      const f = wallPoint(this.size, door.side, uc, DOOR_H / 2, -0.12);
      panel.position.set(f.pos.x, f.pos.y, f.pos.z);
      panel.rotation.y = f.ry;
      panel.userData.doorId = door.id;
      this.group.add(panel);
      this.doorPanels.push(panel);
      this.disposables.push(panel.geometry, panel.material as THREE.Material, tex);

      // name plate above the door
      const label = info.isParent ? `Up: ${info.name}` : info.name;
      const sub = info.isParent ? '' : info.count !== undefined ? `${info.count} item${info.count === 1 ? '' : 's'}` : '';
      const ltex = labelTexture((g, w, h) => {
        g.fillStyle = 'rgba(16,13,22,0.88)';
        g.beginPath();
        g.roundRect(0, 0, w, h, 14);
        g.fill();
        g.fillStyle = '#f4eff9';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        let size = 40;
        g.font = `700 ${size}px system-ui, sans-serif`;
        while (g.measureText(label).width > w - 30 && size > 12) {
          size -= 2;
          g.font = `700 ${size}px system-ui, sans-serif`;
        }
        g.fillText(label, w / 2, sub ? h * 0.38 : h / 2);
        if (sub) {
          g.fillStyle = '#b9b0c8';
          g.font = '500 24px system-ui, sans-serif';
          g.fillText(sub, w / 2, h * 0.74);
        }
      }, 512, 128);
      const lm = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), new THREE.MeshBasicMaterial({ map: ltex, transparent: true }));
      const lf = wallPoint(this.size, door.side, uc, Math.min(DOOR_H + 0.4, this.height - 0.25), 0.03);
      lm.position.set(lf.pos.x, lf.pos.y, lf.pos.z);
      lm.rotation.y = lf.ry;
      this.group.add(lm);
      this.disposables.push(lm.geometry, lm.material as THREE.Material, ltex);
    }
    this.mesh(frameGeoms, lambert(pal.trim));
  }

  // ---------------------------------------------------------------- wall furniture and pictures

  private buildWallFurniture(wanted: { itemId: Id; side: Side; slot: number; geom: SlotGeom; type: WallType }[], pal: (typeof PALETTES)[number]) {
    const wood: THREE.BufferGeometry[] = [];
    const dark: THREE.BufferGeometry[] = [];
    const back: THREE.BufferGeometry[] = [];
    const cork: THREE.BufferGeometry[] = [];
    const H = this.height;
    for (const wall of this.room.walls) {
      const L = wallLength(this.size, wall.side);
      const spec = gridFor(wall.type, H);
      const spans = freeSpans(L, spec.margin);
      if (wall.type === 'shelf') {
        const top = spec.rows[spec.rows.length - 1] + spec.h / 2 + 0.06;
        const bottom = 0.1;
        for (const [a, b] of spans) {
          const n = Math.floor((b - a + (spec.pitch - spec.w)) / spec.pitch);
          if (n <= 0) continue;
          const len = n * spec.pitch;
          const mid = (a + b) / 2;
          back.push(this.boxAt(wall.side, mid, (top + bottom) / 2, len, top - bottom, 0.02, 0));
          for (const ry of [...spec.rows.map((r) => r - spec.h / 2 - 0.03), top]) wood.push(this.boxAt(wall.side, mid, ry, len, 0.04, 0.38, 0));
          for (const e of [mid - len / 2, mid + len / 2]) wood.push(this.boxAt(wall.side, e, (top + bottom) / 2, 0.04, top - bottom, 0.38, 0));
        }
      } else if (wall.type === 'corkboard') {
        const top = spec.rows[spec.rows.length - 1] + 0.55;
        const bottom = spec.rows[0] - 0.55;
        for (const [a, b] of spans) {
          const n = Math.floor((b - a + (spec.pitch - spec.w)) / spec.pitch);
          if (n <= 0) continue;
          const len = n * spec.pitch + 0.2;
          cork.push(this.boxAt(wall.side, (a + b) / 2, (top + bottom) / 2, len, top - bottom, 0.03, 0.005));
        }
      } else if (wall.type === 'screen') {
        const geoms = slotGeometry(this.size, wall.side, 'screen', H, this.room.seed + SIDES.indexOf(wall.side));
        const main = geoms.find((g) => g.main);
        if (main) dark.push(this.boxAt(wall.side, main.u, main.y, main.w + 0.22, main.h + 0.22, 0.04, 0.01));
        for (const [a, b] of spans) dark.push(this.boxAt(wall.side, (a + b) / 2, spec.rows[0], b - a, 0.7, 0.025, 0.01));
      }
    }
    for (const p of wanted) {
      if (p.type !== 'gallery') continue;
      const { pw, ph } = this.fit(p.geom);
      wood.push(this.boxAt(p.side, p.geom.u, p.geom.y, pw + 0.12, ph + 0.12, 0.05, 0.0));
    }
    const woodColor = new THREE.Color(pal.trim).lerp(new THREE.Color(0xc8a77a), 0.45);
    const backColor = new THREE.Color(pal.wall).multiplyScalar(0.45);
    this.mesh(wood, lambert(woodColor.getHex()));
    this.mesh(back, lambert(backColor.getHex()));
    this.mesh(dark, lambert(0x15131a));
    this.mesh(cork, lambert(0x9c6b3f));
  }

  private fit(g: SlotGeom) {
    const pw = Math.min(g.w, g.h * TILE_ASPECT);
    return { pw, ph: pw / TILE_ASPECT };
  }

  private buildPictures(wanted: { itemId: Id; side: Side; slot: number; geom: SlotGeom; type: WallType }[]) {
    const count = Math.min(wanted.length, this.atlas.capacity);
    const geom = new THREE.PlaneGeometry(1, 1);
    const uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * 4), 4);
    geom.setAttribute('instUV', uvAttr);
    this.picMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture });
    this.picMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 instUV;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * instUV.zw + instUV.xy;\n#endif');
    };
    this.pics = new THREE.InstancedMesh(geom, this.picMat, Math.max(count, 1));
    this.pics.count = count;
    this.pics.frustumCulled = false;
    const q = new THREE.Quaternion();
    const qz = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const p = wanted[i];
      const { pw, ph } = this.fit(p.geom);
      const inset = p.type === 'gallery' ? 0.056 : p.type === 'shelf' ? 0.2 : p.type === 'screen' ? (p.geom.main ? 0.06 : 0.05) : 0.05;
      const yPic = p.type === 'shelf' ? p.geom.y - p.geom.h / 2 + 0.015 + ph / 2 : p.geom.y;
      const f = slotPose(this.size, p.side, { ...p.geom, y: yPic }, inset);
      e.set(0, f.ry, 0);
      q.setFromEuler(e);
      qz.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.geom.tilt);
      q.multiply(qz);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z), q, new THREE.Vector3(pw, ph, 1));
      this.pics.setMatrixAt(i, m);
      this.picInstances.push({ itemId: p.itemId, side: p.side, slot: p.slot, matrix: m });
      const tile = this.atlas.allocate()!;
      this.tileOf.set(p.itemId, tile);
      const uv = this.atlas.uvRect(tile);
      uvAttr.setXYZW(i, uv[0], uv[1], uv[2], uv[3]);
      const item = this.deps.items.get(p.itemId)!;
      this.loading.push(fillTile(this.atlas, tile, item, this.deps.vfs, this.deps.thumbs, () => this.alive));
    }
    this.atlas.commit();
    this.pics.instanceMatrix.needsUpdate = true;
    uvAttr.needsUpdate = true;
    this.pics.computeBoundingSphere();
    this.group.add(this.pics);
    this.disposables.push(geom, this.picMat, this.atlas);
  }

  // ---------------------------------------------------------------- landmarks

  private buildLandmarks(pal: (typeof PALETTES)[number]) {
    const H = this.height;
    const stone = lambert(0xcfc8bd);
    const accent = lambert(pal.accent);
    this.disposables.push(stone, accent);
    for (const lm of this.room.style.landmarks) {
      const { x, z } = landmarkPos(this.size, lm.fx, lm.fz);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px = 0, py = 0, pz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        g.add(m);
        this.disposables.push(geo);
        return m;
      };
      switch (lm.kind) {
        case 0:
          add(new THREE.CylinderGeometry(0.3, 0.34, H, 18), accent, 0, H / 2);
          add(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 18), stone, 0, 0.06);
          break;
        case 1: {
          add(new THREE.CylinderGeometry(1.0, 1.05, 0.45, 28), stone, 0, 0.225);
          const water = new THREE.MeshBasicMaterial({ color: 0x66c7e8 });
          this.disposables.push(water);
          add(new THREE.CylinderGeometry(0.88, 0.88, 0.02, 28), water, 0, 0.44);
          add(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 12), stone, 0, 0.7);
          break;
        }
        case 2:
          for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.8 - i * 0.3, 0.18, 1.0 - i * 0.1), i % 2 ? stone : accent, 0, 0.09 + i * 0.18);
          break;
        case 3: {
          const beam = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
          const panel = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
          this.disposables.push(beam, panel);
          const p = add(new THREE.PlaneGeometry(2.2, 2.2), panel, 0, H - 0.02);
          p.rotation.x = Math.PI / 2;
          add(new THREE.CylinderGeometry(1.0, 1.7, H - 0.1, 4, 1, true), beam, 0, (H - 0.1) / 2).rotation.y = Math.PI / 4;
          break;
        }
        case 4:
          add(new THREE.BoxGeometry(0.7, 0.6, 0.7), stone, 0, 0.3);
          add(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 12), accent, 0, 1.05);
          add(new THREE.SphereGeometry(0.2, 16, 12), accent, 0, 1.7);
          break;
        case 5: {
          const leaf = lambert(0x3f8a4f);
          this.disposables.push(leaf);
          add(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 14), lambert(0x8a5a3a), 0, 0.225);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const c = add(new THREE.ConeGeometry(0.16, 1.1, 8), leaf, Math.cos(a) * 0.16, 0.95, Math.sin(a) * 0.16);
            c.rotation.z = Math.cos(a) * 0.3;
            c.rotation.x = -Math.sin(a) * 0.3;
          }
          break;
        }
        case 6: {
          const rug = new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.accent).lerp(new THREE.Color(pal.floor), 0.55) });
          this.disposables.push(rug);
          const r = add(new THREE.CircleGeometry(1.3, 36), rug, 0, 0.012);
          r.rotation.x = -Math.PI / 2;
          break;
        }
        case 7: {
          const bulb = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
          this.disposables.push(bulb);
          add(new THREE.CylinderGeometry(0.03, 0.05, 1.6, 8), lambert(0x222222), 0, 0.8);
          add(new THREE.SphereGeometry(0.16, 14, 10), bulb, 0, 1.7);
          break;
        }
      }
      this.group.add(g);
      if (LANDMARK_RADIUS[lm.kind] > 0) this.circles.push({ x, z, r: LANDMARK_RADIUS[lm.kind] });
    }
    this.disposables.push(stone, accent);
  }

  // ---------------------------------------------------------------- lights

  private buildLights(pal: (typeof PALETTES)[number]) {
    const { w, d } = this.size;
    const n = w * d > 140 ? 4 : w * d > 60 ? 3 : 2;
    const long = w >= d;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const l = new THREE.PointLight(0xffe2bd, 1, Math.max(w, d) * 1.1, 1.4);
      l.position.set(long ? t * w * 0.8 : 0, this.height - 0.4, long ? 0 : t * d * 0.8);
      this.group.add(l);
      this.lights.push(l);
      const fix = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
      fix.position.copy(l.position).setY(this.height - 0.02);
      this.group.add(fix);
      this.disposables.push(fix.geometry, fix.material as THREE.Material);
    }
    void pal;
  }

  /** Light as attention: bright and warm when active, dim and cool-grey when dormant. */
  setActivity(a: number) {
    this.activity = a;
    const warm = new THREE.Color(0xffb878);
    const neutral = new THREE.Color(0xfff0e0);
    for (const l of this.lights) {
      l.intensity = (6 + 22 * a) / Math.max(1, this.lights.length * 0.55);
      l.color.copy(warm).lerp(neutral, 1 - a * 0.6);
    }
    this.hemi.intensity = 0.22 + 0.42 * a;
    this.picMat.color.setScalar(0.5 + 0.5 * a);
  }

  // ---------------------------------------------------------------- queries

  /** Where to stand on arrival. `from` is the room we came through (if any). */
  spawn(from: Id | null): { x: number; z: number; yaw: number } {
    const door = from ? this.room.doors.find((d) => d.to === from) : undefined;
    const d0 = door ?? this.room.doors.find((d) => d.side === 'S');
    if (d0) {
      const L = wallLength(this.size, d0.side);
      const f = wallPoint(this.size, d0.side, d0.t * L, 0, 1.6);
      return { x: f.pos.x, z: f.pos.z, yaw: Math.atan2(-f.nx, -f.nz) };
    }
    return { x: 0, z: this.size.d / 2 - 1.8, yaw: 0 };
  }

  /** A spot `dist` metres in front of a door, facing it. */
  spawnBefore(door: Door, dist: number): { x: number; z: number; yaw: number } {
    const f = wallPoint(this.size, door.side, door.t * wallLength(this.size, door.side), 0, dist);
    return { x: f.pos.x, z: f.pos.z, yaw: Math.atan2(f.nx, f.nz) };
  }

  /** Keeps a point of radius r inside the room, out of solid landmarks, and lets it reach a doorway. */
  resolve(x: number, z: number, r: number): { x: number; z: number } {
    const hw = this.size.w / 2;
    const hd = this.size.d / 2;
    let px = Math.min(hw - r, Math.max(-hw + r, x));
    let pz = Math.min(hd - r, Math.max(-hd + r, z));
    for (const door of this.room.doors) {
      const f = wallPoint(this.size, door.side, door.t * wallLength(this.size, door.side), 0, 0);
      const tx = Math.cos(f.ry);
      const tz = -Math.sin(f.ry);
      const lateral = (x - f.pos.x) * tx + (z - f.pos.z) * tz;
      const dist = (x - f.pos.x) * f.nx + (z - f.pos.z) * f.nz;
      if (Math.abs(lateral) < 0.5 && dist < r) {
        const dd = Math.max(dist, 0.3);
        px = f.pos.x + f.nx * dd + tx * lateral;
        pz = f.pos.z + f.nz * dd + tz * lateral;
      }
    }
    for (const c of this.circles) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const dist = Math.hypot(dx, dz);
      const min = c.r + r;
      if (dist < min && dist > 1e-6) {
        px = c.x + (dx / dist) * min;
        pz = c.z + (dz / dist) * min;
      }
    }
    return { x: px, z: pz };
  }

  /** The door the player is walking into, if any. */
  doorEntered(x: number, z: number, vx: number, vz: number): Door | null {
    for (const door of this.room.doors) {
      const f = wallPoint(this.size, door.side, door.t * wallLength(this.size, door.side), 0, 0);
      const tx = Math.cos(f.ry);
      const tz = -Math.sin(f.ry);
      const lateral = (x - f.pos.x) * tx + (z - f.pos.z) * tz;
      const dist = (x - f.pos.x) * f.nx + (z - f.pos.z) * f.nz;
      const toward = vx * f.nx + vz * f.nz;
      if (Math.abs(lateral) < 0.55 && dist < 0.62 && toward < -0.05) return door;
    }
    return null;
  }

  private ray = new THREE.Raycaster();
  /** Raycast from the camera through NDC (x, y); nearest item or door within 7 m. */
  pick(camera: THREE.Camera, ndcX = 0, ndcY = 0, maxDist = 7): Pick | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([this.pics, ...this.doorPanels], false);
    for (const h of hits) {
      if (h.object === this.pics && h.instanceId !== undefined) {
        const inst = this.picInstances[h.instanceId];
        if (inst) return { type: 'item', itemId: inst.itemId, side: inst.side, slot: inst.slot, distance: h.distance };
      } else {
        const door = this.room.doors.find((d) => d.id === h.object.userData.doorId);
        if (door) return { type: 'door', door, distance: h.distance };
      }
    }
    return null;
  }

  /** World-space centre and facing of an item's picture (used by the focus-mode camera fly). */
  itemPose(itemId: Id): { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null {
    const inst = this.picInstances.find((p) => p.itemId === itemId);
    if (!inst) return null;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    inst.matrix.decompose(pos, quat, scale);
    return { pos, quat, scale };
  }

  /** Resolves when every thumbnail and preview in the room has been painted (tests wait on this). */
  whenSettled(): Promise<void> {
    return Promise.all(this.loading).then(() => undefined);
  }

  /** Items in wall order, for previous/next stepping. */
  itemOrder(): Id[] {
    return this.picInstances.map((p) => p.itemId);
  }

  /** Repaint one item's tile after its name or content changed. */
  refreshItem(item: ItemInfo) {
    const tile = this.tileOf.get(item.id);
    if (tile === undefined) return;
    this.deps.items.set(item.id, item);
    this.loading.push(fillTile(this.atlas, tile, item, this.deps.vfs, this.deps.thumbs, () => this.alive));
  }

  get itemCount() {
    return this.picInstances.length;
  }

  dispose() {
    this.alive = false;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
    });
    for (const d of this.disposables) d.dispose();
    this.pics.dispose();
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
