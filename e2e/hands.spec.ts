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

/** Walk up to a world point, face it, and return where it lands on screen. */
const project = (page: Page, kind: 'item' | 'ghost' | 'door', arg: string | number) =>
  page.evaluate(
    ({ kind, arg }) => {
      const a = (window as any).atrium;
      const s = a.session;
      let pos: any;
      if (kind === 'item') pos = s.view.itemPose(arg).pos;
      else if (kind === 'ghost') {
        const ref = s.view.ghostRef(arg as number);
        pos = s.view.slotWorldPos(ref.side, ref.slot);
      } else {
        const door = s.view.room.doors.find((d: any) => d.to === arg);
        const sp = s.view.spawnBefore(door, 0);
        pos = a.world.camera.position.clone().set(sp.x, 1.2, sp.z);
      }
      // stand 2.5 m from the target, towards the middle of the room (hands reach 6 m, so walk up like a player would)
      const len = Math.hypot(pos.x, pos.z) || 1;
      s.player.place(pos.x - (pos.x / len) * 2.5, pos.z - (pos.z / len) * 2.5, 0);
      const dx = pos.x - s.player.x;
      const dz = pos.z - s.player.z;
      s.player.yaw = Math.atan2(-dx, -dz);
      s.player.pitch = 0;
      s.world.renderOnce();
      const v = pos.clone().project(s.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
    { kind, arg },
  );

const itemId = (page: Page, name: string) =>
  page.evaluate((name) => [...(window as any).atrium.session.items.values()].find((i: any) => i.name === name).id as string, name);

const parentName = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const a = (window as any).atrium;
    const n = await a.vfs.stat(id);
    return (await a.vfs.stat(n.parent)).name as string;
  }, id);

test('M3: carry an item to another room, place it on a chosen spot, then Undo restores it exactly', async ({ page }) => {
  const errors = await boot(page, 'e2e-carry-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Storyboards');
  const id = await itemId(page, 'crow_sb_01.png');
  const home = await page.evaluate((id) => {
    const r = (window as any).atrium.session.view.room;
    for (const w of r.walls) for (const s of w.slots) if (s.itemId === id) return `${w.side}:${s.index}`;
  }, id);

  // pick up with right-click
  const at = await project(page, 'item', id);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).atrium.session.inventory.slots[0])).toBe(id);
  await expect(page.getByTestId('slot-0')).toHaveClass(/full/);
  // the picture left its hook
  expect(await page.evaluate((id) => (window as any).atrium.session.inventory.has(id), id)).toBe(true);

  // carry it to Renders and place it on the first glowing spot
  await enterRoom(page, 'Crow Short Film/Renders');
  const spots = await page.evaluate(() => (window as any).atrium.session.view.freeSpotCount);
  expect(spots).toBeGreaterThan(0);
  const ref = await page.evaluate(() => (window as any).atrium.session.view.ghostRef(0));
  const spot = await project(page, 'ghost', 0);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect.poll(() => parentName(page, id)).toBe('Renders');
  await page.waitForFunction((id) => !(window as any).atrium.session.inventory.has(id), id);

  // it hangs exactly where it was placed
  const placed = await page.evaluate((id) => {
    const r = (window as any).atrium.session.view.room;
    for (const w of r.walls) for (const s of w.slots) if (s.itemId === id) return `${w.side}:${s.index}`;
  }, id);
  expect(placed).toBe(`${ref.side}:${ref.slot}`);
  await expect(page.getByText(/Moved "crow_sb_01.png" here/)).toBeVisible();

  // Undo puts the file and its hook back
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => parentName(page, id)).toBe('Storyboards');
  await enterRoom(page, 'Crow Short Film/Storyboards');
  const back = await page.evaluate((id) => {
    const r = (window as any).atrium.session.view.room;
    for (const w of r.walls) for (const s of w.slots) if (s.itemId === id) return `${w.side}:${s.index}`;
  }, id);
  expect(back).toBe(home);
  expect(errors).toEqual([]);
});

