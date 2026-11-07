import { createStore } from '../core/store';
import { getSetting, setSetting } from '../data/idb';
import type { LauncherCommand } from '../ui/launcher/commands';
import { appIdOfRoom, appIdOfTool, isAppRoomId, isToolRef, toolRef, type AppContext, type AtriumApp, type PanelSpec } from './api';

interface Entry {
  app: AtriumApp;
  ctx: AppContext;
}

/**
 * Knows every installed app and hands each one a narrow `AppContext`. First-party apps register at start-up;
 * tests register throw-away apps at runtime. Registering twice replaces the earlier app (hot reload).
 */
export class AppRegistry {
  private entries = new Map<string, Entry>();
  /** Bumps whenever the set of apps changes, so UI lists re-render. */
  readonly version = createStore({ n: 0 });

  constructor(private makeContext: (appId: string) => Omit<AppContext, 'settings' | 'appId'>) {}

  async register(app: AtriumApp): Promise<void> {
    if (!/^[a-z][a-z0-9-]*$/.test(app.id)) throw new Error(`Bad app id "${app.id}": use lowercase letters, digits and dashes`);
    this.unregister(app.id);
    const base = this.makeContext(app.id);
    const ctx: AppContext = {
      ...base,
      appId: app.id,
      settings: {
        get: <T>(key: string) => getSetting<T>(`app:${app.id}:${key}`),
        set: <T>(key: string, value: T) => setSetting(`app:${app.id}:${key}`, value),
      },
    };
    this.entries.set(app.id, { app, ctx });
    await app.start?.(ctx);
    this.version.set((s) => ({ n: s.n + 1 }));
  }

  unregister(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    try {
      e.app.stop?.();
    } finally {
      this.entries.delete(id);
      this.version.set((s) => ({ n: s.n + 1 }));
    }
  }

  get(id: string): AtriumApp | undefined {
    return this.entries.get(id)?.app;
  }
  context(id: string): AppContext | undefined {
    return this.entries.get(id)?.ctx;
  }
  list(): AtriumApp[] {
    return [...this.entries.values()].map((e) => e.app);
  }

  /** Apps that carry a tool, in registration order. */
  tools(): AtriumApp[] {
    return this.list().filter((a) => a.tool);
  }
  /** Apps with a room: these get a door in the Hall. */
  roomApps(): AtriumApp[] {
    return this.list().filter((a) => a.room);
  }
  panels(): { app: AtriumApp; panel: PanelSpec; ctx: AppContext }[] {
    return [...this.entries.values()].filter((e) => e.app.panel).map((e) => ({ app: e.app, panel: e.app.panel!, ctx: e.ctx }));
  }
  commands(): LauncherCommand[] {
    return this.list().flatMap((a) => a.commands ?? []);
  }

  hasTool(ref: string): boolean {
    return isToolRef(ref) && !!this.get(appIdOfTool(ref))?.tool;
  }
  toolApp(ref: string): AtriumApp | undefined {
    return isToolRef(ref) ? this.get(appIdOfTool(ref)) : undefined;
  }
  roomApp(roomId: string): AtriumApp | undefined {
    return isAppRoomId(roomId) ? this.get(appIdOfRoom(roomId)) : undefined;
  }
  refOf(app: AtriumApp): string {
    return toolRef(app.id);
  }
}
