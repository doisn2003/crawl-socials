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
import { exportOpportunityWorkbook, selectOpportunityExport } from '../infrastructure/export/opportunity-workbook.js';
import type { ConversationClassification } from '../domain/conversation-decision.js';
import { allowDesktopRequest } from './ipc-policy.js';
import { createGeminiKeySettings } from '../application/gemini-key-settings.js';
import { resolveGeminiApiKey } from '../infrastructure/llm/gemini-gateway.js';
import { createCampaignModelGateway } from '../infrastructure/llm/campaign-model-gateway.js';
import { createOpportunityPipeline } from '../application/opportunity-pipeline.js';
import { prepareSemanticDraft, continueSemanticDraft } from '../application/campaign-drafts.js';
import { runParallelCollectors } from '../application/parallel-collector.js';
import { createUserConfigStore } from '../infrastructure/config/user-config.js';
import { throughput, GEMINI_35_PROJECT_LIMITS } from '../shared/throughput.js';
import { createRequestScheduler, type RequestScheduler } from '../infrastructure/llm/request-scheduler.js';
import { unassessedGateway } from '../application/filter-policy.js';
import { createDurableSpend, REBUILD_MODEL } from '../infrastructure/llm/durable-spend.js';

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
  await app.whenReady(); nativeTheme.themeSource = 'light';
  const environmentKey = resolveGeminiApiKey();
  const geminiKey = await createGeminiKeySettings(createElectronSecretStore(join(paths.userData, 'secrets')), () => environmentKey, { preferEnvironment: true });
  const appConfig = createUserConfigStore(join(paths.userData, 'data'));
  const spending = createDurableSpend({ envelope: () => ({ scope: 'USER', model: REBUILD_MODEL,
    ...(appConfig.read().spendLimits ?? { totalUsd: 3, dailyUsd: 3 }) }) });
  const schedulers = new Map<string, RequestScheduler>();
  const schedulerForModel = (model: string) => {
    const policy = throughput(appConfig.read().performance);
    // Local conservative pacing for the selected Lite model, not a claim about provider quota.
    const limits = model === REBUILD_MODEL ? { concurrency: 2, rpm: 60, inputTpm: 200_000, rpd: 10_000 }
      : model === 'gemini-3.5-flash-lite'
      ? { ...GEMINI_35_PROJECT_LIMITS, concurrency: policy.modelConcurrency }
      : { concurrency: 1, rpm: 13, inputTpm: 200_000, rpd: 500 };
    let scheduler = schedulers.get(model);
    if (!scheduler) { scheduler = createRequestScheduler(limits, { stateFile: join(paths.userData, 'data', 'rate-limits', model + '.json') }); schedulers.set(model, scheduler); }
    else scheduler.configure(limits);
    return scheduler;
  };
  const profiles = createBrowserProfiles(join(paths.userData, 'data'));
  const browserHost = createBrowserHost({ profiles, secrets: createElectronSecretStore(join(paths.userData, 'secrets')),
    journalDirectory: join(paths.userData, 'data', 'session-snapshots'), manualLoginEnabled: true, backgroundThrottling: false });
  const service = createProductionService({ directory: join(paths.userData, 'data'), version: app.getVersion(), host: browserHost, spendingStatus: () => spending.status(),
    createOpportunity: value => createOpportunityPipeline({ ...value, classificationWorkers: 2, assessmentCacheDirectory: join(paths.userData, 'data', 'assessment-cache'), gateway: value.config.filterMode === 'OFF' ? unassessedGateway : createCampaignModelGateway({ directory: join(value.directory, 'opportunity'), budgetUsd: value.config.budgetUsd, apiKey: geminiKey.current, schedulerForModel, spending }) }),
    // Retry a failed 2.5 draft with the currently selected model while retaining
    // its original directory and spending history. Historical crawl recipes stay pinned.
    prepareCampaignDraft: value => prepareSemanticDraft({ ...value, gatewayFactory: options => createCampaignModelGateway({ ...options, primaryModel: REBUILD_MODEL,
      selectionReason: 'REBUILD_SELECTED_MODEL', apiKey: geminiKey.current, schedulerForModel, spending }) }),
    continueCampaignDraft: value => continueSemanticDraft({ ...value, gatewayFactory: options => createCampaignModelGateway({ ...options, primaryModel: REBUILD_MODEL,
      selectionReason: 'REBUILD_SELECTED_MODEL', apiKey: geminiKey.current, schedulerForModel, spending }) }),
    async collect(value: CollectorInput): Promise<CollectorReceipt> {
      const moduleUrl = new URL('../collectors/' + value.platform + '-collector.mjs', import.meta.url).href;
      const runner = await import(moduleUrl) as Record<string, (options: object) => Promise<CollectorReceipt>>;
      const collect = runner[value.platform === 'facebook' ? 'runFacebookCollector' : 'runThreadsCollector'];
      if (!collect) throw Error('COLLECTOR_UNAVAILABLE');
      return runParallelCollectors(value, (worker, workerId) => collect({ ...worker,
        host: workerId ? browserHost.forWorker(workerId) : browserHost }));
    },
    async collectConversation(value) {
      const moduleUrl = new URL('../collectors/conversation-collector.mjs', import.meta.url).href;
      const runner = await import(moduleUrl) as { collectConversation(input: object): Promise<unknown> };
      return runner.collectConversation(value);
    },
    async resolveThreadsReplyRoot(value) {
      const moduleUrl = new URL('../collectors/conversation-collector.mjs', import.meta.url).href;
      const runner = await import(moduleUrl) as { resolveThreadsReplyRoot(input: object): Promise<import('../application/opportunity-pipeline.js').ReplyRootResolveReceipt> };
      return runner.resolveThreadsReplyRoot(value);
    },
    async withConversationWindow(profileId, work) {
      if (!(await browserHost.sessionStatus(profileId))) throw Error('LOGIN_REQUIRED');
      try {
        await browserHost.open(profileId);
        const target = browserHost.observerTarget(profileId); if (!target) throw Error('PROFILE_UNAVAILABLE');
        await work(target.contents);
      } finally { await browserHost.close(profileId); }
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
    show: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
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
  let exporting = false, choosingRetainedRoot = false;
  let keyChanging = false, modelCommands = 0;
  async function modelCommand<T>(work: () => Promise<T>): Promise<T> {
    if (keyChanging) throw Error('GEMINI_KEY_BUSY');
    modelCommands++; try { return await work(); } finally { modelCommands--; }
  }
  const requireIdleForKey = async () => {
    const state = await service.getState();
    if (state.run?.state === 'RUNNING' || state.run?.state === 'STOPPING' || state.run?.opportunity?.watchActive || state.run?.opportunity?.assessmentActive || state.campaignDraftPreparing) throw Error('GEMINI_KEY_RUN_ACTIVE');
  };
  async function changeKey(work: () => Promise<unknown>) {
    if (keyChanging || modelCommands) throw Error('GEMINI_KEY_BUSY');
    keyChanging = true;
    try { await requireIdleForKey(); return await work(); } finally { keyChanging = false; }
  }
  const handlers: Record<string, (value?: unknown) => unknown> = {
    'csd:gemini-key:status': () => geminiKey.status(),
    'csd:gemini-key:save': value => changeKey(() => geminiKey.save(value)),
    'csd:gemini-key:remove': () => changeKey(() => geminiKey.remove()),
    'csd:state': () => service.getState(),
    'csd:config': value => service.saveConfig(value),
    'csd:login': value => service.login(value),
    'csd:campaign:prepare': () => modelCommand(() => service.prepareCampaign()),
    'csd:campaign:continue': value => modelCommand(() => service.continueCampaign(value)),
    'csd:campaign:update': value => service.updateCampaign(value),
    'csd:preset:save': value => service.saveCampaignPreset(value),
    'csd:preset:apply': value => service.applyCampaignPreset(value),
    'csd:retained:list': () => service.listRetainedSources(),
    'csd:retained:choose-root': async () => {
      if (choosingRetainedRoot) throw Error('RETAINED_PICKER_BUSY');
      choosingRetainedRoot = true;
      try {
        const choice = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục dữ liệu CSD đã lưu',
          properties: ['openDirectory'], buttonLabel: 'Dùng nguồn dữ liệu này' });
        if (choice.canceled || choice.filePaths.length !== 1) return null;
        return service.registerRetainedSourceRoot(choice.filePaths[0]!);
      } finally { choosingRetainedRoot = false; }
    },
    'csd:retained:start': value => modelCommand(() => service.startRetained(value)),
    'csd:start': value => modelCommand(() => service.start(value)),
    'csd:stop': () => service.stop(),
    'csd:resume': () => modelCommand(() => service.resume()),
    'csd:open-post': async value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'url' || typeof (value as { url: unknown }).url !== 'string') throw Error('POST_URL_INVALID');
      const url = new URL((value as { url: string }).url);
      if (url.protocol !== 'https:' || url.username || url.password || !['facebook.com', 'www.facebook.com', 'm.facebook.com', 'threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname) || /\/(?:l\.php|login|logout)(?:\/|$)/.test(url.pathname)) throw Error('POST_URL_INVALID');
      await shell.openExternal(url.href);
    },
    'csd:open-output': async () => {
      const error = await shell.openPath(service.outputDirectory()); if (error) throw Error('OUTPUT_OPEN_FAILED');
    },
    'csd:export': async value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !['format', 'format,group'].includes(Object.keys(value).sort().join()) ||
          !['json', 'xlsx'].includes(String((value as { format: unknown }).format))) throw Error('EXPORT_INPUT_INVALID');
      const group = (value as { group?: ConversationClassification }).group;
      if (group !== undefined && !['SUITABLE', 'NOT_SUITABLE', 'NOT_YET', 'UNRELATED'].includes(group)) throw Error('EXPORT_INPUT_INVALID');
      if (exporting) throw Error('EXPORT_BUSY');
      exporting = true;
      try {
        const format = (value as { format: 'json' | 'xlsx' }).format, result = await service.snapshotResults();
        const choice = await dialog.showSaveDialog(mainWindow, { title: format === 'xlsx' ? 'Xuất kết quả Excel' : 'Xuất kết quả JSON',
          defaultPath: join(app.getPath('downloads'), 'CSD-' + result.run.id + (result.opportunity ? '-' + (group ?? 'ALL') : '') + '.' + format),
          filters: [{ name: format === 'xlsx' ? 'Excel Workbook' : 'JSON', extensions: [format] }] });
        if (choice.canceled || !choice.filePath) return { canceled: true, path: null };
        if (format === 'xlsx') {
          if (result.opportunity) await exportOpportunityWorkbook(choice.filePath, result.opportunity, group);
          else await exportSocialWorkbook(choice.filePath, result.facebook, result.threads);
        } else writeFileSync(choice.filePath, JSON.stringify(result.opportunity ? selectOpportunityExport(result.opportunity, group) : result, null, 2), { flush: true });
        return { canceled: false, path: choice.filePath };
      } finally { exporting = false; }
    },
  };
  const noPayload = new Set(['csd:gemini-key:status', 'csd:gemini-key:remove', 'csd:state', 'csd:stop', 'csd:resume', 'csd:open-output', 'csd:campaign:prepare', 'csd:retained:list', 'csd:retained:choose-root']);
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
