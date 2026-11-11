import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, session, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDiscoveryStore, exportDigest } from '../infrastructure/storage/discovery-store.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
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
import { createUserConfigStore, parseUserConfig } from '../infrastructure/config/user-config.js';
import { throughput, GEMINI_35_PROJECT_LIMITS } from '../shared/throughput.js';
import { createRequestScheduler, type RequestScheduler } from '../infrastructure/llm/request-scheduler.js';
import { unassessedGateway } from '../application/filter-policy.js';
import { createDurableSpend, REBUILD_MODEL } from '../infrastructure/llm/durable-spend.js';
import { DEFAULT_USER_SPEND_LIMITS } from '../shared/collection-limits.js';
import { createManagedClient, ManagedHttpError, type ManagedRelease } from '../infrastructure/managed/client.js';
import { createHttpBackupStore } from '../infrastructure/managed/backup.js';
import { createRunAccess } from '../infrastructure/managed/run-access.js';
import { createRemoteModelGateway } from '../infrastructure/managed/model-gateway.js';
import type { ManagedStatus } from '../shared/managed.js';
import { managedUpdates } from './managed-updates.js';

async function bootstrap() {
  const releaseFile = fileURLToPath(new URL('../managed-release.json', import.meta.url));
  const commercialRelease = existsSync(releaseFile) ? JSON.parse(readFileSync(releaseFile, 'utf8')) as ManagedRelease : null;
  const packageInfo = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { findlinkManaged?: boolean };
  if (packageInfo.findlinkManaged && (!commercialRelease || (!commercialRelease.testOnly && (!commercialRelease.leasePublicKey || !commercialRelease.updateUrl)))) throw Error('MANAGED_RELEASE_INVALID');
  const qa = commercialRelease?.testOnly === true;
  const appData = app.getPath('appData');
  const paths = runtimePaths(qa ? join(appData, 'FindLink Starter QA') : appData);
  for (const [name, directory] of Object.entries(paths)) {
    mkdirSync(directory, { recursive: true });
    app.setPath(name as 'userData' | 'sessionData' | 'logs' | 'crashDumps', directory);
  }
  app.setName(qa ? 'FindLink Starter QA' : 'FindLink');
  app.setAppUserModelId(qa ? 'io.csd.desktop.starter.qa' : 'io.csd.desktop');
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  let window: BrowserWindow | null = null;
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  await app.whenReady(); nativeTheme.themeSource = 'light';
  const developerOrigin = app.isPackaged ? undefined : process.env.FINDLINK_DEV_BACKEND_URL;
  const release = commercialRelease ?? (developerOrigin ? { origin: developerOrigin } : null);
  const secrets = createElectronSecretStore(join(paths.userData, 'secrets'));
  const managed = release ? await createManagedClient({ release, secrets, development: !commercialRelease || commercialRelease.testOnly === true }) : null;
  if (!managed) {
    const environmentFile = process.env.CSD_ENV_FILE || join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()), '.env');
    if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
  }
  const projects = await createProjectWorkspace({ directory: join(paths.userData, 'data'),
    secretStore: secrets,
    ...(managed ? { backupStore: createHttpBackupStore(managed), localGuestOnly: true }
      : process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}) });
  const environmentKey = managed ? null : resolveGeminiApiKey();
  const geminiKey = managed ? null : await createGeminiKeySettings(secrets, () => environmentKey, { preferEnvironment: true });
  const appConfig = createUserConfigStore(join(paths.userData, 'data'));
  const machineSpendLimits = () => appConfig.read().spendLimits ?? DEFAULT_USER_SPEND_LIMITS;
  const spending = createDurableSpend({ ...(qa ? { file: join(paths.userData, 'spending', 'ledger.sqlite') } : {}),
    envelope: () => ({ scope: 'USER', model: REBUILD_MODEL,
    ...machineSpendLimits() }) });
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
  let activeAccess: ReturnType<typeof createRunAccess> | undefined;
  const createService = (): ReturnType<typeof createProductionService> => {
    const projectId = projects.state().activeProjectId;
    const access = managed ? createRunAccess(managed, projectId, () => {
      if (activeAccess === access) void service.stop().catch(() => {});
    }) : undefined;
    activeAccess = access;
    const gateway = (options: { directory: string; budgetUsd: number }, planning: boolean) => managed && access
      ? createRemoteModelGateway({ ...options, runId: basename(dirname(options.directory)), client: managed, access, spending, planning })
      : createCampaignModelGateway({ ...options, ...(planning ? { primaryModel: REBUILD_MODEL, selectionReason: 'REBUILD_SELECTED_MODEL' } : {}),
        apiKey: geminiKey!.current, schedulerForModel, spending });
    return createProductionService({ directory: projects.activeDirectory(), version: app.getVersion(), host: browserHost, compactCompletedRuns: true,
    spendingStatus: () => spending.status(), spendingLimits: machineSpendLimits,
    ...(access ? { access, watchAfterDiscovery: false } : {}),
    createOpportunity: value => createOpportunityPipeline({ ...value, compactProjectIndex: true, classificationWorkers: 2, assessmentCacheDirectory: join(projects.activeDirectory(), 'assessment-cache'), gateway: value.config.filterMode === 'OFF' ? unassessedGateway : gateway({ directory: join(value.directory, 'opportunity'), budgetUsd: value.config.budgetUsd }, false) }),
    // Retry a failed 2.5 draft with the currently selected model while retaining
    // its original directory and spending history. Historical crawl recipes stay pinned.
    async prepareCampaignDraft(value) {
      try { return await prepareSemanticDraft({ ...value, gatewayFactory: options => gateway(options,true) }); }
      finally { await access?.end(); }
    },
    async continueCampaignDraft(value) {
      try { return await continueSemanticDraft({ ...value, gatewayFactory: options => gateway(options,true) }); }
      finally { await access?.end(); }
    },
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
  };
  let service = createService();
  let discoveryStore = createDiscoveryStore(join(projects.activeDirectory(), 'discovery.sqlite'));
  let backupTimer: ReturnType<typeof setInterval> | null = null;
  let projectChanging = false;
  let backgroundBackup: { controller: AbortController; done: Promise<unknown> } | null = null;
  let projectWork: Promise<unknown> | null = null;
  let closing = false, shutdownComplete = false;
  let updates: ReturnType<typeof managedUpdates> | null = null;
  async function stopBackgroundBackup() {
    const backup = backgroundBackup;
    if (!backup) return;
    backup.controller.abort(Error('PROJECT_BACKUP_CANCELLED'));
    await backup.done;
  }
  async function finishForExit() {
    if (backupTimer) clearInterval(backupTimer);
    updates?.close();
    await stopBackgroundBackup();
    await Promise.resolve(projectWork).catch(() => {});
    await service.shutdown();
    await browserHost.shutdown();
    discoveryStore.close();
    await projects.sync({ signal: AbortSignal.timeout(3000) }).catch(() => {});
    await projects.close();
    shutdownComplete = true;
  }
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault(); if (closing) return; closing = true;
    void finishForExit().then(() => app.quit()).catch(() => { console.error('CSD_SESSION_SAVE_FAILED'); app.exit(1); });
  });
  app.on('window-all-closed', () => app.quit());
  const suspendWork = () => { activeAccess?.interrupt(); void service.stop().catch(() => {}); };
  powerMonitor.on('suspend', suspendWork);
  powerMonitor.on('resume', suspendWork);
  const uiSession = session.fromPartition('csd-ui');
  for (const current of [session.defaultSession, uiSession]) {
    current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    current.setPermissionCheckHandler(() => false);
    current.on('will-download', event => event.preventDefault());
    current.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'about:', 'data:'].includes(new URL(details.url).protocol) }));
  }
  const uiFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url)), uiUrl = pathToFileURL(uiFile).href;
  window = new BrowserWindow({ title: 'FindLink', width: 1240, height: 940, minWidth: 780, minHeight: 650,
    icon: fileURLToPath(new URL('../renderer/findlink-mark.png', import.meta.url)),
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
  const guestStatus = (reason = 'AUTH_REQUIRED', state: ManagedStatus['state'] = 'GUEST'): ManagedStatus => ({ state, reason,
    available: '0', held: '0', spent: '0', until: null, rawRemaining: null, verified: false });
  const managedClient = () => { if (!managed) throw Error('MANAGED_SERVICE_UNAVAILABLE'); return managed; };
  const managedStatus = async (): Promise<ManagedStatus | null> => {
    if (!managed) return null;
    const updateReady = updates?.ready() ?? false;
    if (!managed.identity()) return { ...guestStatus(), updateReady };
    try { return { ...await managed.json<ManagedStatus>('/v1/me/entitlements'), updateReady }; }
    catch (error) {
      if (error instanceof ManagedHttpError && error.status === 401) return { ...guestStatus(), updateReady };
      return { ...guestStatus('ENTITLEMENT_UNAVAILABLE', 'UNAVAILABLE'), updateReady };
    }
  };
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
  function projectCommand(work: () => Promise<unknown>) {
    if (projectChanging || modelCommands || exporting || choosingRetainedRoot || keyChanging) throw Error('PROJECT_BUSY');
    projectChanging = true;
    const task = (async () => {
      try {
        const state = await service.getState();
        if (state.run && (['RUNNING', 'STOPPING'].includes(state.run.state) || state.run.opportunity?.watchActive || state.run.opportunity?.assessmentActive) || state.campaignDraftPreparing) throw Error('PROJECT_RUN_ACTIVE');
        await stopBackgroundBackup();
        await service.shutdown();
        discoveryStore.close();
        try { return await work(); }
        finally {
          service = createService();
          discoveryStore = createDiscoveryStore(join(projects.activeDirectory(), 'discovery.sqlite'));
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
    'csd:gemini-key:status': () => geminiKey?.status() ?? { source: 'NONE', readError: false },
    'csd:gemini-key:save': value => { if (!geminiKey) throw Error('MODEL_NOT_AUTHORIZED'); return changeKey(() => geminiKey.save(value)); },
    'csd:gemini-key:remove': () => { if (!geminiKey) throw Error('MODEL_NOT_AUTHORIZED'); return changeKey(() => geminiKey.remove()); },
    'csd:managed:status': managedStatus,
    'csd:managed:wallet': () => managedClient().json('/v1/wallet'),
    'csd:managed:trial': () => managedClient().json('/v1/trial/activate', { method: 'POST', json: {} }),
    'csd:managed:order': () => managedClient().json('/v1/billing/orders', { method: 'POST', json: { requestId: randomUUID() } }),
    'csd:managed:topup': () => managedClient().json('/v1/billing/orders', { method: 'POST', json: { requestId: randomUUID(), kind: 'TOPUP' } }),
    'csd:managed:order-status': value => {
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('ORDER_NOT_FOUND');
      return managedClient().json('/v1/billing/orders/' + id);
    },
    'csd:managed:recover': value => projectCommand(async () => {
      const v = value as { code?: unknown; password?: unknown } | null;
      if (!v || typeof v.code !== 'string' || typeof v.password !== 'string' || v.code.length !== 64 || v.password.length > 256) throw Error('INVITE_INVALID');
      await managedClient().json('/v1/auth/recover', { method: 'POST', json: { code: v.code, password: v.password } }, false);
    }),
    'csd:managed:update': async () => {
      if (!updates?.ready()) throw Error('UPDATE_UNAVAILABLE');
      if (closing || modelCommands || projectChanging || exporting) throw Error('PROJECT_BUSY');
      await requireIdleForKey();
      if (closing || modelCommands || projectChanging || exporting) throw Error('PROJECT_BUSY');
      closing = true;
      try { await finishForExit(); updates.install(); }
      catch { app.quit(); throw Error('UPDATE_INSTALL_FAILED'); }
    },
    'csd:state': async () => {
      const state = await service.getState();
      return { ...state, ...(managed ? { managed: true } : {}), config: { ...state.config, spendLimits: machineSpendLimits() } };
    },
    'csd:config': value => {
      const { spendLimits, ...projectConfig } = parseUserConfig(value);
      const config = service.saveConfig(projectConfig);
      const previous = machineSpendLimits();
      if (spendLimits && (spendLimits.totalUsd !== previous.totalUsd || spendLimits.dailyUsd !== previous.dailyUsd)) {
        appConfig.save({ ...appConfig.read(), spendLimits });
      }
      return { ...config, spendLimits: machineSpendLimits() };
    },
    'csd:login': value => service.login(value),
    'csd:campaign:prepare': () => modelCommand(async () => { await activeAccess?.preflight(); return service.prepareCampaign(); }),
    'csd:campaign:continue': value => modelCommand(async () => { await activeAccess?.preflight(); return service.continueCampaign(value); }),
    'csd:campaign:update': value => service.updateCampaign(value),
    'csd:preset:save': value => service.saveCampaignPreset(value),
    'csd:preset:apply': value => service.applyCampaignPreset(value),
    'csd:retained:list': () => service.listRetainedSources(),
    'csd:retained:choose-root': async () => {
      if (choosingRetainedRoot) throw Error('RETAINED_PICKER_BUSY');
      choosingRetainedRoot = true;
      try {
        const choice = await dialog.showOpenDialog(mainWindow, { title: 'Chọn thư mục dữ liệu FindLink đã lưu',
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
        let suggestedDirectory = paths.userData;
        try { const downloads = app.getPath('downloads'); if (existsSync(downloads)) suggestedDirectory = downloads; } catch { /* A new Windows profile may not have a Downloads folder yet. */ }
        const choice = await dialog.showSaveDialog(mainWindow, { title: format === 'xlsx' ? 'Xuất kết quả Excel' : 'Xuất kết quả JSON',
          defaultPath: join(suggestedDirectory, 'FindLink-' + result.run.id + (result.opportunity ? '-' + (group ?? 'ALL') : '') + '.' + format),
          filters: [{ name: format === 'xlsx' ? 'Excel Workbook' : 'JSON', extensions: [format] }] });
        if (choice.canceled || !choice.filePath) return { canceled: true, path: null };
        const staged = choice.filePath + '.csd-' + randomUUID() + '.' + format;
        const exported = result.opportunity ? selectOpportunityExport(result.opportunity, group) : null;
        if (format === 'xlsx') {
          if (exported) await exportOpportunityWorkbook(staged, exported);
          else await exportSocialWorkbook(staged, result.facebook, result.threads);
        } else writeFileSync(staged, JSON.stringify(exported ?? result, null, 2), { flush: true });
        const roots = exported ? deliveredOpportunityRoots(exported) : [];
        const receipt = roots.length ? discoveryStore.prepareExport(result.run.id, roots, choice.filePath, exportDigest(staged)) : null;
        renameSync(staged, choice.filePath);
        if (receipt) discoveryStore.completeExport(receipt);
        return { canceled: false, path: choice.filePath };
      } finally { exporting = false; }
    },
  };
  const noPayload = new Set(['csd:gemini-key:status', 'csd:gemini-key:remove', 'csd:state', 'csd:stop', 'csd:resume', 'csd:open-output', 'csd:campaign:prepare', 'csd:retained:list', 'csd:retained:choose-root']);
  for (const channel of ['csd:projects:state', 'csd:projects:logout', 'csd:projects:sync']) noPayload.add(channel);
  for (const channel of ['csd:managed:status', 'csd:managed:wallet', 'csd:managed:trial', 'csd:managed:order','csd:managed:topup','csd:managed:update']) noPayload.add(channel);
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (closing || !allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
      isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args: [] }) ||
      args.length !== (noPayload.has(channel) ? 0 : 1)) throw Error('IPC_DENIED');
    if (projectChanging && channel !== 'csd:projects:state') throw Error('PROJECT_BUSY');
    return handler(args[0]);
  });
  app.once('will-quit', () => { for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel); });
  backupTimer = setInterval(() => {
    if (closing || projectChanging || backgroundBackup) return;
    const controller = new AbortController();
    const done = projects.sync({ signal: controller.signal }).catch(() => {}).finally(() => { backgroundBackup = null; });
    backgroundBackup = { controller, done };
  }, 30000);
  backupTimer.unref();
  await mainWindow.loadFile(uiFile);
  if (app.isPackaged && commercialRelease?.updateUrl && !commercialRelease.testOnly) updates = managedUpdates(commercialRelease.updateUrl);
}
void bootstrap().catch(() => {
  console.error('CSD_STARTUP_FAILED');
  dialog.showErrorBox('FindLink không thể khởi động', 'Không thể mở dữ liệu ứng dụng hoặc cửa sổ FindLink. Dữ liệu và phiên đăng nhập hiện có được giữ nguyên.');
  app.exit(1);
});
