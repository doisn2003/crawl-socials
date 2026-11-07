// Real Electron renderer with an isolated mock host; all network requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const page = resolve(option('page', 'dist/renderer/index.html'));
const output = resolve(option('out', 'artifacts/production-v2-ui-smoke'));
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url), '--page=' + page, '--out=' + output],
    { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; process.stderr.write(b); });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs); console.log(logs.trim());
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  const isolated = mkdtempSync(join(tmpdir(), 'csd-v2-ui-'));
  app.setPath('userData', join(isolated, 'user-data')); app.setPath('sessionData', join(isolated, 'sessions'));
  mkdirSync(output, { recursive: true });
  const preload = join(isolated, 'preload.cjs');
  writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const api={};
for(const name of ['getState','saveConfig','prepareCampaign','start','stop','login','listRetainedSources'])api[name]=arg=>ipcRenderer.invoke('mock:'+name,arg);
api.geminiKey={status:async()=>({source:'NONE',readError:false})};api.discoveryWatch={};
for(const name of ['list','create','setEnabled','runNow','attachRecipe'])api.discoveryWatch[name]=arg=>ipcRenderer.invoke('mock:discovery:'+name,arg);
contextBridge.exposeInMainWorld('csd',api);`);
  const config = { schemaVersion: 2, performance: 'BALANCED', keywords: ['spa'], minimumPosts: 1000,
    spendLimits: { totalUsd: 3, dailyUsd: 3 }, opportunity: { enabled: true, filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE',
      prompt: 'Tìm người quan tâm chăm sóc sắc đẹp, chia sẻ và đánh giá dịch vụ spa', brandContext: '', totalTarget: 1000, rawCap: 20000, budgetUsd: 3, commentsEnabled: false } };
  const accounts = ['facebook', 'facebook', 'threads'].map((platform, index) => ({ id: 'csd-00000000-0000-4000-8000-00000000000' + (index + 1),
    platform, label: (platform === 'facebook' ? 'Facebook' : 'Threads') + ' · Tài khoản ' + (index + 1), authenticated: true, open: false, persistenceError: null }));
  let state = { version: '2.0.0-candidate', config: structuredClone(config), accounts, run: null, campaignPresets: [] };
  let subscriptions = [], starts = 0, prepares = 0, prepareResolve, startResolve, lastStart, lastLogin, lastAttach, watchCreates = 0, watchRuns = 0;
  const cost = { measuredUsd: 0, unknownUpperUsd: 0, reservedUsd: 0, budgetUsd: 3, billableAttempts: 0 };
  const draft = () => ({ runId: 'crawl-00000000-0000-4000-8000-000000000010', revision: 'fixture-ready', config: structuredClone(state.config.opportunity),
    configHash: 'fixture-hash', status: 'DRAFT', supported: true, cost, criteriaCapabilities: { extendedClassificationCriteria: true },
    criteria: { topic: 'Spa và chăm sóc sắc đẹp', audience: [], needs: [], participation_intents: [], research_intents: [], inclusions: [], exclusions: [],
      required_geographies: [], preferred_geographies: [], languages: ['vi'], source_priority: ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'],
      queries: [{ text: 'da xuống sắc', family: 'PROBLEM', platforms: ['facebook', 'threads'] }, { text: 'review spa', family: 'EXPERIENCE', platforms: ['facebook', 'threads'] }],
      assumptions: [], max_age_days: null, watch: { enabled: false, revisit_hours: [], ttl_hours: 72, max_attempts: 0 } } });
  const finishPreparation = () => { state.campaignDraft = draft(); prepareResolve(structuredClone(state)); prepareResolve = null; };
  const finishStart = () => {
    state.run = { id: 'crawl-00000000-0000-4000-8000-000000000010', state: 'RUNNING', startedAt: '2026-11-06T00:00:00Z', finishedAt: null,
      minimumPosts: 5000, keywords: ['da xuống sắc', 'review spa'], outputDirectory: isolated, preview: [],
      platforms: lastStart.profiles.map(p => ({ ...p, state: 'RUNNING', count: 0, reason: null })) };
    startResolve(structuredClone(state)); startResolve = null;
  };
  ipcMain.handle('mock:getState', () => structuredClone(state));
  ipcMain.handle('mock:saveConfig', (_event, next) => { state.config = next; return structuredClone(next); });
  ipcMain.handle('mock:listRetainedSources', () => ({ sources: [], issues: [] }));
  ipcMain.handle('mock:prepareCampaign', () => { prepares++; return new Promise(resolve => { prepareResolve = resolve; }); });
  ipcMain.handle('mock:start', (_event, value) => { starts++; lastStart = value; return new Promise(resolve => { startResolve = resolve; }); });
  ipcMain.handle('mock:login', (_event, value) => { lastLogin = value; });
  ipcMain.handle('mock:discovery:list', () => structuredClone(subscriptions));
  ipcMain.handle('mock:discovery:attachRecipe', (_event, value) => {
    lastAttach = value; subscriptions.find(sub => sub.id === value.id).recipeRunId = value.sourceRunId; return structuredClone(subscriptions);
  });
  ipcMain.handle('mock:discovery:create', (_event, value) => {
    watchCreates++; subscriptions = [{ id: 'fixture-watch', ...value, enabled: true, intervalHours: 24, monthlyTarget: 100,
      nextRunAt: '2026-11-07T02:00:00Z', lastRunId: null, activeRunId: null, awaitingExport: false, lastError: null, deliveredThisMonth: 0, deliveredTotal: 5000 }];
    return structuredClone(subscriptions);
  });
  ipcMain.handle('mock:discovery:setEnabled', (_event, value) => { subscriptions[0].enabled = value.enabled; return structuredClone(subscriptions); });
  ipcMain.handle('mock:discovery:runNow', () => { watchRuns++; subscriptions[0].activeRunId = 'fixture-followup'; return structuredClone(subscriptions); });
  const timeout = setTimeout(() => { console.error('PRODUCTION_V2_UI_TIMEOUT'); app.exit(1); }, 60000);
  app.whenReady().then(async () => { let window;
  try {
    window = new BrowserWindow({ show: false, width: 1160, height: 1040, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload } });
    const errors = []; let networkAttempts = 0;
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, done) => { networkAttempts++; done({ cancel: true }); });
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    window.webContents.on('render-process-gone', (_event, details) => { errors.push('RENDERER_GONE:' + details.reason); });
    const run = code => window.webContents.executeJavaScript(code).catch(error => { throw new Error('UI_EVAL_FAILED: ' + code, { cause: error }); });
    const until = async condition => { for (let i = 0; i < 150; i++) { if (typeof condition === 'string' ? await run(condition) : await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('UI_WAIT_FAILED: ' + condition); };
    const reload = async (running = false) => { const loaded = once(window.webContents, 'did-finish-load'); window.reload(); await loaded;
      await until(running ? "!document.getElementById('stop').hidden" : "!document.getElementById('filter-mode').disabled"); };
    const screenshot = async name => { await new Promise(resolve => setTimeout(resolve, 100)); writeFileSync(join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    await window.loadFile(page); await until("!document.getElementById('filter-mode').disabled");
    assert.deepEqual(await run("Array.from(document.querySelector('#filter-mode').options,o=>o.value)"), ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY']);
    assert.equal(await run("document.querySelector('#filter-mode').tagName"), 'SELECT');
    assert.equal(await run("!document.querySelector('.comments-setting').hidden && !document.querySelector('#collect-comments').checked"), true);
    for (const mode of ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY', 'CONSISTENT']) {
      await run(`(() => {const select=document.getElementById('filter-mode');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));select.dispatchEvent(new Event('blur'));})()`);
      await until(() => state.config.opportunity.filterMode === mode);
      assert.equal(state.config.opportunity.budgetUsd, mode === 'OFF' ? 0 : 3);
      assert.equal(state.config.opportunity.commentsEnabled, false);
      assert.equal(await run("document.querySelector('#collect-comments').disabled"), mode === 'OFF');
    }
    await run("document.getElementById('collect-comments').click()"); await until(() => state.config.opportunity.commentsEnabled);
    await reload(); assert.equal(await run("document.getElementById('filter-mode').value"), 'CONSISTENT');
    assert.equal(await run("document.getElementById('collect-comments').checked && !document.getElementById('comments-warning').hidden"), true);
    await run("document.getElementById('collect-comments').click()"); await until(() => !state.config.opportunity.commentsEnabled);
    await run("const target=document.getElementById('suitable-target');target.value='5000';target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('blur'))");
    await until(() => state.config.opportunity.totalTarget === 5000);
    assert.equal(await run("document.getElementById('suitable-target').max"), '5000');
    assert.equal(state.config.opportunity.rawCap, 20000);
    await run("document.querySelector('#accounts-list-facebook button').click()"); await until(() => !!lastLogin);
    assert.deepEqual(lastLogin, { platform: 'facebook', createNew: true });
    await until("!document.querySelector('#accounts-list-facebook input').disabled");
    await run("document.querySelectorAll('.account-options input[type=checkbox]').forEach(box=>{if(!box.checked)box.click()})");
    await until("!document.getElementById('start').disabled");
    assert.equal(await run("document.querySelectorAll('.account-options input:checked').length"), 3);
    await run("document.getElementById('filter-mode').scrollIntoView({block:'start',behavior:'instant'})"); await screenshot('four-modes-and-target.png');
    await run("document.getElementById('accounts-list-facebook').scrollIntoView({block:'center',behavior:'instant'})"); await screenshot('multiple-accounts.png');
    await run("document.getElementById('start').click();document.getElementById('start').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await until(() => !!prepareResolve);
    assert.equal(await run("document.querySelector('#collect-comments').disabled"), true);
    assert.equal(prepares, 1); assert.equal(starts, 0);
    assert.equal(await run("document.getElementById('start').getAttribute('aria-busy')"), 'true');
    finishPreparation(); await until(() => !!startResolve); assert.equal(starts, 1); assert.equal(lastStart.profiles.length, 3);
    assert.equal(new Set(lastStart.profiles.map(p => p.profileId)).size, 3); finishStart();
    await until("!document.getElementById('stop').hidden");
    assert.equal(await run("Array.from(document.querySelectorAll('.account-options input')).every(box=>box.disabled)"), true);
    const empty = { raw: 0, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 0, failed: 0 };
    state.run.state = 'COMPLETED'; state.run.finishedAt = '2026-11-06T03:00:00Z'; state.run.platforms.forEach(p => { p.state = 'COMPLETED'; p.count = 2500; });
    state.run.opportunity = { campaignId: state.run.id, totalTarget: 5000, targetCount: 5000, extraCount: 0, filterMode: 'CONSISTENT', resultPolicy: 'GLOBAL_FIRST_QUALIFIED',
      threadsShare: .5, counts: { ...empty, raw: 7500, suitable: 5000 }, byPlatform: { facebook: { ...empty, raw: 5000, suitable: 3500 }, threads: { ...empty, raw: 2500, suitable: 1500 } },
      costUsd: .8, costUpperUsd: .8, usageUnknown: 0, budgetUsd: 3, phase: 'SETTLED', lastError: null, preview: [] };
    delete state.campaignDraft; await reload(); await until("!document.querySelector('.discovery-panel > button, .discovery-panel .discovery-create-btn').disabled");
    assert.equal(await run("document.querySelectorAll('#run-progress .progress-card').length"), 2);
    assert.deepEqual(await run("Array.from(document.querySelectorAll('#run-progress .progress-bar'), bar=>bar.value)"), [3500, 1500]);
    assert.equal(await run("Array.from(document.querySelectorAll('#run-progress .progress-bar'), bar=>bar.value).reduce((sum,count)=>sum+count,0)"), 5000);
    await run("document.querySelector('.discovery-panel input[aria-label]').value='Khách hàng spa A'");
    await run("document.querySelector('.discovery-panel > button, .discovery-panel .discovery-create-btn').click()"); await until(() => watchCreates === 1);
    await until("document.querySelector('.discovery-panel article')!==null");
    assert.equal(subscriptions[0].sourceRunId, state.run.id); assert.equal(subscriptions[0].monthlyTarget, 100);
    assert.equal(subscriptions[0].label, 'Khách hàng spa A');
    assert.equal(await run("document.querySelector('.discovery-panel').innerText.includes('bài cũ mới tìm thấy')"), true);
    assert.equal(await run("document.querySelector('.discovery-panel article .text-button:last-child').disabled"), true);
    const originalSource = subscriptions[0].sourceRunId;
    state.run.id = 'crawl-00000000-0000-4000-8000-000000000011'; await reload();
    await until("!document.querySelector('.discovery-panel article .text-button:last-child').disabled");
    await run("document.querySelector('.discovery-panel article .text-button:last-child').click()"); await until(() => !!lastAttach);
    assert.deepEqual(lastAttach, { id: 'fixture-watch', sourceRunId: state.run.id });
    assert.equal(subscriptions[0].sourceRunId, originalSource); assert.equal(subscriptions[0].recipeRunId, state.run.id);
    await until("document.querySelector('.discovery-panel article .text-button:last-child').disabled");
    await run("document.querySelector('.discovery-panel article .text-button').click()"); await until(() => !subscriptions[0].enabled);
    await until("document.querySelector('.discovery-panel article .text-button').textContent==='Bật lịch'");
    assert.equal(await run("document.querySelector('.discovery-panel article .secondary-button').disabled"), true);
    await run("document.querySelector('.discovery-panel article .text-button').click()"); await until(() => subscriptions[0].enabled);
    await until("!document.querySelector('.discovery-panel article .secondary-button').disabled");
    await run("document.querySelector('.discovery-panel article .secondary-button').click()"); await until(() => watchRuns === 1);
    await until("document.querySelector('.discovery-panel article').innerText.includes('Đang tìm bổ sung')");
    state.run.state = 'RUNNING'; state.run.finishedAt = null; await reload(true);
    await until("!document.querySelector('.discovery-panel article .text-button').disabled");
    await run("document.querySelector('.discovery-panel article .text-button').click()"); await until(() => !subscriptions[0].enabled);
    await until("!document.querySelector('.discovery-panel article .text-button').disabled");
    await run("document.querySelector('.discovery-panel article .text-button').click()"); await until(() => subscriptions[0].enabled);
    assert.equal(await run("document.querySelector('.discovery-panel article .secondary-button').disabled"), true);
    state.run.state = 'COMPLETED'; state.run.finishedAt = '2026-11-06T04:00:00Z';
    subscriptions[0].activeRunId = null; subscriptions[0].awaitingExport = true; await reload();
    await until("document.querySelector('.discovery-panel article')?.innerText.includes('Có kết quả chờ xuất')");
    assert.equal(await run("document.querySelector('.discovery-panel article .secondary-button').disabled"), true);
    await run("document.querySelector('.discovery-panel').scrollIntoView({block:'center',behavior:'instant'})"); await screenshot('monthly-discovery.png');
    assert.equal(await run("document.querySelector('#collect-comments').disabled"), state.config.opportunity.filterMode === 'OFF');
    assert.deepEqual(errors, []); assert.equal(networkAttempts, 0);
    const report = { passed: true, actualRenderer: page, isolatedData: isolated, fourNamedModes: true, modePersistence: true, offBudgetZero: true,
      target5000: true, rawCap20000: true, commentToggle: true, multipleAccounts: lastStart.profiles.length, explicitAddAccount: true,
      oneClickPlanning: true, duplicateStartBlocked: true, groupedPlatformCounts: true, watchCreateToggleRun: true, watchLabel: true,
      recipeAttachmentPreservesCustomer: true, watchToggleDuringActiveRun: true, awaitingExportBlocksNextRun: true,
      oldNewlyFoundMonthlyDefinition: true, hiddenWindow: !window.isVisible(), blockedNetworkAttempts: networkAttempts, liveModelCalls: 0, rendererErrors: errors };
    writeFileSync(join(output, 'production-v2-ui-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    clearTimeout(timeout); window.destroy(); app.quit();
  } catch (error) {
    console.error(error);
    try { if (window && !window.isDestroyed()) writeFileSync(join(output, 'failure.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }
    catch (captureError) { console.error('FAILURE_CAPTURE:' + captureError.message); }
    finally { clearTimeout(timeout); window?.destroy(); app.exit(1); }
  }
  });
}
