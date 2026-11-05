import { ActionBus } from './core/actions';
import { ui } from './core/uiState';
import { setDbName } from './data/idb';
import { buildDemoSeed } from './demo/generator';
import { mountUi } from './ui/hud/mount';
import { DemoVFS } from './vfs/demo';
import { World } from './world/scene';
import { Session } from './world/session';
import { FocusController } from './ui/focus/FocusController';

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
  const handles = mountUi(uiRoot, world, bus, () => session, () => focus);
  session = new Session(world, vfs, bus, uiRoot);
  focus = new FocusController(session, vfs, bus);
  world.start();
  await session.start();

  let audio: AudioContext | null = null;
  handles.onEnter(() => {
    audio ??= new AudioContext();
    void audio.resume();
    ui.set({ entered: true });
    canvas.focus();
  });

  // Debug/test handle, used by Playwright.
  (window as unknown as { atrium: unknown }).atrium = { world, bus, vfs, session, ui, focus };
}

void boot();
