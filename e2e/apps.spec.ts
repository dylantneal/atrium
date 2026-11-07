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

/** A throwaway app that uses every extension point through the public registry, exactly as a real app would. */
const registerProbe = (page: Page) =>
  page.evaluate(async () => {
    const a = (window as any).atrium;
    const T = a.three;
    const { AppRoom, makeAppRoom, h } = a.kit;
    (window as any).__probe = { presses: 0, xkey: 0, activated: '', disposed: 0 };
    await a.apps.register({
      id: 'probe',
      name: 'Probe',
      icon: '◆',
      tool: {
        name: 'Probe',
        description: 'A test tool',
        create() {
          const g = new T.Group();
          const body = new T.Mesh(new T.BoxGeometry(0.3, 0.2, 0.04), new T.MeshStandardMaterial({ color: 0x335577 }));
          const key = new T.Mesh(new T.BoxGeometry(0.08, 0.08, 0.03), new T.MeshStandardMaterial({ color: 0xffaa33 }));
          key.position.set(0, 0, 0.04);
          g.add(body, key);
          return {
            object: g,
            pick: (ray: any) => (ray.intersectObject(key, true).length ? 'key1' : null),
            onPress: () => void ((window as any).__probe.presses += 1),
            onKey: (k: string) => (k === 'x' ? (((window as any).__probe.xkey += 1), true) : false),
            dispose: () => void ((window as any).__probe.disposed += 1),
          };
        },
      },
      room: {
        title: 'Probe Room',
        describe: (id: string) => ({ name: id === 'cube' ? 'The cube' : id, detail: 'a test object', hint: 'Click it' }),
        onActivate: (_ctx: any, id: string) => void ((window as any).__probe.activated = id),
        build(_ctx: any, deps: any) {
          const data = makeAppRoom({ id: 'app:probe', title: 'Probe Room', width: 6, depth: 6, backTo: 'app:hall' });
          const room = new AppRoom({ ...deps, room: data, items: new Map() }, 'probe');
          const cube = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 0.6), new T.MeshStandardMaterial({ color: 0xcc4444 }));
          cube.position.set(0, 0.8, -1.5);
          room.addObject(cube, 'cube');
          return room;
        },
      },
      surface: { title: (p: any) => `Probe surface ${p?.x}`, render: (p: any) => h('div', { id: 'probe-surface' }, `Hello from the probe, x=${p?.x}`) },
    });
  });

/** Stand 2.5 m from a world point (towards the room centre), face it, return its screen position. */
const aimAtPoint = (page: Page, point: { x: number; y: number; z: number }) =>
  page.evaluate((p) => {
    const s = (window as any).atrium.session;
    const len = Math.hypot(p.x, p.z) || 1;
    s.player.place(p.x - (p.x / len) * 2.5, p.z - (p.z / len) * 2.5, 0);
    s.player.yaw = Math.atan2(-(p.x - s.player.x), -(p.z - s.player.z));
    s.player.pitch = 0;
    s.world.renderOnce();
    const v = new (window as any).atrium.three.Vector3(p.x, p.y, p.z).project(s.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }, point);

test('A0: the Hall lists apps and tools, and Home has a door to it', async ({ page }) => {
  const errors = await boot(page, 'e2e-hall-' + Date.now());
  await registerProbe(page);
  // Home gets a portal to the Hall
  expect(await page.evaluate(() => (window as any).atrium.session.view.room.doors.some((d: any) => d.to === 'app:hall' && d.portal))).toBe(true);

  await page.keyboard.press('a');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());
  await expect(page.locator('nav.hud-top')).toContainText('Apps');
  const hall = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    return {
      doors: s.view.room.doors.map((d: any) => `${d.label}:${d.to}`),
      tools: [...s.items.values()].map((i: any) => `${i.id}:${i.kind}`),
      calls: (s.world.renderOnce(), s.world.renderer.info.render.calls),
      kind: s.view.room.kind,
    };
  });
  expect(hall.kind).toBe('app');
  expect(hall.doors).toContain('Probe Room:app:probe');
  expect(hall.doors).toContain('Back:' + (await page.evaluate(() => (window as any).atrium.vfs.rootId)));
  expect(hall.tools).toEqual(['tool:probe:tool']);
  expect(hall.calls).toBeLessThanOrEqual(60);

  // B goes up to Home
  await page.keyboard.press('b');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === (window as any).atrium.vfs.rootId);
  expect(errors).toEqual([]);
});

