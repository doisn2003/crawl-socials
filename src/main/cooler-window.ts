import { BrowserWindow, ipcMain } from 'electron';
import type { Session } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { allowDesktopRequest } from './ipc-policy.js';
import type { CoolerProgress } from '../shared/production-api.js';

export function createCoolerWindow(input: { preferenceFile: string; session: Session; getProgress(): CoolerProgress }) {
  let enabled = false, window: BrowserWindow | null = null, disposed = false;
  if (existsSync(input.preferenceFile)) {
    const saved = JSON.parse(readFileSync(input.preferenceFile, 'utf8')) as unknown;
    if (!saved || typeof saved !== 'object' || Object.keys(saved).join() !== 'enabled' || typeof (saved as { enabled?: unknown }).enabled !== 'boolean') throw Error('COOLER_PREFERENCE_INVALID');
    enabled = (saved as { enabled: boolean }).enabled;
  }
  const file = fileURLToPath(new URL('../renderer/cooler.html', import.meta.url)), url = pathToFileURL(file).href;
  ipcMain.handle('csd:cooler:progress', (event, ...args: unknown[]) => {
    if (!window || disposed || !allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: window.webContents.id,
      isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: url, args })) throw Error('IPC_DENIED');
    return input.getProgress();
  });
  function close() { window?.destroy(); window = null; }
  function show() {
    if (!enabled || disposed) return;
    if (window && !window.isDestroyed()) { window.restore(); window.show(); window.focus(); return; }
    const current = new BrowserWindow({ title: 'CSD > Make it cooler', width: 980, height: 680, minWidth: 560, minHeight: 400,
      show: false, backgroundColor: '#020804', autoHideMenuBar: true,
      webPreferences: { preload: fileURLToPath(new URL('../preload/cooler.cjs', import.meta.url)), session: input.session,
        nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, backgroundThrottling: true } });
    window = current; current.removeMenu();
    current.once('ready-to-show', () => { if (!current.isDestroyed()) current.show(); });
    current.on('closed', () => { if (window === current) window = null; });
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', event => event.preventDefault());
    current.webContents.on('will-redirect', event => event.preventDefault());
    current.webContents.on('will-attach-webview', event => event.preventDefault());
    void current.loadFile(file).catch(() => { if (!current.isDestroyed()) current.destroy(); });
  }
  return {
    get: () => enabled,
    set(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'enabled' || typeof (value as { enabled?: unknown }).enabled !== 'boolean') throw Error('COOLER_INPUT_INVALID');
      const next = (value as { enabled: boolean }).enabled;
      atomicJson(input.preferenceFile, { enabled: next }); enabled = next;
      if (!enabled) close();
      else { const progress = input.getProgress(); if (progress && ['RUNNING', 'STOPPING'].includes(progress.state)) show(); }
      return enabled;
    },
    show,
    dispose() { disposed = true; close(); ipcMain.removeHandler('csd:cooler:progress'); },
  };
}
