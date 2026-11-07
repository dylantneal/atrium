import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, db: string, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`/?db=${db}${query}`);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await page.evaluate(() => (window as any).atrium.session.search.ready);
  return errors;
}

test('M4: the welcome tour ticks itself off as you do things, and Skip is remembered', async ({ page }) => {
  const db = 'e2e-tour-' + Date.now();
  const errors = await boot(page, db);
  const tour = page.getByTestId('onboarding');
  await expect(tour).toContainText('Welcome tour · 0 of 6');
  await expect(tour).toContainText('Walk through a door');

  // 1. walk through a door
  await page.evaluate(async () => {
    const s = (window as any).atrium.session;
    const d = s.view.room.doors.find((x: any) => x.label !== 'Back');
    s.standBefore(d);
  });
  await page.keyboard.down('w');
  await expect(tour).toContainText('1 of 6', { timeout: 20_000 });
  await page.keyboard.up('w');

  // 4. focus, 5. search, 6. make it live (each through the real UI path)
  await page.evaluate(async () => {
    const a = (window as any).atrium;
    await a.session.view.whenSettled();
    const id = [...a.session.items.keys()][0];
    await a.focus.open(id);
  });
  await expect(page.getByTestId('focus')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();
  await expect(tour).toContainText('2 of 6', { timeout: 15_000 });
  await page.evaluate(() => (window as any).atrium.session.enterSearch('crow'));
  await expect(tour).toContainText('3 of 6', { timeout: 15_000 });
  await page.evaluate(async () => { const s = (window as any).atrium.session; await s.enter(s.vfs.rootId, null, true); });
  await page.getByTestId('make-live').click();
  await expect(tour).toContainText('4 of 6', { timeout: 15_000 });
  await expect(tour).toContainText('Watch a dim room light up');
  await expect(tour.locator('li.done')).toHaveCount(4);

  await tour.getByRole('button', { name: 'Skip' }).click();
  await expect(tour).toBeHidden();
  await page.evaluate(() => (window as any).atrium.flush());
  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await expect(page.getByTestId('onboarding')).toBeHidden();

  // it can be replayed from settings
  await page.getByTestId('open-settings').click();
  await page.getByRole('button', { name: 'Replay the welcome tour' }).click();
  await expect(page.getByTestId('onboarding')).toContainText('0 of 6');
  expect(errors).toEqual([]);
});

test('M4: graphics quality is a setting: low drops cobwebs and persists across reloads', async ({ page }) => {
  const db = 'e2e-quality-' + Date.now();
  await boot(page, db, '&tour=off');
  const taxes = () =>
    page.evaluate(async () => {
      const a = (window as any).atrium;
      let id = a.vfs.rootId;
      for (const part of ['Taxes & Admin', 'Receipts']) id = (await a.vfs.list(id)).find((k: any) => k.name === part).id;
      await a.session.enter(id, null, true);
      await a.session.view.whenSettled();
      return { cobwebs: a.session.view.appearance().cobwebs, tier: a.world.currentTier, auto: a.world.autoTier };
    });
  expect(await taxes()).toEqual({ cobwebs: 4, tier: 'high', auto: true });
  await page.getByTestId('open-settings').click();
  await page.getByLabel('Low').check();
  await expect.poll(async () => (await taxes()).cobwebs).toBe(0);
  expect(await taxes()).toMatchObject({ tier: 'low', auto: false });

  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await expect.poll(() => page.evaluate(() => (window as any).atrium.world.currentTier)).toBe('low');
});
