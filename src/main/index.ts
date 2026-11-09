import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, session, shell } from 'electron';
import { existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDiscoveryStore, exportDigest } from '../infrastructure/storage/discovery-store.js';
import { createDiscoveryWatch } from '../application/discovery-watch.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createProjectWorkspace } from '../infrastructure/projects/workspace.js';
import { runtimePaths } from '../infrastructure/config/runtime-paths.js';
import { createBrowserProfiles } from '../infrastructure/browser/profile-repository.js';
import { sharedWindows } from '../application/window-scheduler.js';
import { createBrowserHost } from '../infrastructure/browser/browser-host.js';
import { createElectronSecretStore } from '../infrastructure/secrets/electron-secret-store.js';
import { createProductionService } from '../application/production-service.js';
import type { CollectorInput, CollectorReceipt } from '../application/production-service.js';
import { exportSocialWorkbook } from '../infrastructure/export/social-workbook.js';
import { exportOpportunityWorkbook, selectOpportunityExport, deliveredOpportunityRoots } from '../infrastructure/export/opportunity-workbook.js';
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
  const environmentFile = process.env.CSD_ENV_FILE || join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()), '.env');
  if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
  const projects = await createProjectWorkspace({ directory: join(paths.userData, 'data'),
    secretStore: createElectronSecretStore(join(paths.userData, 'secrets')),
    ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}) });
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
  const createService = () => createProductionService({ directory: projects.activeDirectory(), version: app.getVersion(), host: browserHost, spendingStatus: () => spending.status(),
    createOpportunity: value => createOpportunityPipeline({ ...value, classificationWorkers: 2, assessmentCacheDirectory: join(projects.activeDirectory(), 'assessment-cache'), gateway: value.config.filterMode === 'OFF' ? unassessedGateway : createCampaignModelGateway({ directory: join(value.directory, 'opportunity'), budgetUsd: value.config.budgetUsd, apiKey: geminiKey.current, schedulerForModel, spending }) }),
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
    async withKeywordCommentWindow(profileId, platform, shouldStop, work) {
      const lease = await sharedWindows.acquire(platform, false, shouldStop, profileId, true);
      const worker = browserHost.forWorker('keyword-comments');
      try {
        if (shouldStop()) throw Error('USER_STOP');
        if (!(await browserHost.sessionStatus(profileId))) throw Error('LOGIN_REQUIRED');
        if (shouldStop()) throw Error('USER_STOP');
        await worker.open(profileId);
        const target = worker.observerTarget(profileId); if (!target) throw Error('PROFILE_UNAVAILABLE');
        await work(target.contents);
      } finally { try { await worker.close(profileId); } finally { lease.release(); } }
    },
    async withConversationWindow(profileId, work) {
      if (!(await browserHost.sessionStatus(profileId))) throw Error('LOGIN_REQUIRED');
      try {
        await browserHost.open(profileId);
        const target = browserHost.observerTarget(profileId); if (!target) throw Error('PROFILE_UNAVAILABLE');
        await work(target.contents);
      } finally { await browserHost.close(profileId); }
    } });
  let service = createService();
  let discoveryStore = createDiscoveryStore(join(projects.activeDirectory(), 'discovery.sqlite'));
  const createWatch = () => createDiscoveryWatch({ store: discoveryStore, getState: () => service.getState(),
    readRunState: id => service.readRunState(id), start: (id, target) => service.startDiscoveryFromRecipe(id, target, []),
    expectedResultCount: (run, fallback) => {
      const frozen = service.results();
      if (frozen.run.id !== run.id || !frozen.opportunity) return fallback;
      const data = frozen.opportunity as import('../infrastructure/export/opportunity-workbook.js').OpportunityExportData;
      if (!data.selection) return fallback;
      return data.selection.target.length;
    } });
  let discoveryWatch = createWatch();
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let backupTimer: ReturnType<typeof setInterval> | null = null;
  let projectChanging = false, backupRunning = false;
  let projectWork: Promise<unknown> | null = null;
  let closing = false, shutdownComplete = false;
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault(); if (closing) return; closing = true;
    if (discoveryTimer) clearInterval(discoveryTimer);
    if (backupTimer) clearInterval(backupTimer);
    void Promise.resolve(projectWork).catch(() => {}).then(() => discoveryWatch.stop()).then(() => service.shutdown()).then(() => browserHost.shutdown()).then(async () => {
      discoveryStore.close();
      await projects.sync().catch(() => {});
      await projects.close();
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
    if (discoveryWatch.busy) throw Error('DISCOVERY_BUSY');
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
  function projectCommand(work: () => Promise<unknown>) {
    if (projectChanging || backupRunning || modelCommands || exporting || choosingRetainedRoot || keyChanging || discoveryWatch.busy) throw Error('PROJECT_BUSY');
    projectChanging = true;
    const task = (async () => {
      try {
        const state = await service.getState();
        if (state.run && (['RUNNING', 'STOPPING'].includes(state.run.state) || state.run.opportunity?.watchActive || state.run.opportunity?.assessmentActive) || state.campaignDraftPreparing) throw Error('PROJECT_RUN_ACTIVE');
        await discoveryWatch.stop();
        await service.shutdown();
        discoveryStore.close();
        try { return await work(); }
        finally {
          service = createService();
          discoveryStore = createDiscoveryStore(join(projects.activeDirectory(), 'discovery.sqlite'));
          discoveryWatch = createWatch();
        }
      } finally { projectChanging = false; }
    })();
    projectWork = task;
    return task;
  }
  const handlers: Record<string, (value?: unknown) => unknown> = {
    'csd:projects:state': () => projects.state(),
    'csd:projects:create': value => projectCommand(() => projects.create(value as never)),
    'csd:projects:update': value => projectCommand(() => projects.update(value as never)),
    'csd:projects:remove': value => projectCommand(() => projects.remove(value as never)),
    'csd:projects:select': value => projectCommand(() => projects.select(value as never)),
    'csd:projects:register': value => projectCommand(() => projects.register(value as never)),
    'csd:projects:login': value => projectCommand(() => projects.login(value as never)),
    'csd:projects:logout': () => projectCommand(() => projects.logout()),
    'csd:projects:sync': () => projectCommand(() => projects.sync({ pull: true })),
    'csd:gemini-key:status': () => geminiKey.status(),
    'csd:gemini-key:save': value => changeKey(() => geminiKey.save(value)),
    'csd:gemini-key:remove': () => changeKey(() => geminiKey.remove()),
    'csd:state': () => service.getState(),
    'csd:discovery:list': () => discoveryStore.list(),
    'csd:discovery:create': async value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('DISCOVERY_INPUT_INVALID');
      const v = value as { sourceRunId: string; label: string; intervalHours?: number; monthlyTarget?: number };
      if (Object.keys(v).some(k => !['sourceRunId', 'label', 'intervalHours', 'monthlyTarget'].includes(k))) throw Error('DISCOVERY_INPUT_INVALID');
      const run = service.readRunState(v.sourceRunId);
      if (!run?.opportunity || run.mode === 'RETAINED' || ['RUNNING', 'STOPPING'].includes(run.state)) throw Error('DISCOVERY_SOURCE_UNAVAILABLE');
      return discoveryStore.create(v);
    },
    'csd:discovery:attach': value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'id,sourceRunId') throw Error('DISCOVERY_INPUT_INVALID');
      const v = value as { id: string; sourceRunId: string }, run = service.readRunState(v.sourceRunId);
      if (!run?.opportunity || run.mode === 'RETAINED' || ['RUNNING', 'STOPPING'].includes(run.state)) throw Error('DISCOVERY_SOURCE_UNAVAILABLE');
      return discoveryStore.attachRecipe(v.id, v.sourceRunId);
    },
    'csd:discovery:enabled': value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'enabled,id') throw Error('DISCOVERY_INPUT_INVALID');
      const v = value as { id: string; enabled: boolean }; return discoveryStore.setEnabled(v.id, v.enabled);
    },
    'csd:discovery:run': value => modelCommand(async () => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'id' || typeof (value as {id: unknown}).id !== 'string') throw Error('DISCOVERY_INPUT_INVALID');
      await discoveryWatch.tick((value as {id: string}).id); return discoveryStore.list();
    }),
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
        const staged = choice.filePath + '.csd-' + randomUUID() + '.' + format;
        const exported = result.opportunity ? selectOpportunityExport(result.opportunity, group) : null;
        if (format === 'xlsx') {
          if (exported) await exportOpportunityWorkbook(staged, exported);
          else await exportSocialWorkbook(staged, result.facebook, result.threads);
        } else writeFileSync(staged, JSON.stringify(exported ?? result, null, 2), { flush: true });
        const savedExports = join(projects.activeDirectory(), 'exports');
        mkdirSync(savedExports, { recursive: true });
        copyFileSync(staged, join(savedExports, result.run.id + '-' + (group ?? 'ALL') + '-' + randomUUID() + '.' + format));
        const roots = exported ? deliveredOpportunityRoots(exported) : [];
        const receipt = roots.length ? discoveryStore.prepareExport(result.run.id, roots, choice.filePath, exportDigest(staged)) : null;
        renameSync(staged, choice.filePath);
        if (receipt) discoveryStore.completeExport(receipt);
        return { canceled: false, path: choice.filePath };
      } finally { exporting = false; }
    },
  };
  const noPayload = new Set(['csd:discovery:list', 'csd:gemini-key:status', 'csd:gemini-key:remove', 'csd:state', 'csd:stop', 'csd:resume', 'csd:open-output', 'csd:campaign:prepare', 'csd:retained:list', 'csd:retained:choose-root']);
  for (const channel of ['csd:projects:state', 'csd:projects:logout', 'csd:projects:sync']) noPayload.add(channel);
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (closing || !allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
      isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args: [] }) ||
      args.length !== (noPayload.has(channel) ? 0 : 1)) throw Error('IPC_DENIED');
    if (projectChanging && channel !== 'csd:projects:state') throw Error('PROJECT_BUSY');
    return handler(args[0]);
  });
  app.once('will-quit', () => { for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel); });
  discoveryTimer = setInterval(() => { if (!closing && !projectChanging && !exporting && !keyChanging && !modelCommands && !discoveryWatch.busy) void modelCommand(() => discoveryWatch.tick()).catch(() => {}); }, 60000);
  discoveryTimer.unref();
  backupTimer = setInterval(() => {
    if (closing || projectChanging || backupRunning) return;
    backupRunning = true;
    void projects.sync().catch(() => {}).finally(() => { backupRunning = false; });
  }, 30000);
  backupTimer.unref();
  await mainWindow.loadFile(uiFile);
}
void bootstrap().catch(() => {
  console.error('CSD_STARTUP_FAILED');
  dialog.showErrorBox('CSD không thể khởi động', 'Không thể mở dữ liệu ứng dụng hoặc cửa sổ CSD. Dữ liệu và phiên đăng nhập hiện có được giữ nguyên.');
  app.exit(1);
});
