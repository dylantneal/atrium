import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';

const shellDir = path.resolve(__dirname, '..');
const appDir = path.resolve(shellDir, '..', 'dist');

async function launch(query = '') {
  const app = await electron.launch({
    executablePath: path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron'),
    args: [shellDir, '--no-sandbox', '--disable-dev-shm-usage', '--disable-component-update', '--disable-background-networking'],
    env: { ...process.env, ATRIUM_SOFTWARE_GL: '1', ATRIUM_HEADLESS: '1', ATRIUM_APP_DIR: appDir, ATRIUM_QUERY: `?tour=off&db=shell-${Date.now()}${query}` },
  });
  const page = await app.firstWindow();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) && problems.push(`console: ${m.text()}`));
  return { app, page, problems };
}

async function enter(page: Page) {
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForFunction(() => (window as any).atrium?.session?.view, undefined, { timeout: 60_000 });
}

let handle: { app: ElectronApplication; page: Page; problems: string[] } | null = null;
test.afterEach(async () => {
  const h = handle;
  handle = null;
  if (!h) return;
  // closing must never hang the suite: ask nicely, then kill
  await Promise.race([h.app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  try {
    h.app.process().kill('SIGKILL');
  } catch {
    /* already gone */
  }
});

test('shell: serves the built app on its own origin, boots under the strict CSP, and exposes only the narrow bridge', async () => {
  handle = await launch();
  const { page, problems } = handle;
  expect(await page.evaluate(() => location.origin)).toBe('atrium://app');
  expect(await page.title()).toBe('Atrium');

  const bridge = await page.evaluate(async () => {
    const b = (window as any).atriumShell;
    return { keys: Object.keys(b).sort(), isShell: b.isShell, pong: await b.ping(), electron: b.versions.electron };
  });
  expect(bridge.isShell).toBe(true);
  expect(bridge.pong).toBe('pong');
  expect(bridge.electron).toMatch(/^45\./);
  expect(bridge.keys).toEqual(['isShell', 'ping', 'platform', 'version', 'versions']);

  await enter(page);
  // everything the CSP could break: WebGL, IndexedDB, the thumbnail and search workers, the lazy CodeMirror chunk
  const lit = await page.evaluate(async () => {
    const a = (window as any).atrium;
    await a.session.view.whenSettled();
    a.world.renderOnce();
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const g = c.getContext('2d')!;
    g.drawImage(a.world.canvas, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (64 * 36 * 3);
  });
  expect(lit).toBeGreaterThan(15);

  const hits = await page.evaluate(async () => {
    const s = (window as any).atrium.session;
    await s.search.ready;
    return (await s.search.query('crow', 5)).length;
  });
  expect(hits).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const a = (window as any).atrium;
    const readme = (await a.vfs.all()).find((n: any) => n.name === 'README.md');
    await a.focus.open(readme.id);
  });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30_000 });
  expect(problems).toEqual([]);
});

test('shell: the page has no Node, cannot open windows, cannot navigate away, and cannot reach the network except the allow-list', async () => {
  handle = await launch();
  const { page, problems } = handle;
  await enter(page);

  const sandbox = await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process, module: typeof (window as any).module }));
  expect(sandbox).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });

  expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);

  // navigation away is blocked by the main process
  await page.evaluate(() => void (location.href = 'https://example.com/'));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => location.origin)).toBe('atrium://app');

  // the CSP's connect-src refuses arbitrary hosts
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'));
  expect(blocked).toBe('blocked');

  // the app origin cannot be used to read files outside the app directory
  const traversal = await page.evaluate(async () => (await fetch('atrium://app/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).status);
  expect([403, 404]).toContain(traversal);

  // responses carry the policy
  const csp = await page.evaluate(async () => (await fetch('atrium://app/index.html')).headers.get('content-security-policy'));
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");

  // the probes above log their own refusals (blocked fetch, CSP, the 404 for the traversal attempt); nothing else may be logged
  const expected = /example\.com|Refused to connect|Failed to fetch|violates the following Content Security Policy|status of 404/i;
  expect(problems.filter((p) => !expected.test(p))).toEqual([]);
  expect(problems.filter((p) => /status of 404/.test(p))).toHaveLength(1);
});
