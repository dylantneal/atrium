import * as THREE from 'three';
import type { ActionBus } from '../core/actions';
import { ui } from '../core/uiState';
import { getRoom, getSetting, putRoom, setSetting } from '../data/idb';
import type { Door, Id, Node, Room } from '../data/schema';
import type { VFS } from '../vfs/vfs';
import { PlayerController } from './controller';
import { generateRoom, reconcileRoom } from './generator/rooms';
import { Input, type TapEvent } from './input';
import { infoOf, type ItemInfo } from './itemTiles';
import type { Change } from '../vfs/vfs';
import { RoomView, type DoorInfo } from './roomView';
import type { World } from './scene';
import { ThumbService } from './thumbs';

const FADE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ago(ms: number): string {
  const d = (Date.now() - ms) / 86400000;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  if (d < 60) return `${Math.round(d)} days ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Owns navigation: which room is loaded, the player, input, and the hover/tap loop. */
export class Session {
  view: RoomView | null = null;
  currentId: Id;
  readonly player: PlayerController;
  readonly input: Input;
  readonly thumbs: ThumbService;
  items = new Map<Id, ItemInfo>();
  private nodes = new Map<Id, Node>();
  private navigating = false;
  private aimTimer = 0;
  paused = false;
  private fly: { fromPos: THREE.Vector3; fromQuat: THREE.Quaternion; toPos: THREE.Vector3; toQuat: THREE.Quaternion; t: number; dur: number; done: () => void } | null = null;
  private reloadTimer = 0;

  constructor(
    readonly world: World,
    readonly vfs: VFS,
    readonly bus: ActionBus,
    uiRoot: HTMLElement,
  ) {
    this.currentId = vfs.rootId;
    this.thumbs = new ThumbService(vfs);
    this.player = new PlayerController(world.camera);
    this.input = new Input(world.canvas, uiRoot);
    this.input.onLook = (dx, dy) => this.player.look(dx, dy);
    this.input.onTap = (e) => this.tap(e);
    this.input.onKey = (k) => this.key(k);
    world.onFrame((dt) => this.frame(dt));
    vfs.watch((changes) => this.onChanges(changes));
  }

  /** Smoothly moves the camera to a pose; resolves when it arrives. The player state is untouched. */
  flyTo(pos: THREE.Vector3, quat: THREE.Quaternion, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0) {
        this.world.camera.position.copy(pos);
        this.world.camera.quaternion.copy(quat);
        resolve();
        return;
      }
      this.fly = { fromPos: this.world.camera.position.clone(), fromQuat: this.world.camera.quaternion.clone(), toPos: pos.clone(), toQuat: quat.clone(), t: 0, dur: ms / 1000, done: resolve };
    });
  }

  /** Camera pose that frames an item's picture so it fills most of the screen. */
  framePoseFor(id: Id): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    const p = this.view?.itemPose(id);
    if (!p) return null;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
    const cam = this.world.camera;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dH = p.scale.y / (0.62 * 2 * tanHalf);
    const dW = p.scale.x / (0.8 * 2 * tanHalf * cam.aspect);
    const d = Math.max(0.5, dH, dW);
    return { pos: p.pos.clone().addScaledVector(normal, d), quat: p.quat.clone() };
  }

  /** The player's current camera pose (what the camera returns to after focus mode). */
  playerPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'));
    return { pos: new THREE.Vector3(this.player.x, 1.6, this.player.z), quat: q };
  }

  private onChanges(changes: Change[]) {
    if (!this.view) return;
    let rebuild = false;
    for (const c of changes) {
      if (c.type === 'modify' && this.items.has(c.id)) {
        void this.vfs.stat(c.id).then((n) => {
          const info = infoOf(n);
          this.nodes.set(n.id, n);
          this.items.set(n.id, info);
          this.view?.refreshItem(info);
        });
      } else if (c.parent === this.currentId || (c.type === 'move' && c.from === this.currentId) || c.type === 'remove') {
        rebuild = true;
      }
    }
    if (rebuild) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => void this.reload(), 120);
    }
  }

  /** Rebuilds the current room in place (after items moved in or out), keeping the player where they stand. */
  async reload() {
    if (this.navigating) return;
    const keep = { x: this.player.x, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch };
    await this.enter(this.currentId, null, true, true);
    this.player.place(keep.x, keep.z, keep.yaw);
    this.player.pitch = keep.pitch;
  }

  async start() {
    const last = await getSetting<Id>('lastRoom');
    let target = this.vfs.rootId;
    if (last) {
      try {
        const n = await this.vfs.stat(last);
        if (n.kind === 'folder') target = last;
      } catch {
        /* fall back to root */
      }
    }
    await this.enter(target, null, true);
  }

  private frame(dt: number) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.world.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.world.camera.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
      if (f.t >= 1) {
        this.fly = null;
        f.done();
      }
      return;
    }
    if (this.paused) return;
    this.player.update(dt, this.input, this.view);
    if (this.player.pendingDoor && !this.navigating) {
      const d = this.player.pendingDoor;
      this.player.pendingDoor = null;
      void this.go(d);
    }
    this.aimTimer += dt;
    if (this.aimTimer > 0.1) {
      this.aimTimer = 0;
      this.updateAim();
    }
  }

  private updateAim() {
    if (!this.view) return;
    const hit = this.view.pick(this.world.camera, 0, 0, 5);
    ui.set({ aim: hit ? this.describe(hit) : null });
  }

  private describe(hit: NonNullable<ReturnType<RoomView['pick']>>) {
    if (hit.type === 'door') {
      const info = this.doorInfo(hit.door);
      return { kind: 'door' as const, id: hit.door.to, name: info.isParent ? `Up to ${info.name}` : info.name, detail: info.isParent ? 'Walk through or tap' : `${info.count ?? 0} items` };
    }
    const it = this.items.get(hit.itemId);
    return { kind: 'item' as const, id: hit.itemId, name: it?.name ?? '?', detail: it ? `${it.kind} · ${bytes(it.size)} · ${ago(it.mtime)}` : '' };
  }

  private childCounts = new Map<Id, number>();
  private doorInfo = (d: Door): DoorInfo => {
    const n = this.nodes.get(d.to);
    return { name: n?.name ?? d.label, count: this.childCounts.get(d.to), isParent: d.to === this.nodes.get(this.currentId)?.parent };
  };

  async go(door: Door) {
    if (this.navigating) return;
    await this.enter(door.to, this.currentId, false);
  }

  /** Places the player 2.4 m in front of a door, looking at it (used by tests and "take me there"). */
  standBefore(door: Door) {
    if (!this.view) return;
    const s = this.view.spawnBefore(door, 2.4);
    this.player.place(s.x, s.z, s.yaw);
  }

  async goUp() {
    const n = this.nodes.get(this.currentId) ?? (await this.vfs.stat(this.currentId));
    if (n.parent) await this.enter(n.parent, this.currentId, false);
  }

  /** Loads a folder as the current room. Crossfades through black unless `instant`. */
  async enter(folderId: Id, from: Id | null, instant: boolean, keepContext = false) {
    this.navigating = true;
    try {
      if (!instant) {
        ui.set({ fade: true });
        await sleep(FADE_MS);
      }
      if (!keepContext) await this.saveContext();
      this.thumbs.clearQueue();
      const children = await this.vfs.list(folderId);
      const folder = await this.vfs.stat(folderId);
      this.nodes.clear();
      this.nodes.set(folder.id, folder);
      for (const c of children) this.nodes.set(c.id, c);
      if (folder.parent) this.nodes.set(folder.parent, await this.vfs.stat(folder.parent));
      this.childCounts.clear();
      for (const c of children) if (c.kind === 'folder') this.childCounts.set(c.id, (await this.vfs.list(c.id)).length);
      if (folder.parent) this.childCounts.set(folder.parent, (await this.vfs.list(folder.parent)).length);

      const files = children.filter((c) => c.kind !== 'folder');
      const folders = children.filter((c) => c.kind === 'folder');
      let room: Room | undefined = await getRoom(folderId);
      const layoutItems = files.map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
      const layoutFolders = folders.map((f) => ({ id: f.id, name: f.name }));
      let overflow = 0;
      if (!room) {
        room = generateRoom({ roomId: folderId, kind: 'folder', items: layoutItems, folders: layoutFolders, parentId: folder.parent, title: folder.name });
        await putRoom(room);
      } else {
        const r = reconcileRoom(room, layoutItems, layoutFolders, folder.parent);
        overflow = r.overflowItems.length;
        if (r.changed) await putRoom(r.room);
        room = r.room;
      }

      this.items = new Map(files.map((f) => [f.id, infoOf(f)]));
      this.view?.dispose();
      this.currentId = folderId;
      this.view = new RoomView({ room, items: this.items, doorInfo: this.doorInfo, renderer: this.world.renderer, vfs: this.vfs, thumbs: this.thumbs, overflowCount: overflow });
      this.world.root.add(this.view.group);
      this.world.sun.intensity = 0;
      this.world.ambient.intensity = 0;
      this.world.scene.background = null;

      const ctx = room.context;
      if (instant && ctx) this.player.place(ctx.px, ctx.pz, ctx.yaw);
      else {
        const s = this.view.spawn(from);
        this.player.place(s.x, s.z, s.yaw);
      }
      // crumbs
      const crumbs: { id: Id; name: string }[] = [];
      let cur: Node | null = folder;
      while (cur) {
        crumbs.unshift({ id: cur.id, name: cur.id === this.vfs.rootId ? 'Home' : cur.name });
        cur = cur.parent ? await this.vfs.stat(cur.parent).catch(() => null) : null;
      }
      ui.set({ crumbs, roomTitle: folder.name, aim: null });
      await setSetting('lastRoom', folderId);
      this.world.renderOnce();
    } finally {
      this.navigating = false;
      ui.set({ fade: false });
    }
  }

  private async saveContext() {
    if (!this.view) return;
    const room = await getRoom(this.currentId);
    if (!room) return;
    room.context = { px: this.player.x, pz: this.player.z, yaw: this.player.yaw };
    await putRoom(room);
  }

  private tap(e: TapEvent) {
    if (this.paused || !this.view || this.navigating) return;
    const hit = this.view.pick(this.world.camera, e.ndcX, e.ndcY);
    if (!hit) return;
    if (hit.type === 'door') void this.go(hit.door);
    else this.onItemActivate?.(hit.itemId);
  }

  /** Set by the focus-mode layer (M2). */
  onItemActivate: ((id: Id) => void) | null = null;

  private key(k: string) {
    if (this.paused) return;
    if (k === 'backspace' || k === 'b') void this.goUp();
    else if (k === 'e' || k === 'enter') {
      const hit = this.view?.pick(this.world.camera, 0, 0);
      if (hit?.type === 'door') void this.go(hit.door);
      else if (hit?.type === 'item') this.onItemActivate?.(hit.itemId);
    }
  }

  get camera(): THREE.PerspectiveCamera {
    return this.world.camera;
  }
}
