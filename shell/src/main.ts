import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Atrium's desktop shell. It serves the built web app from a private `atrium://app/` origin (so the app is a normal
 * secure web origin with IndexedDB, workers and fetch) and adds capabilities the browser cannot have, reached only
 * through the narrow `window.atriumShell` bridge in the preload script.
 *
 * Security posture: context isolation and the renderer sandbox are on, there is no Node in the page, every permission
 * request is denied unless allow-listed below, navigation away from the app origin is blocked, and the app is served
 * with a strict Content-Security-Policy.
 */

const APP_ORIGIN = 'atrium://app';
const APP_DIR = path.resolve(process.env.ATRIUM_APP_DIR ?? path.join(__dirname, '..', '..', 'dist'));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // keyless public APIs the first-party apps use (weather)
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'atrium', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

if (process.env.ATRIUM_SOFTWARE_GL === '1') {
  // headless CI and containers have no GPU: render WebGL in software
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

/** Only these permissions are ever granted, and only to the app itself. */
const ALLOWED_PERMISSIONS = new Set(['geolocation', 'clipboard-sanitized-write', 'fullscreen']);

function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

async function serveApp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(APP_DIR, rel));
  // never serve anything outside the app directory (path traversal)
  if (file !== APP_DIR && !file.startsWith(APP_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  let res: Response;
  try {
    res = await net.fetch(pathToFileURL(file).toString());
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Content-Security-Policy': CSP } });
  }
  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: res.status, headers });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#14121a',
    show: process.env.ATRIUM_HEADLESS !== '1',
    title: 'Atrium',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  // the page can never open windows or launch the user's browser on its own: denied outright.
  // (Opening a link in the system browser will be an explicit, validated bridge call, never a side effect of window.open.)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  void win.loadURL(`${APP_ORIGIN}/index.html${process.env.ATRIUM_QUERY ?? ''}`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle('atrium', serveApp);
  ipcMain.handle('shell:ping', () => 'pong');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && !!wc && isAppUrl(wc.getURL()));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
