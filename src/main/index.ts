import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, session, shell } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { runtimePaths } from '../infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../infrastructure/browser/profile-repository.js';
import { createBrowserHost } from '../infrastructure/browser/browser-host.js';
import { createElectronSecretStore } from '../infrastructure/secrets/electron-secret-store.js';
import { createProductionService } from '../application/production-service.js';
import type { CollectorInput, CollectorReceipt } from '../application/production-service.js';
import { exportSocialWorkbook } from '../infrastructure/export/social-workbook.js';
import { allowDesktopRequest } from './ipc-policy.js';

async function bootstrap() {
  const paths = runtimePaths(app.getPath('appData'));
  for (const [name, directory] of Object.entries(paths)) {
    mkdirSync(directory, { recursive: true });
    app.setPath(name as 'userData' | 'sessionData' | 'logs' | 'crashDumps', directory);
  }
  app.setName('CSD'); app.setAppUserModelId('io.csd.desktop');
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  let window: BrowserWindow | null = null;
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  await app.whenReady(); nativeTheme.themeSource = 'dark';
  const profiles = createBrowserProfiles(join(paths.userData, 'data'));
  const browserHost = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')),
    journalDirectory: join(paths.userData, 'data', 'session-snapshots'), manualLoginEnabled: true, backgroundThrottling: false });
  const service = createProductionService({ directory: join(paths.userData, 'data'), version: app.getVersion(), host: browserHost,
    async collect(value: CollectorInput): Promise<CollectorReceipt> {
      const moduleUrl = new URL('../collectors/' + value.platform + '-collector.mjs', import.meta.url).href;
      const runner = await import(moduleUrl) as Record<string, (options: object) => Promise<CollectorReceipt>>;
      const collect = runner[value.platform === 'facebook' ? 'runFacebookCollector' : 'runThreadsCollector'];
      if (!collect) throw Error('COLLECTOR_UNAVAILABLE');
      return collect({ config: value.config, host: browserHost, profileId: value.profileId,
        onProgress: value.onProgress, shouldStop: value.shouldStop });
    } });
  let closing = false, shutdownComplete = false;
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault(); if (closing) return; closing = true;
    void service.shutdown().then(() => browserHost.shutdown()).then(() => {
      shutdownComplete = true; app.quit();
    }).catch(() => { console.error('CSD_SESSION_SAVE_FAILED'); app.exit(1); });
  });
  app.on('window-all-closed', () => app.quit());
  powerMonitor.on('suspend', () => { void service.stop().catch(() => {}); });
  const uiSession = session.fromPartition('csd-ui');
  for (const current of [session.defaultSession, uiSession]) {
    current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    current.setPermissionCheckHandler(() => false);
    current.on('will-download', event => event.preventDefault());
    current.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'about:', 'data:'].includes(new URL(details.url).protocol) }));
  }
  const uiFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url)), uiUrl = pathToFileURL(uiFile).href;
  window = new BrowserWindow({ title: 'CSD — Crawl Socials Data', width: 1240, height: 940, minWidth: 780, minHeight: 650,
    show: false, backgroundColor: '#080b0b', autoHideMenuBar: true,
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), session: uiSession,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
  const mainWindow = window;
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { window = null; app.quit(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  let exporting = false;
  const handlers: Record<string, (value?: unknown) => unknown> = {
    'csd:state': () => service.getState(),
    'csd:config': value => service.saveConfig(value),
    'csd:login': value => service.login(value),
    'csd:start': value => service.start(value),
    'csd:stop': () => service.stop(),
    'csd:open-output': async () => {
      const error = await shell.openPath(service.outputDirectory()); if (error) throw Error('OUTPUT_OPEN_FAILED');
    },
    'csd:export': async value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'format' ||
          !['json', 'xlsx'].includes(String((value as { format: unknown }).format))) throw Error('EXPORT_INPUT_INVALID');
      if (exporting) throw Error('EXPORT_BUSY');
      exporting = true;
      try {
        const format = (value as { format: 'json' | 'xlsx' }).format, result = service.results();
        const choice = await dialog.showSaveDialog(mainWindow, { title: format === 'xlsx' ? 'Xuất kết quả Excel' : 'Xuất kết quả JSON',
          defaultPath: join(app.getPath('downloads'), 'CSD-' + result.run.id + '.' + format),
          filters: [{ name: format === 'xlsx' ? 'Excel Workbook' : 'JSON', extensions: [format] }] });
        if (choice.canceled || !choice.filePath) return { canceled: true, path: null };
        if (format === 'xlsx') await exportSocialWorkbook(choice.filePath, result.facebook, result.threads);
        else writeFileSync(choice.filePath, JSON.stringify(result, null, 2), { flush: true });
        return { canceled: false, path: choice.filePath };
      } finally { exporting = false; }
    },
  };
  const noPayload = new Set(['csd:state', 'csd:stop', 'csd:open-output']);
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (closing || !allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
      isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args: [] }) ||
      args.length !== (noPayload.has(channel) ? 0 : 1)) throw Error('IPC_DENIED');
    return handler(args[0]);
  });
  app.once('will-quit', () => { for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel); });
  await mainWindow.loadFile(uiFile);
}
void bootstrap().catch(() => {
  console.error('CSD_STARTUP_FAILED');
  dialog.showErrorBox('CSD không thể khởi động', 'Không thể mở dữ liệu ứng dụng hoặc cửa sổ CSD. Dữ liệu và phiên đăng nhập hiện có được giữ nguyên.');
  app.exit(1);
});
