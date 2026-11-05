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

/** Faces an item from the middle of the room and returns its screen position. */
const aimAt = (page: Page, name: string) =>
  page.evaluate((name) => {
    const a = (window as any).atrium;
    const s = a.session;
    const item = [...s.items.values()].find((i: any) => i.name === name);
    const pose = s.view.itemPose(item.id);
    s.player.place(0, 0, 0);
    const dx = pose.pos.x - s.player.x;
    const dz = pose.pos.z - s.player.z;
    s.player.yaw = Math.atan2(-dx, -dz);
    s.player.pitch = 0;
    s.world.renderOnce();
    const v = pose.pos.clone().project(s.camera);
    return { id: item.id as string, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }, name);

test('M2: click an item, edit it flat, autosave with a version, Esc returns to the same pose', async ({ page }) => {
  const errors = await boot(page, 'e2e-focus-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Scripts');
  const target = await aimAt(page, 'crow_script_01.md');
  const before = await page.evaluate(() => {
    const p = (window as any).atrium.session.player;
    return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch };
  });

  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId('focus')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await expect(page.getByTestId('md-preview')).toContainText('crow script 01');

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nEDITED BY TEST');
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('md-preview')).toContainText('EDITED BY TEST');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 6000 }); // autosave after 2 s

  const saved = await page.evaluate(async (id) => (await (await (window as any).atrium.vfs.read(id)).text()) as string, target.id);
  expect(saved).toContain('EDITED BY TEST');
  await expect(page.getByTestId('versions').locator('li')).toHaveCount(1); // snapshot of the original

  await page.keyboard.press('Escape'); // blur editor focus handled, then close
  if (await page.getByTestId('focus').isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();
  await page.waitForFunction(() => !(window as any).atrium.session.paused);
  const after = await page.evaluate(() => {
    const p = (window as any).atrium.session.player;
    return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch };
  });
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('M2: Ctrl+S saves immediately, rename and tags go through the drawer, and Undo reverts the rename', async ({ page }) => {
  await boot(page, 'e2e-drawer-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Scripts');
  const t = await aimAt(page, 'crow_script_02.md');
  await page.evaluate((id) => (window as any).atrium.focus.open(id), t.id);
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.type('X');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const name = page.getByTestId('name-input');
  await name.fill('renamed_script.md');
  await name.press('Enter');
  await expect(page.locator('.focus-title b')).toHaveText('renamed_script.md');
  await page.getByPlaceholder('comma separated').fill('film, draft');
  await page.getByPlaceholder('comma separated').press('Enter');
  await expect.poll(() => page.evaluate(async (id) => (await (window as any).atrium.vfs.stat(id)).tags.join(','), t.id)).toBe('film,draft');

  await page.evaluate(() => (window as any).atrium.focus.close());
  await page.evaluate(async () => { await (window as any).atrium.bus.undo(); await (window as any).atrium.bus.undo(); });
  const n = await page.evaluate(async (id) => (await (window as any).atrium.vfs.stat(id)).name, t.id);
  expect(n).toBe('crow_script_02.md');
});

test('M2: a failed write keeps the buffer, shows a banner, and Retry saves it', async ({ page }) => {
  await boot(page, 'e2e-fail-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Scripts');
  const t = await aimAt(page, 'crow_script_03.md');
  await page.evaluate((id) => {
    const a = (window as any).atrium;
    a.__realWrite = a.vfs.write.bind(a.vfs);
    a.vfs.write = async () => { throw new Error('disk is read-only'); };
    return a.focus.open(id);
  }, t.id);
  await page.locator('.cm-content').click();
  await page.keyboard.type('KEEP ME');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('disk is read-only');
  await expect(page.locator('.cm-content')).toContainText('KEEP ME');

  await page.evaluate(() => { const a = (window as any).atrium; a.vfs.write = a.__realWrite; });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  const saved = await page.evaluate(async (id) => (await (await (window as any).atrium.vfs.read(id)).text()) as string, t.id);
  expect(saved).toContain('KEEP ME');
});

test('M2: list view lists the room, opens items, and focus mode is reachable by keyboard alone', async ({ page }) => {
  await boot(page, 'e2e-list-' + Date.now());
  await enterRoom(page, 'Reference/Moodboards');
  await page.keyboard.press('l');
  const list = page.getByTestId('listview');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: /ref_01\.png/ })).toBeVisible();
  await list.getByRole('button', { name: /ref_01\.png/ }).click();
  await expect(page.getByTestId('focus')).toBeVisible();
  await expect(page.locator('.img-viewer img')).toBeVisible();
  await page.keyboard.press(']');
  await expect(page.locator('.focus-title b')).toHaveText(/ref_\d+\.png/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();
});