test('M3: the hotbar survives a reload and holds at most eight', async ({ page }) => {
  const db = 'e2e-inv-' + Date.now();
  await boot(page, db);
  await enterRoom(page, 'Reference/Moodboards');
  const ids = await page.evaluate(() => [...(window as any).atrium.session.items.values()].slice(0, 9).map((i: any) => i.id as string));
  const picked = await page.evaluate((ids) => ids.map((id: string) => (window as any).atrium.session.inventory.pickUp(id)), ids);
  expect(picked).toEqual([true, true, true, true, true, true, true, true, false]);
  await page.evaluate(() => (window as any).atrium.session.inventory.flush());
  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  const after = await page.evaluate(() => (window as any).atrium.session.inventory.slots as (string | null)[]);
  expect(after).toEqual(ids.slice(0, 8));
});

test('M3: dropping into a door moves the file into that room; Shift places a copy', async ({ page }) => {
  await boot(page, 'e2e-door-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Scripts');
  const id = await itemId(page, 'crow_script_04.md');
  await page.evaluate((id) => (window as any).atrium.session.inventory.pickUp(id), id);

  // go up to Crow Short Film and drop it into Audio Cues through its door
  await page.evaluate(async () => { const s = (window as any).atrium.session; await s.goUp(); await s.view.whenSettled(); });
  const audioId = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    return s.view.room.doors.find((d: any) => d.label === 'Audio Cues').to as string;
  });
  const door = await project(page, 'door', audioId);
  await page.mouse.click(door.x, door.y, { button: 'right' });
  await expect.poll(() => parentName(page, id)).toBe('Audio Cues');
  await expect.poll(() => page.evaluate(() => (window as any).atrium.session.inventory.slots.filter(Boolean).length)).toBe(0);

  // copy: Shift + place leaves the original and keeps it in hand
  await enterRoom(page, 'Crow Short Film/Renders');
  const orig = await itemId(page, 'crow_render_01.png');
  await page.evaluate((id) => (window as any).atrium.session.inventory.pickUp(id), orig);
  await expect.poll(() => page.evaluate(() => (window as any).atrium.session.view.freeSpotCount)).toBeGreaterThan(0);
  const spot = await project(page, 'ghost', 0);
  await page.keyboard.down('Shift');
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(async () => {
    const a = (window as any).atrium;
    return (await a.vfs.list(a.session.currentId)).filter((n: any) => n.name.startsWith('crow_render_01')).length;
  })).toBe(2);
  expect(await page.evaluate((id) => (window as any).atrium.session.inventory.has(id), orig)).toBe(true);
});

test('M3: trash is recoverable; only Empty trash (with confirmation) destroys', async ({ page }) => {
  await boot(page, 'e2e-trash-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Scripts');
  const id = await itemId(page, 'crow_script_03.md');
  await page.evaluate((id) => (window as any).atrium.session.inventory.pickUp(id), id);
  await page.keyboard.press('Delete');
  await expect.poll(() => parentName(page, id)).toBe('.atrium-trash');

  await page.getByRole('button', { name: 'Open trash' }).click();
  await expect(page.getByTestId('ashes')).toContainText('crow_script_03.md');
  await page.getByTestId('ashes').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => parentName(page, id)).toBe('Scripts');

  // trash again, then empty: confirmation first, and only then it is gone
  await page.evaluate((id) => (window as any).atrium.session.inventory.pickUp(id), id);
  await page.keyboard.press('Delete');
  await expect.poll(() => parentName(page, id)).toBe('.atrium-trash');
  await page.getByTestId('empty-trash').click();
  expect(await page.evaluate(async (id) => !!(await (window as any).atrium.vfs.stat(id).catch(() => null)), id)).toBe(true);
  await page.getByTestId('confirm-empty').click();
  await expect.poll(() => page.evaluate(async (id) => !!(await (window as any).atrium.vfs.stat(id).catch(() => null)), id)).toBe(false);
});