test('A0: a tool is taken from the shelf, raised in hand, pressed by pointer and key, and lowered', async ({ page }) => {
  const errors = await boot(page, 'e2e-tool-' + Date.now());
  await registerProbe(page);
  await page.keyboard.press('a');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());

  const pos = await page.evaluate(() => {
    const p = (window as any).atrium.session.view.itemPose('tool:probe').pos;
    return { x: p.x, y: p.y, z: p.z };
  });
  const at = await aimAtPoint(page, pos);
  await page.mouse.click(at.x, at.y, { button: 'right' }); // pick up
  await expect.poll(() => page.evaluate(() => (window as any).atrium.session.inventory.slots[0])).toBe('tool:probe');
  await expect(page.getByText('Took the Probe')).toBeVisible();
  await expect(page.getByTestId('slot-0')).toHaveClass(/full/);
  // taking a tool is not the "pick up an image" tour step
  // R raises it; the hotbar shows the raise button as pressed
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().raised)).toBe('Probe');
  await expect(page.getByTestId('raise-tool')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).atrium.session.raised.appId)).toBe('probe');

  // a key the tool handles is consumed by the tool, not the world (x is unbound in the world anyway; 'b' would go up)
  await page.keyboard.press('x');
  expect(await page.evaluate(() => (window as any).__probe.xkey)).toBe(1);

  // tap the tool's key with the pointer: a ray from the screen point hits the key in hand
  const keyScreen = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    s.world.renderOnce();
    const key = s.raised.instance.object.children[1];
    const v = key.getWorldPosition(new (window as any).atrium.three.Vector3()).project(s.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.mouse.click(keyScreen.x, keyScreen.y);
  await expect.poll(() => page.evaluate(() => (window as any).__probe.presses)).toBe(1);

  // the hand pass draws on top: the tool is visible in the final frame
  const handDrawn = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    return s.world.handScene.children.some((c: any) => c.visible && !c.isLight && c.children.length > 0);
  });
  expect(handDrawn).toBe(true);

  // placing a tool on a wall is refused; Esc lowers it and disposes it
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().raised)).toBeNull();
  expect(await page.evaluate(() => (window as any).__probe.disposed)).toBe(1);

  // selecting another slot while raised lowers it too
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().raised)).toBe('Probe');
  await page.keyboard.press('2');
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().raised)).toBeNull();

  // tools never show wall placement spots, even when carried into a folder room
  await page.keyboard.press('1');
  await page.evaluate(async () => {
    const a = (window as any).atrium;
    const id = (await a.vfs.list(a.vfs.rootId)).find((n: any) => n.name === 'Crow Short Film').id;
    await a.session.enter(id, null, true);
  });
  expect(await page.evaluate(() => (window as any).atrium.session.view.freeSpotCount)).toBe(0);

  // putting it back (Q) returns it to the shelf
  await page.keyboard.press('q');
  expect(await page.evaluate(() => (window as any).atrium.session.inventory.slots[0])).toBeNull();
  expect(errors).toEqual([]);
});

test('A0: an app room is reached through the Hall, objects respond, and surfaces open flat', async ({ page }) => {
  const errors = await boot(page, 'e2e-room-' + Date.now());
  await registerProbe(page);
  await page.keyboard.press('a');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  await page.evaluate(() => (window as any).atrium.session.view.whenSettled());
  await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const d = s.view.room.doors.find((x: any) => x.to === 'app:probe');
    s.standBefore(d);
  });
  await page.keyboard.down('w');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:probe', undefined, { timeout: 20_000 });
  await page.keyboard.up('w');
  await expect(page.locator('nav.hud-top')).toContainText('Probe Room');
  await expect(page.locator('nav.hud-top')).toContainText('Apps');

  // the cube is aimable and clickable; the aim plate uses the app's description
  const cube = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const o = s.view.group.children.find((c: any) => c.userData.appObject);
    const p = o.getWorldPosition(new (window as any).atrium.three.Vector3());
    return { x: p.x, y: p.y, z: p.z };
  });
  await aimAtPoint(page, cube);
  // the aim plate follows the crosshair, so look straight at the cube (it sits below eye height)
  await page.evaluate((y) => { const s = (window as any).atrium.session; s.player.pitch = Math.atan2(y - 1.6, 2.5); }, cube.y);
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().aim?.name), { timeout: 5000 }).toBe('The cube');
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2); // the crosshair is on the cube
  await expect.poll(() => page.evaluate(() => (window as any).__probe.activated)).toBe('cube');

  // an app opens its flat surface, and Esc returns to exactly where the player stood
  const before = await page.evaluate(() => { const p = (window as any).atrium.session.player; return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }; });
  await page.evaluate(() => (window as any).atrium.apps.context('probe').session.openSurface('probe', { x: 7 }));
  await expect(page.getByTestId('surface')).toContainText('Hello from the probe, x=7');
  await expect(page.getByTestId('focus')).toHaveAttribute('aria-label', 'Probe surface 7');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();
  await page.waitForFunction(() => !(window as any).atrium.session.paused);
  expect(await page.evaluate(() => { const p = (window as any).atrium.session.player; return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }; })).toEqual(before);

  // B goes up one level at a time: Probe Room, then the Hall, then Home
  await page.keyboard.press('b');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  await page.keyboard.press('b');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === (window as any).atrium.vfs.rootId);

  // unregistering an app removes its door
  await page.evaluate(() => (window as any).atrium.apps.unregister('probe'));
  await page.keyboard.press('a');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  expect(await page.evaluate(() => (window as any).atrium.session.view.room.doors.some((d: any) => d.to === 'app:probe'))).toBe(false);
  expect(errors).toEqual([]);
});

test('A0: the built-in panels now come from the registry (docent, settings, trash) and still work', async ({ page }) => {
  await boot(page, 'e2e-builtin-' + Date.now());
  const ids = await page.evaluate(() => (window as any).atrium.apps.list().map((a: any) => a.id));
  expect(ids).toEqual(expect.arrayContaining(['docent', 'settings', 'trash']));
  await page.getByTestId('open-docent').click();
  await expect(page.getByTestId('docent')).toBeVisible();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByRole('button', { name: 'Open trash' }).click();
  await expect(page.getByTestId('ashes')).toBeVisible();
  // their launcher commands come from the registry too
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('>docent');
  await expect(page.getByRole('option').first()).toContainText('Ask the docent');
});
