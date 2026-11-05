// Scripted flythrough with 4x CPU throttle. Prints frame-time percentiles and render stats per room.
// Headless Chromium renders in software, so treat the numbers as a relative guard (compare before/after a change),
// not as tablet performance. Usage: PW_CHROMIUM=/path node scripts/flythrough.mjs [secondsPerRoom] [url]
import { chromium } from '@playwright/test';
const secs = Number(process.argv[2] || 3);
const url = process.argv[3] || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.goto(`${url}?tour=off&tier=${process.env.TIER || 'high'}&db=fly-${Date.now()}`);
await page.getByRole('button', { name: 'Enter' }).click();
await page.waitForFunction(() => window.atrium?.session?.view);
const rooms = ['', 'Crow Short Film', 'Crow Short Film/Storyboards', 'Crow Short Film/Renders', 'Reference/Moodboards', 'Night Static (Band)/Stems', 'Taxes & Admin/Receipts', 'Archive 2022/Old Renders'];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const all = [];
for (const path of rooms) {
  await page.evaluate(async (p) => {
    const a = window.atrium; let id = a.vfs.rootId;
    for (const part of p.split('/').filter(Boolean)) id = (await a.vfs.list(id)).find((k) => k.name === part).id;
    await a.session.enter(id, null, true); await a.session.view.whenSettled();
  }, path);
  const r = await page.evaluate((secs) => new Promise((resolve) => {
    const a = window.atrium; const s = a.session; const times = []; let last = performance.now(); const t0 = last; let maxCalls = 0, maxTris = 0;
    const tick = (now) => {
      times.push(now - last); last = now;
      s.player.yaw += 0.02; // slow turn so every wall passes through the view
      maxCalls = Math.max(maxCalls, a.world.renderer.info.render.calls); maxTris = Math.max(maxTris, a.world.renderer.info.render.triangles);
      if (now - t0 < secs * 1000) requestAnimationFrame(tick); else resolve({ times, maxCalls, maxTris, scale: a.world.stats.scale });
    };
    requestAnimationFrame(tick);
  }), secs);
  all.push(...r.times);
  console.log(`${(path || 'Home').padEnd(32)} p50 ${pct(r.times, 50).toFixed(1)} ms  p95 ${pct(r.times, 95).toFixed(1)} ms  draw calls ${r.maxCalls}  tris ${r.maxTris}  scale ${r.scale}`);
}
console.log(`\nOVERALL frames ${all.length}  p50 ${pct(all, 50).toFixed(1)} ms  p95 ${pct(all, 95).toFixed(1)} ms  p99 ${pct(all, 99).toFixed(1)} ms`);
await browser.close();
