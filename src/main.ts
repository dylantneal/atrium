import { ActionBus } from './core/actions';
import { setDbName } from './data/idb';
import { buildDemoSeed } from './demo/generator';
import { mountUi } from './ui/hud/mount';
import { DemoVFS } from './vfs/demo';
import { buildEmptyRoom } from './world/emptyRoom';
import { World } from './world/scene';

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('db')) setDbName(params.get('db')!);
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const world = new World(canvas);
  const bus = new ActionBus();
  const vfs = await DemoVFS.open({ seed: () => buildDemoSeed(1) });
  const ui = mountUi(document.getElementById('ui')!, world, bus);

  world.root.add(buildEmptyRoom());
  world.start();

  let audio: AudioContext | null = null;
  ui.onEnter(() => {
    audio ??= new AudioContext();
    void audio.resume();
  });

  // Debug/test handle, used by Playwright.
  (window as unknown as { atrium: unknown }).atrium = { world, bus, vfs };
}

void boot();
