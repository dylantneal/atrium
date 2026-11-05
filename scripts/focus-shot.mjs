import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
await page.goto('http://localhost:4173/?db=fs-' + Date.now());
await page.getByRole('button', { name: 'Enter' }).click();
await page.waitForFunction(() => window.atrium?.session?.view);
const open = async (path, name, out) => {
  await page.evaluate(async ({ path, name }) => {
    const a = window.atrium; let id = a.vfs.rootId;
    for (const part of path.split('/')) id = (await a.vfs.list(id)).find((k) => k.name === part).id;
    await a.session.enter(id, null, true); await a.session.view.whenSettled();
    const it = [...a.session.items.values()].find((i) => i.name === name);
    await a.focus.open(it.id);
  }, { path, name });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out });
  await page.evaluate(() => window.atrium.focus.close());
  await page.waitForTimeout(400);
};
await open('Crow Short Film/Scripts', 'crow_script_01.md', 'test-results/focus-md.png');
await open('Crow Short Film/Storyboards', 'crow_sb_03.png', 'test-results/focus-img.png');
await browser.close();
