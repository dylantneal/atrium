import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, db: string, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`/?db=${db}&tour=off${query}`);
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
  }, path);

const info = (page: Page) => page.evaluate(() => (window as any).atrium.session.view.ambientInfo());
const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;

const NOON = '2026-06-21T16:56:00Z'; // New York solar noon, June solstice
const NIGHT = '2026-06-21T04:00:00Z'; // midnight local

test('A1: windows appear in the unused door bays and the sky outside follows the clock', async ({ page }) => {
  const errors = await boot(page, 'e2e-sky-' + Date.now(), `&now=${NOON}&weather=clear`);
  await enterRoom(page, 'Crow Short Film/Storyboards');
  const day = await info(page);
  expect(day.windows).toBe(3); // a 6x6 room has one bay per wall; the south one holds the Back door
  expect(day.hasClock).toBe(true);
  expect(Object.keys(day.sky).sort()).toEqual(['E', 'N', 'W']);

  await page.evaluate((t) => (window as any).atrium.ambient.setNow(Date.parse(t)), NIGHT);
  const night = await info(page);
  expect(lum(night.sky.N.zenith)).toBeLessThan(lum(day.sky.N.zenith));
  expect(night.sky.N.stars).toBeGreaterThan(0.9);
  expect(day.sky.N.stars).toBe(0);
  expect(night.dayMul).toBeLessThan(day.dayMul); // the room is moodier at night
  expect(night.dayMul).toBeGreaterThanOrEqual(0.5); // but never black: lamps are on
  expect(day.dayMul).toBeCloseTo(1, 1);
  expect(errors).toEqual([]);
});

test('A1: weather shows in the windows and rain is audible; snow and fog are quiet', async ({ page }) => {
  await boot(page, 'e2e-wx-' + Date.now(), `&now=${NOON}&weather=rain`);
  await enterRoom(page, 'Crow Short Film/Storyboards');
  expect((await info(page)).sky.N.precip).toBe('rain');
  expect(await page.evaluate(() => (window as any).atrium.audio.rainLevel)).toBeGreaterThan(0.3);

  await page.evaluate(() => (window as any).atrium.ambient.force('snow'));
  expect((await info(page)).sky.N.precip).toBe('snow');
  expect(await page.evaluate(() => (window as any).atrium.audio.rainLevel)).toBe(0);

  await page.evaluate(() => (window as any).atrium.ambient.force('clear'));
  const clear = await info(page);
  expect(clear.sky.N.precip).toBe('none');
  await page.evaluate(() => (window as any).atrium.ambient.force('cloud'));
  expect((await info(page)).sky.N.cloud).toBeGreaterThan(0.9);
  // overcast daylight is dimmer and greyer than clear
  expect((await info(page)).dayMul).toBeLessThanOrEqual(clear.dayMul);
});

test('A1: the wall clock redraws each minute and the sun sits in the right window', async ({ page }) => {
  await boot(page, 'e2e-clock-' + Date.now(), `&now=2026-06-21T09:40:00Z&weather=clear`); // sunrise in New York
  await enterRoom(page, 'Crow Short Film/Storyboards');
  const a = await info(page);
  const t = Date.parse('2026-06-21T09:40:00Z');
  expect(a.clockMinute).toBe(Math.floor(t / 60000));
  await page.evaluate(() => (window as any).atrium.ambient.advance(5 * 60_000));
  expect((await info(page)).clockMinute).toBe(Math.floor(t / 60000) + 5);
  // morning sun is in the east: visible in the east window, not the west one
  const sky = (await info(page)).sky;
  expect(sky.E.sunPos).not.toBeNull();
  expect(sky.W.sunPos).toBeNull();
  // and in the evening it has moved to the west window
  await page.evaluate(() => (window as any).atrium.ambient.setNow(Date.parse('2026-06-22T00:10:00Z')));
  const eve = (await info(page)).sky;
  expect(eve.W.sunPos).not.toBeNull();
  expect(eve.E.sunPos).toBeNull();
});

test('A1: the Weather Deck is in the Hall, shows the forecast, and its table opens the flat view', async ({ page }) => {
  const errors = await boot(page, 'e2e-deck-' + Date.now(), `&now=${NOON}&weather=rain`);
  await page.keyboard.press('a');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:hall');
  expect(await page.evaluate(() => (window as any).atrium.session.view.room.doors.some((d: any) => d.to === 'app:weather'))).toBe(true);

  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('>weather deck');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).atrium.session.currentId === 'app:weather');
  await expect(page.locator('nav.hud-top')).toContainText('Weather Deck');
  const deck = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    let bars = 0;
    s.view.group.traverse((o: any) => o.isInstancedMesh && o.count === 24 && (bars += 1));
    s.world.renderOnce();
    return { bars, windows: s.view.ambientInfo().windows, calls: s.world.renderer.info.render.calls, kind: s.view.room.kind };
  });
  expect(deck.kind).toBe('app');
  expect(deck.bars).toBe(1); // 24 hourly bars in one draw call
  expect(deck.windows).toBeGreaterThanOrEqual(3);
  expect(deck.calls).toBeLessThanOrEqual(80);

  // look at the table and click it: the aim plate names it, then the flat view opens
  const pos = await page.evaluate(() => {
    const s = (window as any).atrium.session;
    const o = s.view.group.children.find((c: any) => c.userData.appObject?.objectId === 'table');
    const p = o.getWorldPosition(new (window as any).atrium.three.Vector3());
    return { x: p.x, y: 0.95, z: p.z };
  });
  await page.evaluate((p) => {
    const s = (window as any).atrium.session;
    s.player.place(p.x, p.z + 2.3, 0);
    s.player.pitch = Math.atan2(p.y - 1.6, 2.3);
    s.world.renderOnce();
  }, pos);
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ui.get().aim?.name)).toBe('Forecast table');
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await expect(page.getByTestId('weather-surface')).toBeVisible();
  await expect(page.getByTestId('weather-label')).toContainText('Rain');
  await expect(page.getByTestId('weather-source')).toContainText('Demo sky');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus')).toBeHidden();
  expect(errors).toEqual([]);
});

