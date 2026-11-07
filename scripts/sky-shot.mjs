import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const cases = [
  ['dawn', '2026-06-21T09:40:00Z', 'clear', -Math.PI / 2],
  ['noon', '2026-06-21T16:56:00Z', 'partly', 0],
  ['sunset', '2026-06-22T00:10:00Z', 'clear', Math.PI / 2],
  ['night', '2026-06-21T04:00:00Z', 'clear', 0],
  ['rain', '2026-06-21T15:00:00Z', 'rain', 0],
  ['snow', '2026-12-21T15:00:00Z', 'snow', 0],
  ['storm-night', '2026-06-21T03:00:00Z', 'storm', 0],
  ['fog', '2026-06-21T13:00:00Z', 'fog', 0],
];
for (const [name, now, weather, yaw] of cases) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await page.goto(`http://localhost:4173/?tour=off&now=${now}&weather=${weather}&db=sky-${name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => window.atrium?.session?.view);
  await page.evaluate(async ({ yaw }) => {
    const a = window.atrium; let id = a.vfs.rootId;
    for (const part of ['Crow Short Film', 'Storyboards']) id = (await a.vfs.list(id)).find((k) => k.name === part).id;
    await a.session.enter(id, null, true); await a.session.view.whenSettled();
    const s = a.session; s.player.place(0, 0.8, yaw); s.player.pitch = 0.05; s.world.renderOnce();
  }, { yaw });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.atrium.world.renderOnce());
  console.log(name, JSON.stringify(await page.evaluate(() => { const i = window.atrium.session.view.ambientInfo(); return { windows: i.windows, dayMul: +i.dayMul.toFixed(2), clock: i.hasClock, N: i.sky.N && { sun: i.sky.N.sunPos, moon: i.sky.N.moonPos }, now: new Date(window.atrium.ambient.now).toISOString() }; })));
  await page.screenshot({ path: `test-results/sky-${name}.png` });
  await page.close();
}
await browser.close();
