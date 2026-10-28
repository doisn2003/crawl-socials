import { app, BrowserWindow, ipcMain, session, webContents, powerMonitor } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCampaignValidator } from '../infrastructure/config/campaign-validator.js';
import { runtimePaths } from '../infrastructure/config/runtime-paths.js';
import { createBootstrapService } from '../application/bootstrap-service.js';
import { allowDesktopRequest } from './ipc-policy.js';
import { parseBrowserCommand } from './browser-ipc-policy.js';
import { createBrowserProfiles } from '../infrastructure/browser/profile-repository.js';
import { createBrowserHost } from '../infrastructure/browser/browser-host.js';
import { createElectronSecretStore } from '../infrastructure/secrets/electron-secret-store.js';
import { createProbeController } from './probe-controller.js';
import { createProbeWriter } from './probe-writer.js';
import { createProbeFreeze } from './probe-freeze.js';
import { createFixtureProbeDriver } from './electron-probe-driver.js';
import { parseProbeCommand } from './probe-ipc-policy.js';
import { createPolicyDiagnosticFile } from '../infrastructure/browser/policy-diagnostics-file.js';
import { installFacebookDomDiagnosticMenu } from './facebook-dom-diagnostic-menu.js';
import { facebookDomCaptureMode } from './facebook-dom-diagnostic.js';

const PRODUCT_ID = 'io.csd.desktop';
const UI_PARTITION = 'csd-ui';
const channels = ['csd:get-info', 'csd:offline-check'] as const;
let startupPhase = 'PATHS';

