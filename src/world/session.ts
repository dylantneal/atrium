import * as THREE from 'three';
import type { ActionBus } from '../core/actions';
import { ui, type Aim } from '../core/uiState';
import { addAccess, allRooms, deleteRoom, getRoom, getSetting, NINETY_DAYS, putRoom, recentAccess, setSetting } from '../data/idb';
import { Emitter, type GameEvent } from '../core/events';
import { computeActivity, DAY, type FolderActivity } from '../core/rules/activity';
import { TIERS } from './quality';
import type { Door, Id, Node, Room, Side } from '../data/schema';
import type { VFS } from '../vfs/vfs';
import { dropIntoCmd, placeCmd, trashCmd, type HandCtx } from '../core/handCommands';
import { Inventory } from '../core/inventory';
import { PlayerController } from './controller';
import { allBays, bayIndexOfDoor, doorAt, generateRoom, reconcileRoom, WORKSHOP_PALETTE } from './generator/rooms';
import { hash32, uuid } from '../util/hash';
import { SearchService } from './searchService';
import { Input, type TapEvent } from './input';
import { infoOf, type ItemInfo } from './itemTiles';
import type { Change } from '../vfs/vfs';
import { RoomView } from './roomView';
import type { DoorInfo, Pick, RoomLike } from './roomLike';
import { AppRegistry } from '../apps/registry';
import { buildHall } from '../apps/hall';
import { appIdOfTool, HALL_ID, isAppRoomId, isToolRef, roomIdOf, type SessionFacade, type ToolInstance } from '../apps/api';
import { AppRoom, makeAppRoom } from '../apps/appRoom';
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
  view: RoomLike | null = null;
  currentId: Id;
  readonly player: PlayerController;
  readonly input: Input;
  readonly thumbs: ThumbService;
  items = new Map<Id, ItemInfo>();
  private nodes = new Map<Id, Node>();
  private navigating = false;
  private aimTimer = 0;
  paused = false;
  readonly inventory = new Inventory();
  readonly events = new Emitter<GameEvent>();
  readonly search: SearchService;
  readonly apps: AppRegistry;
  /** The tool currently raised in the player's hand, if any. */
  raised: { appId: string; instance: ToolInstance } | null = null;
  private handGroup = new THREE.Group();
  /** Set by the surface host (FocusController) so apps can open a full-screen surface. */
  openSurfaceHook: ((appId: string, props?: unknown) => Promise<void>) | null = null;
  closeSurfaceHook: (() => Promise<void>) | null = null;
  private lamps = new Map<Id, number>();
  /** Per-folder activity, refreshed on entry and whenever files change. */
  activity = new Map<Id, FolderActivity>();
  private lastTouch = new Map<Id, number>();
  private activityTimer = 0;
  /** True when running on the generated demo data (shows the "Make it live" helper). */
  demo = false;
  private holdReload = 0;
  private pendingReload = false;
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
    this.search = new SearchService(vfs);
    this.player = new PlayerController(world.camera);
    this.input = new Input(world.canvas, uiRoot);
    this.input.onLook = (dx, dy) => this.player.look(dx, dy);
    this.input.onTap = (e) => this.tap(e);
    this.input.onKey = (k, e) => this.key(k, e);
    this.input.onPrimary = (x, y, shift) => void this.primary(x, y, shift);
    world.onFrame((dt) => this.frame(dt));
    vfs.watch((changes) => this.onChanges(changes));
    this.inventory.store.subscribe(() => this.syncHeld());
    addEventListener('pagehide', () => void this.inventory.flush());
    this.handCtx = { vfs, inventory: this.inventory, batch: (fn) => this.batch(fn) };
    const facade: SessionFacade = {
      enter: (id) => this.enter(id, this.currentId, false),
      toast: (t, k) => bus.toast(t, k),
      openSurface: (a, p) => this.openSurfaceHook?.(a, p) ?? Promise.resolve(),
      closeSurface: () => this.closeSurfaceHook?.() ?? Promise.resolve(),
      get currentRoomId() {
        return self.currentId;
      },
    };
    const self = this;
    this.apps = new AppRegistry(() => ({ vfs, bus, session: facade, notify: (n) => bus.toast(n.body ? `${n.title}: ${n.body}` : n.title) }));
    world.handScene.add(this.handGroup);
  }

  /** Hand commands run several changes as one: no rebuild until the whole batch is done. */
  handCtx!: HandCtx;

  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.holdReload++;
    try {
      return await fn();
    } finally {
      this.holdReload--;
      if (this.holdReload === 0) {
        clearTimeout(this.reloadTimer);
        this.pendingReload = false;
        await this.reload();
      }
    }
  }

  private syncHeld() {
    if (!this.view) return;
    const held = this.inventory.heldIds;
    for (const id of held) {
      if (isToolRef(id)) this.heldNames.set(id, this.apps.toolApp(id)?.tool?.name ?? 'tool');
      else if (!this.heldNames.has(id) && !this.items.has(id)) void this.vfs.stat(id).then((n) => this.heldNames.set(id, n.name)).catch(() => {});
    }
    // a raised tool is lowered when it is no longer the selected slot
    const sel = this.inventory.selectedId;
    if (this.raised && sel !== `tool:${this.raised.appId}`) this.lower();
    this.view.setHeld(held);
    this.view.setCarrying(this.view.room.kind === 'folder' && sel !== null && !isToolRef(sel), held);
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

  /** Recompute folder activity from the file tree and the access log, then ease the current room and its doors to match. */
  async refreshActivity() {
    const now = Date.now();
    const [nodes, events] = await Promise.all([this.vfs.all(), recentAccess(now - NINETY_DAYS)]);
    this.activity = computeActivity(nodes, events, now);
    this.lastTouch.clear();
    for (const e of events) this.lastTouch.set(e.nodeId, Math.max(this.lastTouch.get(e.nodeId) ?? 0, e.ts));
    this.applyActivity();
  }

  refreshActivitySoon() {
    clearTimeout(this.activityTimer);
    this.activityTimer = window.setTimeout(() => void this.refreshActivity(), 250);
  }

  private applyActivity() {
    const v = this.view;
    if (!v || v.room.kind !== 'folder') return;
    const a = this.activity.get(this.currentId)?.activity;
    if (a !== undefined) v.setActivityTarget(a);
    for (const d of v.room.doors) v.setDoorState(d.id, this.doorInfo(d));
  }

  private idleDaysOf(id: Id): number {
    const it = this.items.get(id);
    const touched = Math.max(it?.mtime ?? 0, this.lastTouch.get(id) ?? 0);
    return Math.max(0, Math.floor((Date.now() - touched) / DAY));
  }

  /** Demo helper: edit a file inside the dimmest room behind a door here and watch that door come alive. */
  async makeItLive(): Promise<string | null> {
    const v = this.view;
    if (!v) return null;
    const parent = this.nodes.get(this.currentId)?.parent;
    const doors = v.room.doors.filter((d) => d.to !== parent && !d.portal);
    if (doors.length === 0) {
      this.bus.toast('Go to a room with doors (Home has six) and try again');
      return null;
    }
    doors.sort((a, b) => (this.activity.get(a.to)?.activity ?? 1) - (this.activity.get(b.to)?.activity ?? 1));
    const target = doors[0];
    const all = await this.vfs.all();
    const byParent = new Map<Id, typeof all>();
    for (const n of all) byParent.set(n.parent ?? '', [...(byParent.get(n.parent ?? '') ?? []), n]);
    const stack = [target.to];
    let file: (typeof all)[number] | undefined;
    while (stack.length && !file) {
      const id = stack.pop()!;
      for (const n of (byParent.get(id) ?? []).sort((x, y) => x.name.localeCompare(y.name))) {
        if (n.kind === 'folder') stack.push(n.id);
        else if (!file && (n.kind === 'markdown' || n.kind === 'text')) file = n;
      }
    }
    if (!file) {
      this.bus.toast('Nothing editable in that room');
      return null;
    }
    const text = await (await this.vfs.read(file.id)).text();
    await this.vfs.write(file.id, `${text.trimEnd()}\n\nEdited just now.\n`);
    await addAccess({ nodeId: file.id, ts: Date.now(), type: 'edit' });
    await this.refreshActivity();
    this.events.emit('live');
    return target.to;
  }

  private onChanges(changes: Change[]) {
    this.refreshActivitySoon();
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
      if (this.holdReload > 0) this.pendingReload = true;
      else {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => void this.reload(), 120);
      }
    }
    for (const c of changes) if (c.type === 'remove') this.inventory.remove(c.id);
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
    this.demo = this.vfs.demo;
    await this.refreshActivity();
    void this.search.init();
    await this.inventory.load((id) => (isToolRef(id) ? Promise.resolve(this.apps.hasTool(id)) : this.vfs.stat(id).then(() => true, () => false)));
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
    this.view?.tick(dt);
    if (this.raised) {
      this.raised.instance.update?.(dt);
      this.placeHand();
    } else this.handGroup.visible = false;
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

  private heldName(): string | null {
    const id = this.inventory.selectedId;
    if (!id) return null;
    return this.items.get(id)?.name ?? this.heldNames.get(id) ?? 'item';
  }
  /** Names of carried items that are not in this room (learned when picked up). */
  private heldNames = new Map<Id, string>();

  private describe(hit: NonNullable<Pick>): Aim {
    const holding = this.heldName();
    if (hit.type === 'object') {
      const spec = this.apps.get(hit.appId)?.room;
      const d = spec?.describe?.(hit.objectId);
      return { kind: 'object', id: hit.objectId, name: d?.name ?? hit.objectId, detail: d?.detail ?? '', hint: d?.hint ?? 'Click to use' };
    }
    if (hit.type === 'door') {
      const info = this.doorInfo(hit.door);
      return {
        kind: 'door',
        id: hit.door.to,
        name: info.isParent ? `Up to ${info.name}` : info.name,
        detail: info.isParent ? 'Tap or walk through' : `${info.count ?? 0} items`,
        hint: holding ? `E: drop "${holding}" into this room` : '',
      };
    }
    if (hit.type === 'slot') {
      return { kind: 'slot', id: `${hit.side}:${hit.slot}`, name: 'Empty spot', detail: holding ? `Place "${holding}" here` : '', hint: holding ? (this.inventory.store.get().copy ? 'E: place a copy' : 'E: place here') : '' };
    }
    const it = this.items.get(hit.itemId);
    if (it?.kind === 'tool') return { kind: 'item', id: hit.itemId, name: it.name, detail: this.apps.toolApp(hit.itemId)?.tool?.description ?? 'A tool', hint: 'E or long-press: take it · then R to raise it' };
    const where = this.view && this.view.room.kind !== 'folder' ? this.search.paths.get(hit.itemId) : '';
    return { kind: 'item', id: hit.itemId, name: it?.name ?? '?', detail: where ? `in ${where || 'Home'}` : it ? `${it.kind} · ${bytes(it.size)} · ${ago(it.mtime)}` : '', hint: 'Click: open · E or long-press: pick up' };
  }

  /** The contextual hand action: pick up, place, or drop through a door, depending on what is aimed at. */
  async primary(ndcX: number, ndcY: number, shift = false) {
    if (this.paused || !this.view || this.navigating) return;
    const hit = this.view.pick(this.world.camera, ndcX, ndcY, 6);
    if (!hit) return;
    const sel = this.inventory.selectedId;
    if (hit.type === 'item') {
      const it = this.items.get(hit.itemId);
      if (!this.inventory.pickUp(hit.itemId)) return this.bus.toast('Your hands are full. Put something down first.', 'error');
      if (it) this.heldNames.set(hit.itemId, it.name);
      this.bus.toast(it?.kind === 'tool' ? `Took the ${it.name}. Press R to raise it.` : `Picked up ${it?.name ?? 'item'}`);
      if (it?.kind !== 'tool') this.events.emit('pickup');
    } else if (hit.type === 'slot') {
      if (!sel) return this.bus.toast('Pick something up first', 'error');
      if (isToolRef(sel)) return this.bus.toast('Tools live on the Hall shelf. Press Q to put it back.', 'error');
      const copy = shift || this.inventory.store.get().copy;
      if (await this.bus.dispatch(placeCmd(this.handCtx, sel, this.currentId, { side: hit.side, slot: hit.slot }, copy))) this.events.emit('placed');
    } else if (hit.type === 'door') {
      if (!sel) return;
      if (isToolRef(sel)) return this.bus.toast('Tools cannot be dropped into a room. Press Q to put it back.', 'error');
      const info = this.doorInfo(hit.door);
      if (await this.bus.dispatch(dropIntoCmd(this.handCtx, sel, hit.door.to, info.name))) this.events.emit('placed');
    }
  }

  /** Which wall the crosshair is on (item or empty spot), for "this wall" requests. */
  aimedSide(): Side | null {
    const hit = this.view?.pick(this.world.camera, 0, 0, 12);
    return hit && (hit.type === 'item' || hit.type === 'slot') ? hit.side : null;
  }

  /** Cancel carrying the selected item (it never left its place). */
  putBack() {
    const id = this.inventory.selectedId;
    if (id) this.inventory.remove(id);
  }

  async trashSelected() {
    const id = this.inventory.selectedId;
    if (id && isToolRef(id)) return this.putBack();
    if (id) await this.bus.dispatch(trashCmd(this.handCtx, id));
  }

  private childCounts = new Map<Id, number>();
  private doorInfo = (d: Door): DoorInfo => {
    const n = this.nodes.get(d.to);
    const fa = this.activity.get(d.to);
    return { name: n?.name ?? d.label, count: this.childCounts.get(d.to), isParent: d.label === 'Back', activity: fa?.activity, idleDays: fa?.idleDays };
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
    const back = this.view?.room.doors.find((d) => d.label === 'Back');
    if (this.isVirtual(this.currentId) && back) return void (await this.enter(back.to, this.currentId, false));
    const n = this.nodes.get(this.currentId) ?? (await this.vfs.stat(this.currentId));
    if (n.parent) await this.enter(n.parent, this.currentId, false);
  }

  isVirtual(id: Id) {
    return id.startsWith('search:') || id.startsWith('view:') || isAppRoomId(id);
  }

  /** Loads a room (a folder, a search result, or a saved view). Crossfades through black unless `instant`. */
  async enter(id: Id, from: Id | null, instant: boolean, keepContext = false) {
    this.navigating = true;
    try {
      if (!instant) {
        ui.set({ fade: true });
        await sleep(FADE_MS);
      }
      if (!keepContext) await this.saveContext();
      this.thumbs.clearQueue();
      if (isAppRoomId(id) && (id === HALL_ID || this.apps.roomApp(id))) await this.enterApp(id, from, instant);
      else if (this.isVirtual(id) && !isAppRoomId(id) && (await getRoom(id))) await this.enterVirtual(id, from, instant);
      else await this.enterFolder(this.isVirtual(id) ? this.vfs.rootId : id, from, instant);
      this.events.emit('navigated');
      this.world.renderOnce();
    } finally {
      this.navigating = false;
      ui.set({ fade: false });
    }
  }

  private async crumbsFor(folder: Node): Promise<{ id: Id; name: string }[]> {
    const crumbs: { id: Id; name: string }[] = [];
    let cur: Node | null = folder;
    while (cur) {
      crumbs.unshift({ id: cur.id, name: cur.id === this.vfs.rootId ? 'Home' : cur.name });
      cur = cur.parent ? await this.vfs.stat(cur.parent).catch(() => null) : null;
    }
    return crumbs;
  }

  private async enterFolder(folderId: Id, from: Id | null, instant: boolean) {
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
    // the Hall hangs in Home as a portal door (the A key and the hotbar also lead there)
    if (folderId === this.vfs.rootId && !room.doors.some((d) => d.to === HALL_ID)) {
      if (await this.placePortal(folderId, HALL_ID, 'Apps')) room = (await getRoom(folderId)) ?? room;
    }
    // kept searches hang in the room as portal doors: show how much is behind each
    for (const d of room.doors.filter((x) => x.portal && !isAppRoomId(x.to))) {
      const target = await getRoom(d.to);
      if (target) this.childCounts.set(d.to, target.walls.reduce((n, w) => n + w.slots.filter((s) => s.itemId).length, 0));
    }

    await this.refreshActivity();
    const fa = this.activity.get(folderId);
    if (fa && Math.abs(room.activity - fa.activity) > 0.02) {
      room = { ...room, activity: fa.activity };
      await putRoom(room);
    }
    await this.present({ room, files, from, instant, overflow, idleDays: fa?.idleDays ?? 0, crumbs: await this.crumbsFor(folder), title: folder.name, banner: null });
  }

  private async enterVirtual(id: Id, from: Id | null, instant: boolean) {
    const room = (await getRoom(id))!;
    const files: Node[] = [];
    for (const w of room.walls)
      for (const s of w.slots) {
        if (!s.itemId) continue;
        try {
          const n = await this.vfs.stat(s.itemId);
          if (n.kind !== 'folder') files.push(n);
        } catch {
          /* the file is gone: its hook stays empty */
        }
      }
    const back = room.doors.find((d) => d.label === 'Back');
    this.nodes.clear();
    for (const f of files) this.nodes.set(f.id, f);
    let crumbs: { id: Id; name: string }[] = [];
    if (back && !this.isVirtual(back.to)) {
      const origin = await this.vfs.stat(back.to).catch(() => null);
      if (origin) {
        this.nodes.set(origin.id, origin);
        crumbs = await this.crumbsFor(origin);
      }
    }
    this.childCounts.clear();
    const title = room.title ?? room.query ?? 'Search';
    crumbs.push({ id: room.id, name: room.kind === 'search' ? `Search: ${title}` : title });
    await this.present({
      room,
      files,
      from,
      instant,
      overflow: 0,
      idleDays: 0,
      crumbs,
      title,
      banner: { query: room.query ?? title, kept: room.kind === 'saved-view' },
      glow: room.kind === 'search' ? (iid) => this.lamps.get(iid) ?? 0.25 : undefined,
    });
  }

  /** Builds the view for a prepared room and puts the player in it. */
  private async present(a: { room: Room; files: Node[]; from: Id | null; instant: boolean; overflow: number; idleDays: number; crumbs: { id: Id; name: string }[]; title: string; banner: { query: string; kept: boolean } | null; glow?: (id: Id) => number }) {
    this.items = new Map(a.files.map((f) => [f.id, infoOf(f)]));
    const view = new RoomView({
      room: a.room,
      items: this.items,
      doorInfo: this.doorInfo,
      renderer: this.world.renderer,
      vfs: this.vfs,
      thumbs: this.thumbs,
      overflowCount: a.overflow,
      itemIdle: (id) => this.idleDaysOf(id),
      roomIdleDays: a.idleDays,
      now: Date.now(),
      props: TIERS[this.world.currentTier].props,
      glow: a.glow,
    });
    await this.mount(view, a.room, { from: a.from, instant: a.instant, crumbs: a.crumbs, title: a.title, banner: a.banner });
  }

  /** Swap the current room for a prepared one: dispose the old, place the player, update the HUD. */
  private async mount(view: RoomLike, room: Room, a: { from: Id | null; instant: boolean; crumbs: { id: Id; name: string }[]; title: string; banner: { query: string; kept: boolean } | null }) {
    this.view?.dispose();
    this.currentId = room.id;
    this.view = view;
    this.world.root.add(view.group);
    this.syncHeld();
    this.world.sun.intensity = 0;
    this.world.ambient.intensity = 0;
    this.world.scene.background = null;
    const ctx = room.context;
    if (a.instant && ctx) this.player.place(ctx.px, ctx.pz, ctx.yaw);
    else {
      const sp = view.spawn(a.from);
      this.player.place(sp.x, sp.z, sp.yaw);
    }
    ui.set({ crumbs: a.crumbs, roomTitle: a.title, aim: null, searchBanner: a.banner });
    if (room.kind === 'folder') await setSetting('lastRoom', room.id);
  }

  /** The Hall, or a room an app provides. These are built fresh each visit and never saved. */
  private async enterApp(id: Id, from: Id | null, instant: boolean) {
    const deps = { renderer: this.world.renderer, vfs: this.vfs, thumbs: this.thumbs, doorInfo: this.doorInfo };
    this.nodes.clear();
    this.childCounts.clear();
    let view: AppRoom;
    let title: string;
    const rootCrumb = { id: this.vfs.rootId, name: 'Home' };
    if (id === HALL_ID) {
      view = buildHall(this.apps, this.vfs.rootId, { ...deps, props: TIERS[this.world.currentTier].props });
      title = 'Apps';
      this.items = new Map([...view.deps.items]);
      ui.set({});
      await this.mount(view, view.room, { from, instant, crumbs: [rootCrumb, { id, name: title }], title, banner: null });
      return;
    }
    const app = this.apps.roomApp(id)!;
    const ctx = this.apps.context(app.id)!;
    const built = await app.room!.build(ctx, deps);
    title = app.room!.title;
    this.items = new Map();
    await this.mount(built, built.room, { from, instant, crumbs: [rootCrumb, { id: HALL_ID, name: 'Apps' }, { id, name: title }], title, banner: null });
  }

  /** Search and walk into the results as a temporary room. Returns false when nothing matched. */
  async enterSearch(query: string): Promise<boolean> {
    const q = query.trim();
    if (!q) return false;
    const hits = await this.search.query(q, 60);
    const files: Node[] = [];
    const lamps = new Map<Id, number>();
    const best = hits[0]?.score || 1;
    for (const h of hits) {
      try {
        const n = await this.vfs.stat(h.id);
        if (n.kind === 'folder') continue;
        files.push(n);
        lamps.set(n.id, 0.2 + 0.8 * (h.score / best));
      } catch {
        /* stale hit */
      }
    }
    if (files.length === 0) {
      this.bus.toast(`Nothing found for "${q}"`);
      return false;
    }
    const here = this.view?.room;
    const origin = here && this.isVirtual(here.id) ? here.doors.find((d) => d.label === 'Back')?.to ?? this.vfs.rootId : this.currentId;
    const roomId = `search:${hash32(q).toString(16)}`;
    const room = generateRoom({
      roomId,
      kind: 'search',
      items: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
      folders: [],
      parentId: origin,
      title: q,
      query: q,
      seed: hash32(`q:${q}`),
      keepOrder: true,
      palette: WORKSHOP_PALETTE,
    });
    room.activity = 0.85;
    await putRoom(room);
    this.lamps = lamps;
    this.events.emit('search');
    await this.enter(roomId, origin, false);
    return true;
  }

  /** Save the current search as a permanent room with its own door in the room it was started from. */
  async keepSearch(): Promise<boolean> {
    const room = this.view?.room;
    if (!room || room.kind !== 'search') return false;
    const back = room.doors.find((d) => d.label === 'Back');
    const origin = back && !this.isVirtual(back.to) ? back.to : this.vfs.rootId;
    const newId = `view:${uuid()}`;
    const kept: Room = structuredClone(room);
    kept.id = newId;
    kept.kind = 'saved-view';
    kept.walls.forEach((w) => (w.id = `${newId}:${w.side}`));
    kept.doors.forEach((d) => {
      d.from = newId;
      d.id = `${newId}>${d.to}`;
    });
    const title = room.title ?? room.query ?? 'Saved search';
    const host = await this.placePortal(origin, newId, title);
    if (!host) {
      this.bus.toast('No free door to hang this room on. Free up a doorway or keep it from Home.', 'error');
      return false;
    }
    await putRoom(kept);
    await deleteRoom(room.id);
    const hostName = host === this.vfs.rootId ? 'Home' : (await this.vfs.stat(host)).name;
    this.bus.toast(`Kept "${title}" as a room in ${hostName}`);
    await this.enter(newId, null, true);
    return true;
  }

  private async placePortal(origin: Id, viewId: Id, label: string): Promise<Id | null> {
    for (const candidate of [origin, this.vfs.rootId]) {
      const r = await getRoom(candidate);
      if (!r) continue;
      const size = { w: r.style.width, d: r.style.depth };
      const taken = new Set(r.doors.map((d) => `${d.side}:${bayIndexOfDoor(d, size)}`));
      const bay = allBays(size, r.doors.some((d) => d.label === 'Back')).find((b) => !taken.has(`${b.side}:${b.i}`));
      if (!bay) continue;
      r.doors.push(doorAt(r.id, viewId, label, bay.side, bay.i, size, true));
      await putRoom(r);
      return candidate;
    }
    return null;
  }

  /** Remove a saved view and every portal that leads to it. */
  async deleteView() {
    const room = this.view?.room;
    if (!room || room.kind !== 'saved-view') return;
    const back = room.doors.find((d) => d.label === 'Back');
    for (const r of await allRooms()) {
      const kept = r.doors.filter((d) => d.to !== room.id);
      if (kept.length !== r.doors.length) await putRoom({ ...r, doors: kept });
    }
    await deleteRoom(room.id);
    this.bus.toast(`Deleted the saved room "${room.title ?? ''}"`);
    await this.enter(back?.to ?? this.vfs.rootId, null, false);
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
    if (this.raised && this.pressTool(e.ndcX, e.ndcY)) return;
    const hit = this.view.pick(this.world.camera, e.ndcX, e.ndcY);
    if (!hit) return;
    if (hit.type === 'door') void this.go(hit.door);
    else if (hit.type === 'slot') void this.primary(e.ndcX, e.ndcY);
    else if (hit.type === 'object') this.activateObject(hit.appId, hit.objectId);
    else if (this.items.get(hit.itemId)?.kind === 'tool') void this.primary(e.ndcX, e.ndcY);
    else this.onItemActivate?.(hit.itemId);
  }

  /** Set by the focus-mode layer (M2). */
  onItemActivate: ((id: Id) => void) | null = null;

  private key(k: string, e?: KeyboardEvent) {
    if (this.paused) return;
    if (this.raised && this.raised.instance.onKey?.(k, e)) return;
    if (k === 'r') return this.toggleRaise();
    if (k === 'escape' && this.raised) return this.lower();
    if (k === 'a' && !e?.ctrlKey && !e?.metaKey && !this.raised) return void this.enter(HALL_ID, this.currentId, false);
    if (k === 'backspace' || k === 'b') void this.goUp();
    else if (k === 'e') void this.primary(0, 0, e?.shiftKey ?? false);
    else if (k === 'enter' || k === 'f') {
      const hit = this.view?.pick(this.world.camera, 0, 0);
      if (hit?.type === 'door') void this.go(hit.door);
      else if (hit?.type === 'object') this.activateObject(hit.appId, hit.objectId);
      else if (hit?.type === 'item' && this.items.get(hit.itemId)?.kind !== 'tool') this.onItemActivate?.(hit.itemId);
    } else if (k === 'q') this.putBack();
    else if (k === 'delete') void this.trashSelected();
    else if (/^[1-8]$/.test(k)) this.inventory.select(Number(k) - 1);
  }

  // ---------------------------------------------------------------- tools in hand

  toggleRaise() {
    if (this.raised) return this.lower();
    const id = this.inventory.selectedId;
    if (!id || !isToolRef(id)) return this.bus.toast('Take a tool from the Hall shelf, then press R', 'info');
    this.raise(appIdOfTool(id));
  }

  raise(appId: string) {
    const app = this.apps.get(appId);
    const ctx = this.apps.context(appId);
    if (!app?.tool || !ctx) return;
    this.lower();
    const instance = app.tool.create(ctx);
    this.handGroup.add(instance.object);
    this.raised = { appId, instance };
    ui.set({ raised: app.tool.name });
  }

  lower() {
    if (!this.raised) return;
    this.handGroup.remove(this.raised.instance.object);
    this.raised.instance.dispose();
    this.raised = null;
    ui.set({ raised: null });
  }

  /** A tap that lands on the raised tool presses whatever part it hit. Returns true when the tool used it. */
  private pressTool(ndcX: number, ndcY: number): boolean {
    const r = this.raised;
    if (!r?.instance.pick) return false;
    this.world.camera.updateMatrixWorld(true);
    this.handGroup.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.world.camera);
    const part = r.instance.pick(ray);
    if (!part) return false;
    r.instance.onPress?.(part);
    return true;
  }

  private placeHand() {
    const cam = this.world.camera;
    this.handGroup.position.copy(cam.position).add(new THREE.Vector3(0.17, -0.16, -0.42).applyQuaternion(cam.quaternion));
    this.handGroup.quaternion.copy(cam.quaternion);
    this.handGroup.visible = this.raised !== null;
  }

  private activateObject(appId: string, objectId: string) {
    const app = this.apps.get(appId);
    const ctx = this.apps.context(appId);
    if (app?.room?.onActivate && ctx) void app.room.onActivate(ctx, objectId);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.world.camera;
  }
}
