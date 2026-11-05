import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, db: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`/?db=${db}&tour=off`);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  return errors;
}
const enterRoom = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const a = (window as any).atrium;
    let id = a.vfs.rootId;
    for (const part of p.split('/').filter(Boolean)) id = (await a.vfs.list(id)).find((k: any) => k.name === part).id;
    await a.session.enter(id, null, true);
    await a.session.view.whenSettled();
    return id as string;
  }, path);

test('M4: active rooms are bright and clean, neglected ones are dim, dusty and cobwebbed', async ({ page }) => {
  const errors = await boot(page, 'e2e-light-' + Date.now());
  const read = (path: string) =>
    page.evaluate(async (p) => {
      const a = (window as any).atrium;
      let id = a.vfs.rootId;
      for (const part of p.split('/').filter(Boolean)) id = (await a.vfs.list(id)).find((k: any) => k.name === part).id;
      await a.session.enter(id, null, true);
      await a.session.view.whenSettled();
      return { ...a.session.view.appearance(), idle: a.session.activity.get(id)?.idleDays };
    }, path);
  const crow = await read('Crow Short Film/Storyboards');
  const taxes = await read('Taxes & Admin/Receipts');
  expect(crow.activity).toBeGreaterThan(0.5);
  expect(taxes.activity).toBeLessThan(0.05);
  expect(crow.cobwebs).toBe(0);
  expect(taxes.cobwebs).toBe(4);
  expect(taxes.dustiestBlue).toBeLessThan(crow.dustiestBlue); // dust darkens pictures
  expect(taxes.idle).toBeGreaterThan(100);
  expect(crow.glowing).toBeGreaterThan(0); // something in Storyboards changed in the last 24 h
  expect(taxes.glowing).toBe(0);
  expect(errors).toEqual([]);
});

test('M4: doors show the activity behind them, and "Make it live" brightens the dimmest one', async ({ page }) => {
  await boot(page, 'e2e-live-' + Date.now());
  await enterRoom(page, '');
  const state = () =>
    page.evaluate(() => {
      const s = (window as any).atrium.session;
      const out: Record<string, number | null> = {};
      for (const d of s.view.room.doors) if (d.label !== 'Back') out[d.label] = s.view.doorBrightness(d.id);
      return out;
    });
  const before = await state();
  expect(before['Crow Short Film']!).toBeGreaterThan(before['Archive 2022']!);
  expect(before['Night Static (Band)']!).toBeGreaterThan(before['Taxes & Admin']!);

  await page.getByTestId('make-live').click();
  await expect.poll(async () => (await state())['Archive 2022'] as number, { timeout: 10_000 }).toBeGreaterThan(before['Archive 2022']! + 0.2);
  const idle = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const id = s.view.room.doors.find((d: any) => d.label === 'Archive 2022').to;
    return s.activity.get(id).idleDays;
  });
  expect(idle).toBe(0);
});