const PARIS_FIXTURE = {
  utc_offset_seconds: 7200,
  current: { time: '2026-06-21T18:00', temperature_2m: 19.2, weather_code: 61, wind_speed_10m: 12.4, is_day: 1 },
  hourly: { time: ['2026-06-21T18:00', '2026-06-21T19:00', '2026-06-21T20:00'], temperature_2m: [19.2, 18.4, 17.1], weather_code: [61, 61, 3], precipitation_probability: [80, 70, 30] },
  daily: { time: ['2026-06-21', '2026-06-22'], weather_code: [61, 0], temperature_2m_max: [21, 24], temperature_2m_min: [14, 13] },
};

test('A1: choose a place, get live weather (mocked), keep it across a reload, and survive a failed refresh', async ({ page }) => {
  let weatherStatus = 200;
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Paris', admin1: 'Île-de-France', country_code: 'FR', latitude: 48.85, longitude: 2.35 }] } }));
  await page.route('https://api.open-meteo.com/**', (r) => (weatherStatus === 200 ? r.fulfill({ json: PARIS_FIXTURE }) : r.fulfill({ status: weatherStatus, body: 'down' })));
  const db = 'e2e-live-' + Date.now();
  await boot(page, db, `&now=2026-06-21T16:30:00Z`);

  await page.keyboard.press('Control+k');
  await page.getByLabel('Search', { exact: true }).fill('>weather: details');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('weather-surface')).toBeVisible();
  await expect(page.getByTestId('weather-source')).toContainText('Demo sky');

  await page.getByLabel('Place search').fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('option').or(page.getByRole('button', { name: /Paris, Île-de-France, FR/ })).first().click();
  await expect(page.getByTestId('weather-source')).toContainText('Live from Open-Meteo');
  await page.getByRole('button', { name: '°C · km/h' }).click();
  await expect(page.getByTestId('weather-temp')).toHaveText('19°C');
  await expect(page.getByTestId('weather-label')).toContainText('Light rain');
  await page.getByRole('button', { name: '°F · mph' }).click();
  await expect(page.getByTestId('weather-temp')).toHaveText('67°F');

  // the world followed: windows now show rain
  await page.keyboard.press('Escape');
  await enterRoom(page, 'Crow Short Film/Storyboards');
  expect((await info(page)).sky.N.precip).toBe('rain');

  // a failed refresh keeps the last forecast and reports it
  weatherStatus = 503;
  await page.evaluate(() => (window as any).atrium.ambient.refresh(true));
  const st = await page.evaluate(() => { const s = (window as any).atrium.ambient.store.get(); return { err: s.error, label: s.conditions.label, source: s.source }; });
  expect(st.err).toMatch(/503/);
  expect(st).toMatchObject({ label: 'Light rain', source: 'live' });
  weatherStatus = 200;

  // the place is remembered
  await page.evaluate(() => (window as any).atrium.flush());
  await page.reload();
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view);
  await expect.poll(() => page.evaluate(() => (window as any).atrium.ambient.store.get().place.name)).toBe('Paris, Île-de-France, FR');
});

test('A1: demo commands jump the sky to sunrise, noon, sunset and midnight, and back to now', async ({ page }) => {
  await boot(page, 'e2e-skycmd-' + Date.now(), `&weather=clear`);
  const run = async (cmd: string) => {
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search', { exact: true }).fill(`>${cmd}`);
    await page.keyboard.press('Enter');
  };
  const altDeg = () => page.evaluate(() => (window as any).atrium.ambient.store.get().sun.altitude * 180 / Math.PI);
  await run('sky: jump to sunset');
  expect(await altDeg()).toBeCloseTo(-0.83, 0);
  await run('sky: jump to noon');
  expect(await altDeg()).toBeGreaterThan(20);
  await run('sky: jump to midnight');
  expect(await altDeg()).toBeLessThan(0);
  await run('sky: back to the real time');
  expect(Math.abs((await page.evaluate(() => (window as any).atrium.ambient.now - Date.now())))).toBeLessThan(5000);
  await run('sky: show storm weather');
  expect(await page.evaluate(() => (window as any).atrium.ambient.store.get().conditions.thunder)).toBe(true);
});
