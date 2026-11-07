import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only door between the web app and the desktop. Everything here is narrow, typed and named for what it does.
 * Later milestones add `fs` (real folders) and `web` (real pages as textures) to this object.
 */
const bridge = {
  isShell: true as const,
  version: '0.0.0',
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  /** Round trip to the main process; used by tests and by the app to confirm the bridge is alive. */
  ping: (): Promise<string> => ipcRenderer.invoke('shell:ping'),
};

contextBridge.exposeInMainWorld('atriumShell', bridge);

export type AtriumShellBridge = typeof bridge;
