import { expect, test } from '@playwright/test';

test('M0: loads, enters, renders a lit room, exposes a demo tree', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?perf&db=e2e-smoke-' + Date.now());
  await expect(page.getByRole('button', { name: 'Enter' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('perf')).toContainText('fps');

  const info = await page.evaluate(async () => {
    const a = (window as any).atrium;
    const top = await a.vfs.list(a.vfs.rootId);
    const all = await a.vfs.all();
    return { top: top.map((n: any) => n.name), count: all.length, calls: a.world.renderer.info.render.calls };
  });
  expect(info.top).toContain('Crow Short Film');
  expect(info.top).toContain('Welcome to Atrium.md');
  expect(info.count).toBeGreaterThan(150);

  // canvas is not blank: sample a read-back after a forced frame
  const lit = await page.evaluate(() => {
    const a = (window as any).atrium;
    a.world.renderOnce();
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(a.world.canvas, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (64 * 36 * 3);
  });
  expect(lit).toBeGreaterThan(15);
  await page.screenshot({ path: 'test-results/m0.png' });
  expect(errors).toEqual([]);
});
