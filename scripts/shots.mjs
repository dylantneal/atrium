// Dev helper: screenshot a list of rooms. Usage: node scripts/shots.mjs "Crow Short Film/Storyboards" ...
import { chromium } from '@playwright/test';
const exe = process.env.PW_CHROMIUM || undefined;
const paths = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.type() + ': ' + m.text()));
await page.goto('http://localhost:4173/?db=shots-' + Date.now());
await page.getByRole('button', { name: 'Enter' }).click();
await page.waitForFunction(() => window.atrium?.session?.view);
let i = 0;
for (const p of paths.length ? paths : ['']) {
  const yaw = process.env.YAW ? Number(process.env.YAW) : null;
  await page.evaluate(async ({ p, yaw }) => {
    const a = window.atrium;
    let id = a.vfs.rootId;
    for (const part of p.split('/').filter(Boolean)) {
      const kids = await a.vfs.list(id);
      id = kids.find((k) => k.name === part).id;
    }
    await a.session.enter(id, null, true);
    if (yaw !== null) a.session.player.yaw = yaw;
  }, { p, yaw });
  await page.evaluate(() => window.atrium.session.view.whenSettled());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.atrium.world.renderOnce());
  const f = `test-results/room-${i++}.png`;
  await page.screenshot({ path: f });
  const info = await page.evaluate(() => ({ calls: window.atrium.world.renderer.info.render.calls, tris: window.atrium.world.renderer.info.render.triangles, items: window.atrium.session.view.itemCount, title: window.atrium.session.view.room.title, size: [window.atrium.session.view.room.style.width, window.atrium.session.view.room.style.depth], walls: window.atrium.session.view.room.walls.map((w) => w.type + ':' + w.slots.filter((s) => s.itemId).length + '/' + w.slots.length).join(' ') }));
  console.log(f, JSON.stringify(info));
}
console.log('errors:', JSON.stringify(errors.slice(0, 8)));
await browser.close();
