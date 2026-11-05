import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, db: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`/?db=${db}`);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  return errors;
}

const nodeIdByPath = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const a = (window as any).atrium;
    let id = a.vfs.rootId;
    for (const part of p.split('/').filter(Boolean)) id = (await a.vfs.list(id)).find((k: any) => k.name === part).id;
    return id as string;
  }, path);

test('M1: the same folder generates identical rooms across reloads and fresh databases', async ({ page }) => {
  const db = 'e2e-det-' + Date.now();
  await boot(page, db);
  const id = await nodeIdByPath(page, 'Crow Short Film/Storyboards');
  const roomJson = () =>
    page.evaluate(async (id) => {
      const a = (window as any).atrium;
      await a.session.enter(id, null, true);
      const r = a.session.view.room;
      return JSON.stringify({ ...r, context: undefined, activity: undefined });
    }, id);
  const first = await roomJson();
  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  const second = await roomJson();
  expect(second).toBe(first);

  // a brand-new database regenerates exactly the same room (ids are deterministic in the demo)
  const page2 = await page.context().newPage();
  await boot(page2, 'e2e-det-b-' + Date.now());
  const id2 = await nodeIdByPath(page2, 'Crow Short Film/Storyboards');
  expect(id2).toBe(id);
  const third = await page2.evaluate(async (id) => {
    const a = (window as any).atrium;
    await a.session.enter(id, null, true);
    const r = a.session.view.room;
    return JSON.stringify({ ...r, context: undefined, activity: undefined });
  }, id2);
  expect(third).toBe(first);
});

test('M1: walking into a door travels, and B goes back up', async ({ page }) => {
  const errors = await boot(page, 'e2e-walk-' + Date.now());
  const crow = await nodeIdByPath(page, 'Crow Short Film');
  const room = await page.evaluate(async (id) => {
    const a = (window as any).atrium;
    await a.session.enter(id, null, true);
    const door = a.session.view.room.doors.find((d: any) => d.to !== a.session.view.room.doors.find((x: any) => x.side === 'S')?.to);
    a.session.standBefore(door);
    return { door: door.to, from: id };
  }, crow);
  await page.keyboard.down('w');
  await page.waitForFunction((from) => (window as any).atrium.session.currentId !== from, room.from, { timeout: 20_000 });
  await page.keyboard.up('w');
  const now = await page.evaluate(() => (window as any).atrium.session.currentId);
  expect(now).toBe(room.door);
  await page.waitForFunction(() => !(window as any).atrium.ui.get().fade);
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());
  await expect(page.locator('nav.hud-top')).toContainText('Crow Short Film');

  await page.keyboard.press('b');
  await page.waitForFunction((id) => (window as any).atrium.session.currentId === id, room.from, { timeout: 10_000 });
  // arriving from a child puts you just outside that child's door, facing into the room
  const arrival = await page.evaluate((child) => {
    const s = (window as any).atrium.session;
    const door = s.view.room.doors.find((d: any) => d.to === child);
    const spot = s.view.spawnBefore(door, 1.6);
    return { dist: Math.hypot(s.player.x - spot.x, s.player.z - spot.z), yawDiff: Math.abs(Math.atan2(Math.sin(s.player.yaw - spot.yaw - Math.PI), Math.cos(s.player.yaw - spot.yaw - Math.PI))) };
  }, room.door);
  expect(arrival.dist).toBeLessThan(0.3);
  expect(arrival.yawDiff).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('M1: a room stays within the draw-call budget and every thumbnail paints', async ({ page }) => {
  await boot(page, 'e2e-budget-' + Date.now());
  const id = await nodeIdByPath(page, 'Reference/Moodboards');
  const stats = await page.evaluate(async (id) => {
    const a = (window as any).atrium;
    await a.session.enter(id, null, true);
    await a.session.view.whenSettled();
    a.world.renderOnce();
    return { calls: a.world.renderer.info.render.calls, tris: a.world.renderer.info.render.triangles, items: a.session.view.itemCount };
  }, id);
  expect(stats.items).toBe(22);
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.tris).toBeLessThanOrEqual(150_000);
});