async function bootstrap() {
  const sessionSmoke = process.argv.includes('--csd-session-smoke');
  const observerSmoke = process.argv.includes('--csd-observer-smoke');
  const probeSmoke = process.argv.includes('--csd-probe-smoke');
  const policySmoke = process.argv.includes('--csd-policy-smoke');
  const authDependencySmoke = process.argv.includes('--csd-auth-dependency-smoke');
  const facebookDomFixture = process.argv.includes('--csd-facebook-dom-fixture');
  const facebookPublicFixture = process.argv.includes('--csd-facebook-public-candidate-fixture');
  const facebookBoundaryFixture = process.argv.includes('--csd-candidate-boundary-fixture');
  const facebookLayoutFixture = process.argv.includes('--csd-dom-layout-fixture');
  const facebookOverlayFixture = process.argv.includes('--csd-overlay-visibility-fixture');
  const facebookTemporalFixture = process.argv.includes('--csd-header-temporal-fixture');
  const facebookTextVisibilityFixture = process.argv.includes('--csd-text-visibility-fixture');
  const facebookLocalClipFixture = process.argv.includes('--csd-local-clip-fixture');
  const facebookOptionalTimeFixture = process.argv.includes('--csd-optional-time-fixture');
  const facebookHeaderTreeFixture = process.argv.includes('--csd-header-tree-fixture');
  const facebookAuxiliaryFixture = process.argv.includes('--csd-auxiliary-fixture');
  const facebookSearchPostOpenFixture=process.argv.includes('--csd-search-post-open-fixture'),searchPostOpenCase=process.argv.find(arg=>arg.startsWith('--csd-search-post-case='))?.slice('--csd-search-post-case='.length);
  if((searchPostOpenCase&&!facebookSearchPostOpenFixture)||(facebookSearchPostOpenFixture&&!['placeholder','obfuscated','popup','popup-false','rel-author','generic-public','stale','header-stale','ambiguous','wrong-link','pre-barrier','post-barrier','stop','group-geometry','timestamp-geometry','shape-cap','fragment','fragment-target','fragment-post','fragment-bad','fragment-stale','fragment-popup','fragment-geometry','fragment-pre-barrier','preflight-empty','preflight-self','preflight-blank','preflight-top','preflight-parent','preflight-named','preflight-invalid','preflight-facts','preflight-isolation','preflight-viewport','preflight-time-discovery','preflight-time-click','observed-plain','observed-svg','observed-img','observed-foreign','observed-use','observed-control','observed-unknown','observed-ambiguous','observed-stale-node','observed-stale-href','observed-stale-subtree','observed-offscreen','observed-rects','observed-stop','observed-time','observed-blank','observed-barrier','observed-transparent','observed-transparent-keyword','observed-alpha-positive','observed-target160','observed-target161','observed-stale-target','observed-wrapper-tag','observed-wrapper-attribute','observed-wrapper-blank-tag','observed-wrapper-blank-attribute','observed-passive-plain','observed-passive-svg','observed-passive-media','observed-passive-blank','observed-passive-limit','observed-passive-stale','observed-passive-time','url-success','url-stale-node','url-stale-href','url-stale-subtree','url-invalid','url-placeholder','url-ambiguous','url-popup','url-body','url-hidden','url-private','url-owner','url-stop-revalidate','url-stop-nav','url-redirect','url-time','url-media','url-path','url-role-menuitem','url-role-combobox','url-role-slider','url-barrier'].includes(searchPostOpenCase||'')))throw new Error('DOM_DIAGNOSTIC_ARGUMENTS_INVALID');
  const facebookRouteVerificationFixture=process.argv.includes('--csd-post-route-verification-fixture'),routeVerificationCase=process.argv.find(arg=>arg.startsWith('--csd-post-route-case='))?.slice('--csd-post-route-case='.length);
  if((routeVerificationCase&&!facebookRouteVerificationFixture)||(facebookRouteVerificationFixture&&!['match','body','barrier','redirect','stop','same-loading','same-read','away-return','full-same','trace-overflow','iframe-loading','iframe-read','iframe-main-change','iframe-barrier'].includes(routeVerificationCase||'')))throw new Error('DOM_DIAGNOSTIC_ARGUMENTS_INVALID');
  const facebookPostPerformanceFixture=process.argv.includes('--csd-post-performance-fixture');
  const facebookCurrentPostFixture=process.argv.includes('--csd-current-post-fixture'),facebookCurrentPostBarriers=process.argv.includes('--csd-current-post-barriers-fixture');
  const facebookPublicGroupFixture = process.argv.includes('--csd-public-group-fixture');
  if (([facebookBoundaryFixture,facebookLayoutFixture,facebookOverlayFixture,facebookTemporalFixture,facebookTextVisibilityFixture,facebookLocalClipFixture,facebookOptionalTimeFixture,facebookHeaderTreeFixture,facebookAuxiliaryFixture,facebookPublicGroupFixture,facebookCurrentPostFixture,facebookCurrentPostBarriers,facebookPostPerformanceFixture,facebookRouteVerificationFixture,facebookSearchPostOpenFixture].some(Boolean) && !facebookPublicFixture) || [facebookBoundaryFixture,facebookLayoutFixture,facebookOverlayFixture,facebookTemporalFixture,facebookTextVisibilityFixture,facebookLocalClipFixture,facebookOptionalTimeFixture,facebookHeaderTreeFixture,facebookAuxiliaryFixture,facebookPublicGroupFixture,facebookCurrentPostFixture,facebookCurrentPostBarriers,facebookPostPerformanceFixture,facebookRouteVerificationFixture,facebookSearchPostOpenFixture].filter(Boolean).length>1) throw new Error('DOM_DIAGNOSTIC_ARGUMENTS_INVALID');
  const facebookDomMode = facebookDomCaptureMode(process.argv);
  const smoke = process.argv.includes('--csd-smoke') || sessionSmoke || observerSmoke || probeSmoke || policySmoke || authDependencySmoke || facebookDomFixture || facebookPublicFixture;
  const visibleDiagnosticsRoot = process.argv.find(value => value.startsWith('--csd-visible-startup-root='))?.slice('--csd-visible-startup-root='.length);
  if (visibleDiagnosticsRoot !== undefined && (smoke || !visibleDiagnosticsRoot)) throw new Error('VISIBLE_DIAGNOSTICS_ARGUMENTS_INVALID');
  const smokeRoot = process.argv.find(value => value.startsWith('--csd-smoke-root='))?.slice('--csd-smoke-root='.length);
  if (smoke !== Boolean(smokeRoot)) throw new Error('SMOKE_ARGUMENTS_INVALID');
  const paths = runtimePaths(app.getPath('appData'), smokeRoot);
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  app.setName('CSD');
  app.setAppUserModelId(PRODUCT_ID);
  for (const [name, directory] of Object.entries(paths)) app.setPath(name as 'userData' | 'sessionData' | 'logs' | 'crashDumps', directory);
  if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
  // The bootstrap has no remote content; prevent Chromium background lookups too.
  app.commandLine.appendSwitch('disable-background-networking');
  let window: BrowserWindow | null = null;
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  app.on('window-all-closed', () => { if (!smoke) app.quit(); });
  await app.whenReady();
  const fixtureOrigin = sessionSmoke || observerSmoke || probeSmoke || policySmoke ? process.argv.find(value => value.startsWith('--csd-fixture-origin='))?.slice('--csd-fixture-origin='.length) : undefined;
  if ([sessionSmoke, observerSmoke, probeSmoke, policySmoke, authDependencySmoke, facebookDomFixture, facebookPublicFixture].filter(Boolean).length > 1) throw new Error('SMOKE_ARGUMENTS_INVALID');
  if ((sessionSmoke || observerSmoke || probeSmoke || policySmoke) && !fixtureOrigin) throw new Error('FIXTURE_ORIGIN_INVALID');
  const profiles = createBrowserProfiles(join(paths.userData, 'data'));
  const secrets = createElectronSecretStore(join(paths.userData, 'secrets'));
  const manualLoginEnabled = (!smoke || authDependencySmoke || facebookDomFixture || facebookPublicFixture) && process.argv.includes('--allow-manual-facebook-login');
  const browserPolicyDiagnostics = process.argv.includes('--csd-browser-policy-diagnostics') || policySmoke || authDependencySmoke
    ? createPolicyDiagnosticFile(paths.logs) : undefined;
  const browserHost = createBrowserHost({ profiles, secrets, manualLoginEnabled, hidden: smoke,
    ...(browserPolicyDiagnostics ? { policyDiagnostics: browserPolicyDiagnostics } : {}),
    journalDirectory: join(paths.userData, 'data', 'session-snapshots'),
    ...(sessionSmoke ? { cookieSaveDelayMs: 10000 } : {}),
    ...(fixtureOrigin ? { fixtureOrigin } : {}) });
  let facebookDomTools: ReturnType<typeof installFacebookDomDiagnosticMenu> | null = null;
  const policyDiagnosticsTimer = browserPolicyDiagnostics ? setInterval(() => browserPolicyDiagnostics.publish(), 1000) : null;
  policyDiagnosticsTimer?.unref(); browserPolicyDiagnostics?.publish();
  const probe = createProbeController({ driver: probeSmoke && fixtureOrigin ? createFixtureProbeDriver(browserHost, fixtureOrigin) : null,
    freeze: probeSmoke ? createProbeFreeze(app.getAppPath(), app.isPackaged) : () => { throw new Error('PROBE_LIVE_UNAVAILABLE'); },
    writer: (runId, maxBytes) => createProbeWriter({ userData: paths.userData, workspace: app.getAppPath(), runId, maxBytes, now: Date.now }) });
  const onSuspend = () => { facebookDomTools?.stop(); probe.interrupt('SUSPENDED'); };
  powerMonitor.on('suspend', onSuspend);
  let quitting = false, shutdownComplete = false;
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    facebookDomTools?.stop();
    void probe.stop('SHUTDOWN').then(() => browserHost.shutdown()).then(() => { browserPolicyDiagnostics?.publish(); shutdownComplete = true; app.quit(); }, () => {
      console.error('BROWSER_SHUTDOWN_FAILED'); app.exit(1);
    });
  });

  startupPhase = 'CONFIGURATION';
  const loadJson = (name: string): unknown => JSON.parse(readFileSync(new URL('../resources/' + name, import.meta.url), 'utf8'));
  const validator = createCampaignValidator(loadJson('campaign.schema.json') as object);
  const service = createBootstrapService({
    validator, campaign: loadJson('campaign.coffee.json'), offlineFixture: loadJson('campaign.offline.json'), version: app.getVersion(),
  });
  let blockedExternalRequests = 0;
  startupPhase = 'SESSION';
  const uiSession = session.fromPartition(UI_PARTITION);
  for (const current of [session.defaultSession, uiSession]) {
    current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    current.setPermissionCheckHandler(() => false);
    current.on('will-download', event => event.preventDefault());
    current.webRequest.onBeforeRequest((details, callback) => {
      const local = ['file:', 'about:', 'data:'].includes(new URL(details.url).protocol);
      if (!local) blockedExternalRequests++;
      callback({ cancel: !local });
    });
  }
  const uiFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
  startupPhase = 'WINDOW';
  const uiUrl = pathToFileURL(uiFile).href;
  const webPreferences: Electron.WebPreferences = {
    preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), session: uiSession,
    nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
    ...(smoke ? { backgroundThrottling: false } : {}),
  };
  window = new BrowserWindow({
    title: 'CSD — Crawl Socials Data', width: 1120, height: 820, minWidth: 760, minHeight: 620,
    show: !smoke, backgroundColor: '#f5f5f0', autoHideMenuBar: true,
    webPreferences,
  });
  const mainWindow = window;
  if (facebookDomMode) {
    facebookDomTools = installFacebookDomDiagnosticMenu({ host: browserHost, userData: paths.userData,
      workspace: process.cwd(), mode: facebookDomMode });
    await facebookDomTools.refresh();
  }
  const initialPaint = once(mainWindow, 'ready-to-show');
  const rendererErrors: string[] = [];
  mainWindow.webContents.on('preload-error', () => rendererErrors.push('PRELOAD_FAILED'));
  mainWindow.webContents.on('render-process-gone', () => rendererErrors.push('RENDERER_GONE'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => { window = null; if (!smoke) app.quit(); });
  for (const channel of channels) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!allowDesktopRequest({
        senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
        isMainFrame: event.senderFrame === event.sender.mainFrame,
        frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args,
      })) throw new Error('IPC_DENIED');
      return channel === 'csd:get-info' ? service.getInfo() : service.runOfflineCheck();
    });
  }
  const browserChannels = ['list', 'create', 'open', 'close', 'login'] as const;
  for (const action of browserChannels) {
    ipcMain.handle('csd:profiles:' + action, async (event, ...args: unknown[]) => {
      if (!allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
        isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args: [] })) throw new Error('IPC_DENIED');
      const command = parseBrowserCommand(action, args);
      try {
        if (command.action === 'list') return { manualLoginEnabled, profiles: await browserHost.list() };
        if (command.action === 'create') { await browserHost.create(command.label); return; }
        if (probe.ownsProfile(command.profileId)) {
          if (command.action === 'close') await probe.stop('TARGET_CLOSED');
          else throw new Error('PROBE_PROFILE_BUSY');
        }
        if (command.action === 'open') return await browserHost.open(command.profileId);
        if (command.action === 'close') return await browserHost.close(command.profileId);
        return await browserHost.openLogin(command.profileId);
      } catch { throw new Error('BROWSER_OPERATION_FAILED'); }
      finally { if (facebookDomTools) void facebookDomTools.refresh().catch(() => {}); }
    });
  }
  const probeChannels = ['config', 'start', 'stop', 'status'] as const;
  let probeStartPending = false, probeEpoch = 0;
  for (const action of probeChannels) {
    ipcMain.handle('csd:probe:' + action, async (event, ...args: unknown[]) => {
      if (!allowDesktopRequest({ senderId: event.sender.id, expectedSenderId: mainWindow.webContents.id,
        isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url || '', expectedUrl: uiUrl, args: [] })) throw new Error('IPC_DENIED');
      const command = parseProbeCommand(action, args);
      try {
        if (command.action === 'config') return probe.config();
        if (command.action === 'status') return probe.status();
        if (command.action === 'stop') { probeEpoch++; return await probe.stop(); }
        if (command.action !== 'start') throw new Error('PROBE_INPUT_INVALID');
        if (probeStartPending) throw new Error('PROBE_START_PENDING');
        probeStartPending = true; const epoch = ++probeEpoch;
        try {
          const profile = (await browserHost.list()).find(profile => profile.id === command.profileId);
          if (epoch !== probeEpoch || quitting || !profile?.open || profile.persistenceError) throw new Error('PROBE_PROFILE_UNAVAILABLE');
          return probe.start(command.profileId);
        } finally { probeStartPending = false; }
      } catch { throw new Error('PROBE_OPERATION_FAILED'); }
    });
  }
  app.once('will-quit', () => {
    facebookDomTools?.dispose();
    if (policyDiagnosticsTimer) clearInterval(policyDiagnosticsTimer);
    for (const channel of channels) ipcMain.removeHandler(channel);
    for (const action of browserChannels) ipcMain.removeHandler('csd:profiles:' + action);
    for (const action of probeChannels) ipcMain.removeHandler('csd:probe:' + action);
    powerMonitor.removeListener('suspend', onSuspend);
  });
  startupPhase = 'UI_LOAD';
  await mainWindow.loadFile(uiFile);

  if (facebookPublicFixture && smokeRoot && facebookDomTools) {
    startupPhase='FACEBOOK_PUBLIC_CANDIDATE_FIXTURE';
    const fixture=await import('./facebook-public-candidate-fixture.js');
    const report=await (facebookSearchPostOpenFixture?((host:typeof browserHost,tools:typeof facebookDomTools)=>fixture.runFacebookSearchPostOpenFixture(host,tools,searchPostOpenCase!)):facebookRouteVerificationFixture?((host:typeof browserHost,tools:typeof facebookDomTools)=>fixture.runFacebookPostRouteVerificationFixture(host,tools,routeVerificationCase!)):facebookPostPerformanceFixture?fixture.runFacebookPostPerformanceFixture:facebookCurrentPostFixture||facebookCurrentPostBarriers?((host:typeof browserHost,tools:typeof facebookDomTools)=>fixture.runFacebookCurrentPostFixture(host,tools,facebookCurrentPostBarriers)):facebookPublicGroupFixture?fixture.runFacebookPublicGroupFixture:facebookAuxiliaryFixture?fixture.runFacebookAuxiliaryFixture:facebookHeaderTreeFixture?fixture.runFacebookHeaderTreeFixture:facebookOptionalTimeFixture?fixture.runFacebookOptionalTimeFixture:facebookLocalClipFixture?fixture.runFacebookLocalClipFixture:facebookTextVisibilityFixture?fixture.runFacebookTextVisibilityFixture:facebookTemporalFixture?fixture.runFacebookHeaderTemporalFixture:facebookOverlayFixture?fixture.runFacebookOverlayVisibilityFixture:facebookLayoutFixture?fixture.runFacebookDomLayoutFixture:facebookBoundaryFixture?fixture.runFacebookCandidateBoundaryFixture:fixture.runFacebookPublicCandidateFixture)(browserHost,facebookDomTools);await browserHost.shutdown();
    const closed=once(mainWindow,'closed');mainWindow.close();await closed;
    writeFileSync(join(smokeRoot,'facebook-public-candidate-result.json'),JSON.stringify({...report,windowsAfterClose:BrowserWindow.getAllWindows().length,webContentsAfterClose:webContents.getAllWebContents().length}));
    app.quit();return;
  }

  if (facebookDomFixture && smokeRoot && facebookDomTools) {
    startupPhase = 'FACEBOOK_DOM_FIXTURE';
    const { runFacebookDomFixture } = await import('./facebook-dom-diagnostic-fixture.js');
    const report = await runFacebookDomFixture(browserHost, facebookDomTools);
    await browserHost.shutdown();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    writeFileSync(join(smokeRoot, 'facebook-dom-result.json'), JSON.stringify({ ...report,
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (authDependencySmoke && smokeRoot && browserPolicyDiagnostics) {
    startupPhase = 'AUTH_DEPENDENCY_SMOKE';
    const { runAuthDependencySmoke } = await import('./auth-dependency-smoke.js');
    const report = await runAuthDependencySmoke(browserHost, browserPolicyDiagnostics);
    await browserHost.shutdown(); browserPolicyDiagnostics.publish();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    writeFileSync(join(smokeRoot, 'auth-dependency-result.json'), JSON.stringify({ ...report,
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (visibleDiagnosticsRoot) {
    startupPhase = 'VISIBLE_DIAGNOSTICS';
    const { recordVisibleStartup } = await import('./visible-startup-diagnostics.js');
    await recordVisibleStartup({ directory: visibleDiagnosticsRoot, window: mainWindow, host: browserHost, probe,
      manualLoginEnabled, rendererErrors });
  }

  if (policySmoke && smokeRoot && fixtureOrigin && browserPolicyDiagnostics) {
    startupPhase = 'POLICY_DIAGNOSTICS_SMOKE';
    const { runPolicyDiagnosticSmoke } = await import('./policy-diagnostics-smoke.js');
    const report = await runPolicyDiagnosticSmoke(browserHost, browserPolicyDiagnostics, fixtureOrigin);
    await browserHost.shutdown(); browserPolicyDiagnostics.publish();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    writeFileSync(join(smokeRoot, 'policy-diagnostics-result.json'), JSON.stringify({ ...report,
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (probeSmoke && smokeRoot && fixtureOrigin) {
    startupPhase = 'PROBE_SMOKE';
    if (process.argv.includes('--csd-probe-interrupt')) {
      const profile = await browserHost.create('Interrupted synthetic probe'); await browserHost.open(profile.id);
      const started = probe.start(profile.id);
      // Deliberate process interruption: persisted manifest is kept; no resume path exists.
      writeFileSync(join(smokeRoot, 'probe-interrupted.json'), JSON.stringify({ runId: started.runId }));
      // Parent fixture harness terminates this process after observing the marker.
      // app.exit() would exercise our normal before-quit handler instead of a crash.
      await new Promise<void>(() => {}); return;
    }
    const { runProbeSmoke } = await import('./probe-smoke.js');
    const report = await runProbeSmoke({ probe, browserHost, mainWindow, userData: paths.userData, smokeRoot }).catch(error => {
      const status = probe.status(); const stage = error instanceof Error && /^PROBE_CHECK_[A-Z_]+$/.test(error.message) ? error.message : 'UNKNOWN';
      console.error('PROBE_CHECK_FAILED:' + stage + ':' + status.state + ':' + status.reason + ':' + status.counters.actions + ':' + status.counters.diagnosticCaptures); throw error;
    });
    await probe.stop('SHUTDOWN'); await browserHost.shutdown();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    writeFileSync(join(smokeRoot, 'probe-result.json'), JSON.stringify({ ...report,
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (observerSmoke && smokeRoot && fixtureOrigin) {
    startupPhase = 'OBSERVER_SMOKE';
    const scenario = process.argv.includes('--csd-observer-query') ? 'query' : 'all';
    const { runObserverSmoke } = await import('./observer-smoke.js');
    const report = await runObserverSmoke(browserHost, fixtureOrigin, scenario).catch(error => {
      const code = error instanceof Error && /^OBSERVER_CHECK_[A-Z_]+$/.test(error.message) ? error.message : 'OBSERVER_FIXTURE_FAILED';
      console.error(code); throw error;
    });
    await browserHost.shutdown();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    writeFileSync(join(smokeRoot, 'observer-result.json'), JSON.stringify({ ...report,
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (sessionSmoke && smokeRoot && fixtureOrigin) {
    startupPhase = 'SESSION_SMOKE';
    const { runSessionSmoke } = await import('./session-smoke.js');
    const result = await runSessionSmoke({ host: browserHost, secrets, profiles, fixtureOrigin, smokeRoot, mainWindow }).catch(error => {
      // This branch only executes with an isolated temp root and local synthetic fixture.
      if (error instanceof Error) console.error('SESSION_FIXTURE_FAILURE:' + error.message);
      throw error;
    });
    if (result.abruptExit) { app.exit(0); return; }
    await browserHost.shutdown();
    const closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
    const reportFile = join(smokeRoot, 'session-result.json');
    writeFileSync(reportFile, JSON.stringify({ ...JSON.parse(readFileSync(reportFile, 'utf8')),
      windowsAfterClose: BrowserWindow.getAllWindows().length, webContentsAfterClose: webContents.getAllWebContents().length }));
    app.quit(); return;
  }

  if (smoke && smokeRoot) {
    await initialPaint;
    startupPhase = 'UI_SMOKE_INITIAL';
    // Trusted local test instrumentation only; there is no renderer API for script execution.
    const initial = await mainWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      const info = await window.csd.getInfo();
      document.getElementById('offline-check').click();
      return { info, title: document.title, nodeAvailable: typeof require !== 'undefined',
        processAvailable: typeof process !== 'undefined', bridgeKeys: Object.keys(window.csd).sort() };
    })()`);
    // Poll a DOM condition rather than relying on a rendering delay.
    startupPhase = 'UI_SMOKE_DOM';
    const offline = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const read = () => document.getElementById('check-result').dataset.state;
      if (read() === 'passed') { resolve(true); return; }
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('OFFLINE_CHECK_TIMEOUT')); }, 5000);
      const observer = new MutationObserver(() => {
        if (read() === 'passed') { clearTimeout(timeout); observer.disconnect(); resolve(true); }
      });
      observer.observe(document.getElementById('check-result'), { attributes: true });
    })`);
    startupPhase = 'UI_SMOKE_NETWORK';
    let networkBlocked = false;
    try { await uiSession.fetch('https://csd-bootstrap.invalid/blocked-test'); }
    catch { networkBlocked = true; }
    startupPhase = 'UI_SMOKE_CAPTURE';
    const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    writeFileSync(join(smokeRoot, 'offline-ui.png'), image.toPNG());
    startupPhase = 'UI_SMOKE_CLOSE';
    const closed = once(mainWindow, 'closed');
    mainWindow.close();
    await closed;
    startupPhase = 'UI_SMOKE_REPORT';
    writeFileSync(join(smokeRoot, 'smoke-result.json'), JSON.stringify({
      appId: PRODUCT_ID, appName: app.getName(), version: app.getVersion(),
      electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
      initial, offlineCheckPassed: offline,
      configuredWebPreferences: { sandbox: webPreferences.sandbox, contextIsolation: webPreferences.contextIsolation,
        nodeIntegration: webPreferences.nodeIntegration, webviewTag: webPreferences.webviewTag },
      uiPartition: UI_PARTITION, dataPathsIsolated: Object.values(paths).every(value => value.startsWith(join(smokeRoot, 'user-data'))),
      appRoot: app.getAppPath(), electronExecutable: process.execPath,
      networkBlocked, blockedExternalRequests, windowsAfterClose: BrowserWindow.getAllWindows().length,
      webContentsAfterClose: webContents.getAllWebContents().length,
      rendererErrors, captureMode: 'FIXTURE', verifiedValidUniquePosts: 0,
    }, null, 2));
    app.quit();
  }
}

void bootstrap().catch(() => {
  // Do not print arbitrary exception data supplied by configuration or web content.
  console.error('CSD_STARTUP_FAILED:' + startupPhase);
  app.exit(1);
});
