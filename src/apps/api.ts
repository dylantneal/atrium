import type { ComponentChildren, ComponentType } from 'preact';
import type * as THREE from 'three';
import type { ActionBus } from '../core/actions';
import type { Id } from '../data/schema';
import type { LauncherCommand } from '../ui/launcher/commands';
import type { VFS } from '../vfs/vfs';
import type { RoomLike } from '../world/roomLike';
import type { ThumbService } from '../world/thumbs';
import type { DoorInfo } from '../world/roomLike';
import type { Door } from '../data/schema';

/**
 * The app interface. An app is a lens on files and gets five ways into the world:
 *  - `tool`    something you carry in the hotbar and raise in your hand (calculator)
 *  - `room`    a space the app generates, reached through a door in the Hall (calendar, weather deck)
 *  - `surface` a flat 2D view shown full screen (an editor, a form); typing always happens here
 *  - `panel`   a floating panel that stays beside the world (docent, settings)
 *  - `commands` entries for the launcher (Ctrl+K, ">")
 * Apps keep their data in the VFS (".ics", ".md", ".url") so the file system and the apps stay one thing.
 */
export interface AtriumApp {
  /** Stable id, lowercase letters and dashes. Used in `tool:<id>` and `app:<id>` references. */
  id: string;
  name: string;
  /** One glyph shown on the shelf tile and hotbar. */
  icon: string;
  tool?: ToolSpec;
  room?: RoomSpec;
  surface?: SurfaceSpec;
  panel?: PanelSpec;
  commands?: LauncherCommand[];
  start?(ctx: AppContext): void | Promise<void>;
  stop?(): void;
}

/** What an app is allowed to touch. Narrow on purpose: this is the seam a sandboxed SDK would later sit behind. */
export interface AppContext {
  readonly appId: string;
  readonly vfs: VFS;
  readonly bus: ActionBus;
  readonly session: SessionFacade;
  /** Per-app key/value store, namespaced by app id and persisted. */
  readonly settings: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
  };
  /** Diegetic notification: toast now, and (when `fromRoom` is an app room) a pulse on that door. */
  notify(n: { title: string; body?: string; fromRoom?: Id }): void;
}

export interface SessionFacade {
  enter(roomId: Id): Promise<void>;
  toast(text: string, kind?: 'info' | 'error'): void;
  openSurface(appId: string, props?: unknown): Promise<void>;
  closeSurface(): Promise<void>;
  readonly currentRoomId: Id;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Build the object held in hand. Local space: +x right, +y up, -z away from you. It is drawn about 0.4 m in front of the camera, so keep it small: roughly 0.12 m across. */
  create(ctx: AppContext): ToolInstance;
}

export interface ToolInstance {
  object: THREE.Object3D;
  /** Which part of the tool a pointer ray hit (a key id), or null. Called with the ray in world space. */
  pick?(ray: THREE.Raycaster): string | null;
  onPress?(partId: string): void;
  /** Return true when the key was used, so the world does not also act on it. */
  onKey?(key: string, e?: KeyboardEvent): boolean;
  update?(dt: number): void;
  dispose(): void;
}

export interface RoomBuildDeps {
  renderer: THREE.WebGLRenderer;
  vfs: VFS;
  thumbs: ThumbService;
  doorInfo: (d: Door) => DoorInfo;
}

export interface RoomSpec {
  title: string;
  /** Build the room. Most apps return an `AppRoom` (a folder room with no wall slots plus their own objects). */
  build(ctx: AppContext, deps: RoomBuildDeps): RoomLike | Promise<RoomLike>;
  /** Name, detail and hint shown on the aim plate for one of the app's objects. */
  describe?(objectId: string): { name: string; detail?: string; hint?: string };
  /** Called when the player taps one of the app's objects in the room. */
  onActivate?(ctx: AppContext, objectId: string): void | Promise<void>;
}

export interface SurfaceSpec {
  title: string | ((props: unknown) => string);
  render(props: unknown, h: { ctx: AppContext; close(): void }): ComponentChildren;
}

export interface PanelSpec {
  /** Rendered by the panel host; the component decides for itself when it is open. */
  component: ComponentType<{ ctx: AppContext }>;
}

export const toolRef = (appId: string) => `tool:${appId}`;
export const isToolRef = (id: string) => id.startsWith('tool:');
export const appIdOfTool = (id: string) => id.slice(5);
export const roomIdOf = (appId: string) => `app:${appId}`;
export const isAppRoomId = (id: string) => id.startsWith('app:');
export const appIdOfRoom = (id: string) => id.slice(4);
export const HALL_ID = 'app:hall';
