import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appIdOfRoom, appIdOfTool, HALL_ID, isAppRoomId, isToolRef, roomIdOf, toolRef, type AtriumApp } from '../src/apps/api';
import { makeAppRoom } from '../src/apps/appRoom';
import { AppRegistry } from '../src/apps/registry';
import { closeDb, getSetting, setDbName } from '../src/data/idb';

const ctxBase = () => ({ vfs: {} as never, bus: {} as never, session: {} as never, ambient: {} as never, notify: () => {} });
const app = (id: string, over: Partial<AtriumApp> = {}): AtriumApp => ({ id, name: id, icon: '◆', ...over });

describe('app references', () => {
  it('round-trip tool and room ids', () => {
    expect(toolRef('calc')).toBe('tool:calc');
    expect(isToolRef('tool:calc')).toBe(true);
    expect(isToolRef('n_123')).toBe(false);
    expect(appIdOfTool('tool:calc')).toBe('calc');
    expect(roomIdOf('calendar')).toBe('app:calendar');
    expect(isAppRoomId('app:calendar')).toBe(true);
    expect(isAppRoomId('search:ab')).toBe(false);
    expect(appIdOfRoom('app:calendar')).toBe('calendar');
    expect(isAppRoomId(HALL_ID)).toBe(true);
  });
});

describe('AppRegistry', () => {
  beforeEach(async () => {
    await closeDb();
    setDbName(`apps-${Math.random()}`);
  });

  it('registers, lists, and exposes tools, rooms, panels and commands', async () => {
    const r = new AppRegistry(ctxBase);
    const cmd = { id: 'hi', title: 'Say hi', run: () => {} };
    await r.register(app('calc', { tool: { name: 'Calculator', description: '', create: () => ({ object: {} as never, dispose() {} }) } }));
    await r.register(app('cal', { room: { title: 'Calendar', build: () => ({}) as never }, commands: [cmd] }));
    await r.register(app('docent', { panel: { component: () => null } }));
    expect(r.list().map((a) => a.id)).toEqual(['calc', 'cal', 'docent']);
    expect(r.tools().map((a) => a.id)).toEqual(['calc']);
    expect(r.roomApps().map((a) => a.id)).toEqual(['cal']);
    expect(r.panels().map((p) => p.app.id)).toEqual(['docent']);
    expect(r.commands()).toEqual([cmd]);
    expect(r.hasTool('tool:calc')).toBe(true);
    expect(r.hasTool('tool:cal')).toBe(false);
    expect(r.hasTool('n_1')).toBe(false);
    expect(r.roomApp('app:cal')?.id).toBe('cal');
    expect(r.roomApp('app:nope')).toBeUndefined();
  });

  it('rejects bad ids, replaces on re-register (stopping the old), and bumps the version', async () => {
    const r = new AppRegistry(ctxBase);
    await expect(r.register(app('Bad Id'))).rejects.toThrow(/Bad app id/);
    const stop = vi.fn();
    await r.register(app('x', { stop }));
    const v = r.version.get().n;
    await r.register(app('x', { name: 'second' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(r.get('x')?.name).toBe('second');
    expect(r.list()).toHaveLength(1);
    expect(r.version.get().n).toBeGreaterThan(v);
    r.unregister('x');
    expect(r.get('x')).toBeUndefined();
    r.unregister('x'); // idempotent
  });

  it('starts each app with its own context, and namespaces its settings', async () => {
    const r = new AppRegistry(ctxBase);
    const seen: string[] = [];
    await r.register(app('a', { start: (c) => void seen.push(c.appId) }));
    await r.register(app('b', { start: (c) => void seen.push(c.appId) }));
    expect(seen).toEqual(['a', 'b']);
    await r.context('a')!.settings.set('theme', 'dark');
    await r.context('b')!.settings.set('theme', 'light');
    expect(await r.context('a')!.settings.get('theme')).toBe('dark');
    expect(await r.context('b')!.settings.get('theme')).toBe('light');
    expect(await getSetting('app:a:theme')).toBe('dark');
  });
});

describe('makeAppRoom', () => {
  it('builds a doors-only room with a Back door on the south wall', () => {
    const room = makeAppRoom({ id: 'app:t', title: 'T', width: 10, depth: 8, backTo: 'app:hall', doors: [{ to: 'x', label: 'X', side: 'N', bay: 1 }] });
    expect(room.kind).toBe('app');
    expect(room.walls).toEqual([]);
    expect(room.doors.map((d) => `${d.label}:${d.side}`)).toEqual(['Back:S', 'X:N']);
    expect(new Set(room.doors.map((d) => `${d.side}:${d.t}`)).size).toBe(2);
  });
  it('refuses a door on a bay the wall does not have', () => {
    expect(() => makeAppRoom({ id: 'a', title: 'A', width: 4, depth: 40, backTo: 'h', doors: [{ to: 'x', label: 'X', side: 'N', bay: 3 }] })).toThrow(/bays/);
  });
  it('is deterministic', () => {
    const d = { id: 'app:t', title: 'T', width: 6, depth: 6, backTo: 'h' };
    expect(makeAppRoom(d)).toEqual(makeAppRoom(d));
  });
});
