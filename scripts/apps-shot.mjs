import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?tour=off&db=as-' + Date.now());
await page.getByRole('button', { name: 'Enter' }).click();
await page.waitForFunction(() => window.atrium?.session?.view);
await page.evaluate(async () => {
  const a = window.atrium, T = a.three, { AppRoom, makeAppRoom } = a.kit;
  for (const [id, name, icon] of [['probe', 'Probe', '◆'], ['calc', 'Calculator', '＋'], ['clock', 'Clock', '◷']]) {
    await a.apps.register({ id, name, icon,
      tool: { name, description: 'test', create() { const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(0.3, 0.42, 0.04), new T.MeshStandardMaterial({ color: 0x2a3550 }))); const k = new T.Mesh(new T.BoxGeometry(0.28, 0.1, 0.045), new T.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x335577 })); k.position.set(0, 0.13, 0.01); g.add(k); g.rotation.set(0.15, -0.35, 0.05); return { object: g, dispose() {} }; } },
      room: { title: name + ' Room', build(_c, deps) { return new AppRoom({ ...deps, room: makeAppRoom({ id: 'app:' + id, title: name, width: 6, depth: 6, backTo: 'app:hall' }), items: new Map() }, id); } } });
  }
  await a.session.enter('app:hall', null, true);
  await a.session.view.whenSettled();
  const s = a.session; s.player.place(0, 1.2, 0); s.world.renderOnce();
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/hall.png' });
await page.evaluate(async () => {
  const s = window.atrium.session;
  s.inventory.pickUp('tool:calc'); s.inventory.select(0); s.raise('calc');
  s.player.place(0, 1.2, 0); s.player.yaw = 0.5; s.world.renderOnce();
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/hall-hand.png' });
await browser.close();
