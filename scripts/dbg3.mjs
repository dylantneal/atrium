import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
await page.goto('http://localhost:4173/?tour=off&db=d3-' + Date.now());
await page.getByRole('button', { name: 'Enter' }).click();
await page.waitForFunction(() => window.atrium?.session?.view);
console.log(JSON.stringify(await page.evaluate(() => { const w = window.atrium.world; const out = []; for (let i = 0; i < 31; i++) out.push(w.scaler.frame(100)); return { last: out.slice(-3), scale: w.scaler.scale, max: w.scaler.max, min: w.scaler.min }; })));
for (let i = 0; i < 1; i++) {
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(await page.evaluate(() => { const w = window.atrium.world; return { stats: w.stats, tier: w.currentTier, auto: w.autoTier, paused: w.paused }; })));
}
await browser.close();
