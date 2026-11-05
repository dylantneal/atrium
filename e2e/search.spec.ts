import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, db: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`/?db=${db}&tour=off`);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await page.evaluate(() => (window as any).atrium.session.search.ready);
  return errors;
}

test('M4: search builds a ranked room, Keep saves it behind a door, and it survives a reload', async ({ page }) => {
  const db = 'e2e-search-' + Date.now();
  const errors = await boot(page, db);
  const ok = await page.evaluate(() => (window as any).atrium.session.enterSearch('crow'));
  expect(ok).toBe(true);
  await page.waitForFunction(() => (window as any).atrium.session.view.room.kind === 'search');
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());
  await expect(page.getByTestId('search-banner')).toContainText('crow');

  const info = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const r = s.view.room;
    const names = r.walls.flatMap((w: any) => w.slots.filter((x: any) => x.itemId).map((x: any) => s.items.get(x.itemId).name));
    return { palette: r.style.palette, count: names.length, names, glow: s.view.appearance().glowing };
  });
  expect(info.palette).toBe(12); // the pale workshop palette marks it as temporary
  expect(info.count).toBeGreaterThan(20);
  expect(info.names.some((n: string) => n.startsWith('crow_'))).toBe(true);
  expect(info.glow).toBeGreaterThan(0); // result lamps

  // Keep: becomes a saved room with a door in Home
  await page.getByTestId('keep-room').click();
  await page.waitForFunction(() => (window as any).atrium.session.view.room.kind === 'saved-view');
  const keptId = await page.evaluate(() => (window as any).atrium.session.currentId as string);
  expect(keptId.startsWith('view:')).toBe(true);
  await expect(page.getByTestId('search-banner')).toContainText('Saved room');

  await page.evaluate(() => (window as any).atrium.session.inventory.flush());
  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await page.evaluate(async () => {
    const s = (window as any).atrium.session;
    await s.enter(s.vfs.rootId, null, true);
  });
  const portal = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const d = s.view.room.doors.find((x: any) => x.portal);
    return d ? { label: d.label, to: d.to, count: s.childCounts.get(d.to) } : null;
  });
  expect(portal).toMatchObject({ label: 'crow', to: keptId });
  expect(portal!.count).toBe(info.count);

  await page.evaluate((id) => (window as any).atrium.session.enter(id, null, false), keptId);
  await page.waitForFunction((id) => (window as any).atrium.session.currentId === id, keptId);
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());
  const again = await page.evaluate(() => (window as any).atrium.session.view.itemCount);
  expect(again).toBe(info.count);

  // deleting removes the door
  await page.getByRole('button', { name: 'Delete room' }).click();
  await page.waitForFunction(() => (window as any).atrium.session.currentId === (window as any).atrium.vfs.rootId);
  expect(await page.evaluate(() => (window as any).atrium.session.view.room.doors.some((x: any) => x.portal))).toBe(false);
  expect(errors).toEqual([]);
});

test('M4: Ctrl+K finds a file despite a typo, opens its room and the file; ">" lists commands', async ({ page }) => {
  await boot(page, 'e2e-launch-' + Date.now());
  await page.keyboard.press('Control+k');
  const box = page.getByLabel('Search', { exact: true });
  await expect(box).toBeFocused();
  await box.fill('animatik');
  // the best match for a typo of "Animatic" is the Animatic room itself
  await expect(page.getByRole('option').first()).toContainText('Animatic');
  await expect(page.getByRole('option').first()).toContainText('Crow Short Film');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).atrium.session.view.room.title === 'Animatic');

  // a file hit takes you to its room and opens it flat
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('crow animatic 02');
  await expect(page.getByRole('option').first()).toContainText('crow_animatic_02.mp4');
  await expect(page.getByRole('option').first()).toContainText('Crow Short Film / Animatic');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('focus')).toBeVisible();
  await expect(page.locator('.focus-title b')).toHaveText('crow_animatic_02.mp4');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();

  await page.keyboard.press('/');
  await page.getByLabel('Search', { exact: true }).fill('>home');
  await expect(page.getByRole('option').first()).toContainText('Go home');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === (window as any).atrium.vfs.rootId);

  // Ctrl+Enter builds a room from all results
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('moodboard');
  await expect(page.getByTestId('show-as-room')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => (window as any).atrium.session.view?.room.kind === 'search');
});
