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

const wallOrder = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).atrium.session;
    const hue = (c: number) => {
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d === 0) return -1;
      const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return h * 60;
    };
    return s.view.room.walls.map((w: any) => w.slots.filter((x: any) => x.itemId).map((x: any) => ({ id: x.itemId, hue: hue(s.items.get(x.itemId).color) })));
  });

test('M4: the docent proposes a colour sort, applies it only on confirmation, and Undo restores the layout', async ({ page }) => {
  const errors = await boot(page, 'e2e-docent-' + Date.now());
  await enterRoom(page, 'Reference/Moodboards');
  const before = await wallOrder(page);

  await page.getByTestId('open-docent').click();
  await page.getByLabel('Ask the docent').fill('sort everything by color');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('proposal')).toContainText('Sorted the room by color');
  // nothing has moved yet
  expect(await wallOrder(page)).toEqual(before);

  await page.getByTestId('apply').click();
  await expect(page.getByTestId('proposal')).toContainText('Applied');
  await expect.poll(async () => JSON.stringify(await wallOrder(page))).not.toBe(JSON.stringify(before));
  const after = await wallOrder(page);
  for (const wall of after) {
    const hues = wall.map((x: any) => x.hue);
    expect(hues).toEqual([...hues].sort((a: number, b: number) => a - b)); // each wall runs along the colour wheel
  }
  // same items on the same walls, only reordered
  for (let i = 0; i < before.length; i++) expect(after[i].map((x: any) => x.id).sort()).toEqual(before[i].map((x: any) => x.id).sort());

  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => JSON.stringify(await wallOrder(page))).toBe(JSON.stringify(before));
  expect(errors).toEqual([]);
});

test('M4: summaries, tag proposals and thread suggestions read the room; a tour can be stopped', async ({ page }) => {
  await boot(page, 'e2e-docent2-' + Date.now());
  await enterRoom(page, 'Crow Short Film/Storyboards');
  await page.getByTestId('open-docent').click();
  const ask = async (t: string) => {
    await page.getByLabel('Ask the docent').fill(t);
    await page.keyboard.press('Enter');
  };
  await ask('summarize this room');
  await expect(page.getByTestId('docent')).toContainText('Storyboards holds 10 items: 10 images');

  await ask('tag everything as film, draft');
  await expect(page.getByTestId('proposal').last()).toContainText('Tag 10 items');
  await page.getByTestId('apply').last().click();
  await expect.poll(() => page.evaluate(async () => {
    const a = (window as any).atrium;
    const kids = (await a.vfs.list(a.session.currentId)) as any[];
    return kids.every((k) => k.tags.includes('film') && k.tags.includes('draft'));
  })).toBe(true);

  await enterRoom(page, 'Crow Short Film/Renders');
  await ask('suggest threads');
  await expect(page.getByTestId('docent')).toContainText(/found \d+ pairs? that look related|do not see related/);

  await ask('give me a tour');
  await expect(page.getByTestId('caption')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('caption').getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('caption')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('docent')).toContainText('Tour stopped');
});
