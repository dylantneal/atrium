import { h } from 'preact';
import * as THREE from 'three';
import { AppRoom, makeAppRoom } from './apps/appRoom';
import { ActionBus } from './core/actions';
import { ui } from './core/uiState';
import { flushWrites, getSetting, setDbName } from './data/idb';
import type { QualityChoice } from './ui/settings/Settings';
import { buildDemoSeed } from './demo/generator';
import { mountUi } from './ui/hud/mount';
import { DemoVFS } from './vfs/demo';
import { World } from './world/scene';
import { Session } from './world/session';
import { FocusController } from './ui/focus/FocusController';
import { DocentService } from './docent/service';
import { registerBuiltins } from './apps/builtin';

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('db')) setDbName(params.get('db')!);
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const world = new World(canvas);
  const bus = new ActionBus();
  const vfs = await DemoVFS.open({ seed: () => buildDemoSeed(1) });
  let session: Session | null = null;
  let focus: FocusController | null = null;
  let docent: DocentService | null = null;
  const handles = mountUi(uiRoot, world, bus, () => session, () => focus, () => docent);
  session = new Session(world, vfs, bus, uiRoot);
  focus = new FocusController(session, vfs, bus);
  docent = new DocentService(session);
  await registerBuiltins(session.apps, session, docent);
  world.start();
  await session.start();
  // quality: ?tier=low|medium|high|auto, else the saved choice, else auto
  const savedQuality = (params.get('tier') ?? (await getSetting<string>('quality')) ?? 'auto') as QualityChoice;
  world.autoTier = savedQuality === 'auto';
  world.setTier(savedQuality === 'auto' ? 'high' : savedQuality);
  world.onTierChange = (t) => bus.toast(`Lowered graphics quality to ${t} to keep things smooth. Change it in settings.`);

  let audio: AudioContext | null = null;
  handles.onEnter(() => {
    audio ??= new AudioContext();
    void audio.resume();
    ui.set({ entered: true });
    canvas.focus();
  });

  // Debug/test handle, used by Playwright.
  (window as unknown as { atrium: unknown }).atrium = { world, bus, vfs, session, ui, focus, docent, apps: session.apps, three: THREE, kit: { AppRoom, makeAppRoom, h }, flush: async () => { await session!.inventory.flush(); await flushWrites(); } };
}

void boot();
