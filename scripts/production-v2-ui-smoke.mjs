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
for(const name of ['getState','saveConfig','prepareCampaign','start','stop','login','listRetainedSources','exportResults'])api[name]=arg=>ipcRenderer.invoke('mock:'+name,arg);
api.geminiKey={status:async()=>({source:'NONE',readError:false})};
api.projects={state:async()=>({activeProjectId:'fixture-project',projects:[{id:'fixture-project',name:'Project kiểm thử',avatar:null}],user:null,backup:{configured:false,status:'LOCAL',lastSyncAt:null,error:null}})};
contextBridge.exposeInMainWorld('csd',api);`);
  const config = { schemaVersion: 2, performance: 'BALANCED', keywords: ['spa'], minimumPosts: 1000,
    opportunity: { enabled: true, filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE',
      prompt: 'Tìm người quan tâm chăm sóc sắc đẹp, chia sẻ và đánh giá dịch vụ spa', brandContext: '', totalTarget: 1000, rawCap: 5000, budgetUsd: 3, commentsEnabled: false } };
  const accounts = ['facebook', 'facebook', 'threads'].map((platform, index) => ({ id: 'csd-00000000-0000-4000-8000-00000000000' + (index + 1),
    platform, label: (platform === 'facebook' ? 'Facebook' : 'Threads') + ' · Tài khoản ' + (index + 1), authenticated: true, open: false, persistenceError: null }));
  let state = { version: '2.0.0-candidate', config: structuredClone(config), accounts, run: null, campaignPresets: [] };
  let starts = 0, prepares = 0, prepareResolve, startResolve, lastStart, lastLogin;
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
  const exports = [];
  ipcMain.handle('mock:exportResults', (_event, value) => { exports.push(value); return { canceled: true, path: null }; });
  const timeout = setTimeout(() => { console.error('PRODUCTION_V2_UI_TIMEOUT'); app.exit(1); }, 60000);
  app.whenReady().then(async () => { let window;
  try {
    window = new BrowserWindow({ show: false, width: 1160, height: 1040, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, preload } });
    window.webContents.setFrameRate(15); window.webContents.startPainting();
    const errors = []; let networkAttempts = 0;
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, done) => { networkAttempts++; done({ cancel: true }); });
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    window.webContents.on('render-process-gone', (_event, details) => { errors.push('RENDERER_GONE:' + details.reason); });
    const run = code => window.webContents.executeJavaScript(code).catch(error => { throw new Error('UI_EVAL_FAILED: ' + code, { cause: error }); });
    const refresh = () => run("window.dispatchEvent(new Event('focus'))");
    const until = async condition => { for (let i = 0; i < 150; i++) { if (typeof condition === 'string' ? await run(condition) : await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('UI_WAIT_FAILED: ' + condition); };
    const reload = async (running = false) => { const loaded = once(window.webContents, 'did-finish-load'); window.reload(); await loaded;
      await until(running ? "!document.getElementById('stop').hidden" : "!document.getElementById('filter-mode').disabled"); };
    const screenshot = async name => { await new Promise(resolve => setTimeout(resolve, 100)); writeFileSync(join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    await window.loadFile(page); await until("!document.getElementById('filter-mode').disabled");
    assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-filter-band]'),band=>band.dataset.filterBand)"), ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY']);
    assert.equal(await run("document.getElementById('filter-mode').type"), 'range');
    assert.deepEqual(await run("Array.from(document.querySelectorAll('.config-panel input[type=number]')).filter(input=>input.getClientRects().length).map(input=>input.id)"), ['suitable-target']);
    assert.equal(await run("document.getElementById('advanced-settings-toggle').getAttribute('aria-expanded')"), 'false');
    await run("document.getElementById('advanced-settings-toggle').click()");
    assert.equal(await run("document.getElementById('advanced-settings-toggle').getAttribute('aria-expanded')"), 'true');
    assert.deepEqual(await run("['raw-cap','model-budget','spend-total','spend-daily'].map(id=>document.getElementById(id).valueAsNumber)"), [5000, 3, 30, 6]);
    assert.equal(await run("document.getElementById('collect-comments').checked"), false);
    await run("document.getElementById('advanced-settings').scrollIntoView({block:'center',behavior:'instant'})"); await screenshot('advanced-settings.png');
    for (const [percent, mode] of [[0, 'OFF'], [10, 'OFF'], [11, 'CONSISTENT'], [49, 'CONSISTENT'], [50, 'STANDARD'], [90, 'STANDARD'], [91, 'QUALITY'], [100, 'QUALITY'], [27, 'CONSISTENT']]) {
      await run(`(() => {const slider=document.getElementById('filter-mode');slider.value=${percent};slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(() => state.config.filterPercent === percent && state.config.opportunity.filterMode === mode);
      assert.equal(state.config.opportunity.budgetUsd, mode === 'OFF' ? 0 : 3);
      assert.equal(state.config.opportunity.commentsEnabled, false);
      assert.equal(await run("document.querySelector('#collect-comments').disabled"), mode === 'OFF');
    }
    await run("document.getElementById('collect-comments').click()"); await until(() => state.config.opportunity.commentsEnabled);
    await reload(); assert.equal(await run("document.getElementById('filter-mode').value"), '27');
    assert.equal(await run("document.getElementById('advanced-settings').hidden"), true);
    await run("document.getElementById('advanced-settings-toggle').click()");
    assert.equal(await run("document.getElementById('collect-comments').checked && !document.getElementById('comments-warning').hidden"), true);
    await run("document.getElementById('collect-comments').click()"); await until(() => !state.config.opportunity.commentsEnabled);
    await run("document.getElementById('advanced-settings-toggle').click()");
    await run("const target=document.getElementById('suitable-target');target.value='5000';target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('blur'))");
    await until(() => state.config.opportunity.totalTarget === 5000);
    assert.equal(await run("document.getElementById('suitable-target').max"), '5000');
    assert.equal(state.config.opportunity.rawCap, 5000);
    await run("document.querySelector('#accounts-list-facebook button').click()"); await until(() => !!lastLogin);
    assert.deepEqual(lastLogin, { platform: 'facebook', createNew: true });
    await until("!document.querySelector('#accounts-list-facebook input').disabled");
    await run("document.querySelectorAll('.account-options input[type=checkbox]').forEach(box=>{if(!box.checked)box.click()})");
    await until("!document.getElementById('start').disabled");
    assert.equal(await run("document.querySelectorAll('.account-options input:checked').length"), 3);
    state.accounts.push(...['facebook', 'threads'].map((platform, index) => ({
      id: 'csd-00000000-0000-4000-8000-00000000001' + index, platform, label: 'Chưa đăng nhập ' + platform,
      authenticated: false, open: true, persistenceError: null,
    })));
    await refresh();
    await until("document.querySelectorAll('.account-options input[type=checkbox]').length === 5");
    assert.equal(await run("document.querySelectorAll('.account-options input:checked').length"), 3);
    await run("document.getElementById('filter-slider').parentElement.scrollIntoView({block:'start',behavior:'instant'})"); await screenshot('four-modes-and-target.png');
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
      threadsShare: .5, counts: { ...empty, raw: 7500, suitable: 5000, unrelated: 2500 },
      byPlatform: { facebook: { ...empty, raw: 5000, suitable: 3500, unrelated: 1500 }, threads: { ...empty, raw: 2500, suitable: 1500, unrelated: 1000 } },
      costUsd: .8, costUpperUsd: .8, usageUnknown: 0, budgetUsd: 3, phase: 'SETTLED', lastError: null, preview: [] };
    const completed = structuredClone(state.run);
    state.run.state = 'RUNNING'; state.run.opportunity.phase = 'COLLECTING';
    state.run.opportunity.counts = { ...empty }; state.run.opportunity.targetCount = 0;
    state.run.opportunity.byPlatform = { facebook: { ...empty }, threads: { ...empty } };
    state.run.platforms.forEach(p => { p.state = 'RUNNING'; p.count = 0; p.resources = {
      active: 0, queued: 96, automaticLimit: 1, activeProfiles: 0, freeBytes: 800e6, totalBytes: 12e9, cpuBusy: .1,
      pressureSince: null, admission: 'WAITING_MEMORY', memoryWaitMs: 5000, sampledAt: Date.now(),
    }; });
    await refresh(); await until("document.querySelector('#run-badge').textContent === 'ĐANG CHỜ RAM'");
    assert.match(await run("document.querySelector('#collection-search-state').textContent"), /chờ RAM/);
    assert.equal(await run("document.querySelector('#collection-filter-state').textContent"), 'Chờ bài viết để lọc');
    await run("document.getElementById('collection-progress').scrollIntoView({block:'start',behavior:'instant'})");
    await screenshot('memory-wait.png');
    state.run.state = 'STOPPED'; state.run.platforms.forEach(p => { p.state = 'STOPPED'; p.reason = 'RESOURCE_MEMORY_WAIT'; });
    await refresh(); await until("document.querySelector('#run-error').textContent.includes('chưa đủ RAM')");
    assert.match(await run("document.querySelector('#start-help').textContent"), /Tiếp tục lượt này/);
    state.run = completed;
    delete state.campaignDraft; await reload();
    assert.equal(await run("document.querySelector('.discovery-panel') === null"), true);
    assert.equal(await run("document.querySelectorAll('#run-progress .progress-card').length"), 2);
    assert.deepEqual(await run("Array.from(document.querySelectorAll('#run-progress .progress-bar'), bar=>bar.value)"), [3500, 1500]);
    assert.equal(await run("Array.from(document.querySelectorAll('#run-progress .progress-bar'), bar=>bar.value).reduce((sum,count)=>sum+count,0)"), 5000);
    assert.equal(await run("document.querySelector('#collection-target-bar').value"), 5000);
    const fixturePost = (id, classification = 'SUITABLE') => ({ platform: 'threads', rootId: String(id), classification,
      text: ('Nội dung bài ' + id + '\n').repeat(15), reason: 'Nhận định riêng về bài ' + id, reasonCode: 'FIXTURE',
      evidence: ['TRICH_DAN_GOC'], link: '', observedAt: new Date(Date.UTC(2026, 10, 6, 0, id)).toISOString(),
      opportunityTypes: ['EXPERIENCE'], coverage: 'NOT_ATTEMPTED',
      ...(id === 4 ? { previouslyCollected: true, assessmentReused: true, assessmentSourceMode: 'QUALITY' } : {}) });
    state.run.opportunity.preview = [1, 4, 2, 3].map(id => fixturePost(id)).concat(fixturePost(10, 'NOT_SUITABLE'));
    await refresh();
    await until("document.querySelectorAll('#opportunity-cards article').length === 4");
    assert.match(await run("document.querySelector('.opportunity-need-summary').textContent"), /Nhận định riêng về bài 4/);
    assert.match(await run("document.querySelector('.previously-collected').textContent"), /Đã thu thập trước đó.*QUALITY/);
    assert.equal(await run("document.querySelector('#opportunity-cards').textContent.includes('TRICH_DAN_GOC')"), false);
    await run("window.testReadingList = document.querySelector('#opportunity-cards'); testReadingList.scrollTop = 170; window.testReadingCard = testReadingList.children[1]; testReadingCard.focus({preventScroll:true}); window.testScroll = testReadingList.scrollTop");
    assert.ok(await run("testScroll > 0"));
    state.run.opportunity.preview.unshift(fixturePost(5)); state.run.opportunity.counts.raw++;
    await refresh();
    await until("document.querySelector('#collection-search-count').textContent.includes('7.501')");
    assert.equal(await run("testReadingCard === testReadingList.children[1] && testReadingCard === document.activeElement && testReadingList.scrollTop === testScroll"), true);
    assert.equal(await run("document.querySelector('#jump-to-latest-post').hidden"), false);
    await run("document.querySelector('#jump-to-latest-post').click()");
    assert.equal(await run("testReadingList.scrollTop === 0 && testReadingList.firstElementChild.textContent.includes('bài 5')"), true);
    await run("window.testReadingCard = testReadingList.children[1]; testReadingCard.focus({preventScroll:true})");
    state.run.opportunity.preview.unshift(fixturePost(6)); state.run.opportunity.counts.raw++;
    await refresh();
    await until("document.querySelector('#collection-search-count').textContent.includes('7.502')");
    assert.equal(await run("testReadingCard === testReadingList.children[1] && testReadingCard === document.activeElement && testReadingList.scrollTop === 0"), true);
    await run("document.querySelector('#jump-to-latest-post').focus({preventScroll:true})");
    assert.equal(await run("document.activeElement.id === 'jump-to-latest-post' && testReadingCard === testReadingList.children[1]"), true);
    await run("document.querySelector('#jump-to-latest-post').click()");
    assert.match(await run("testReadingList.firstElementChild.textContent"), /bài 6/);
    await run("document.getElementById('collection-progress').scrollIntoView({block:'start',behavior:'instant'})");
    await screenshot('collection-progress-and-results.png');
    await run("document.getElementById('opportunity-results').scrollIntoView({block:'start',behavior:'instant'})");
    await screenshot('result-cards.png');
    await run("document.querySelector('[data-result-group=NOT_SUITABLE]').click()");
    assert.equal(await run("document.querySelector('#export-scope').value"), 'SUITABLE');
    for (const [i, group] of ['SUITABLE', 'NOT_SUITABLE', 'ALL'].entries()) {
      await until("!document.getElementById('export-xlsx').disabled");
      await run(`document.querySelector('#export-scope').value = '${group}'; document.getElementById('export-xlsx').click()`);
      await until(() => exports.length === i + 1);
      assert.deepEqual(exports[i], { format: 'xlsx', ...(group === 'ALL' ? {} : { group }) });
    }
    assert.equal(await run("document.querySelector('#collect-comments').disabled"), state.config.opportunity.filterMode === 'OFF');
    assert.deepEqual(errors, []); assert.equal(networkAttempts, 0);
    const report = { passed: true, actualRenderer: page, isolatedData: isolated, fourModeSlider: true, modePersistence: true, offBudgetZero: true,
      target5000: true, defaultRawCap5000: true, advancedSettings: true, previouslyCollectedBadge: true,
      commentToggle: true, multipleAccounts: lastStart.profiles.length, explicitAddAccount: true,
      oneClickPlanning: true, duplicateStartBlocked: true, groupedPlatformCounts: true, noStepFour: true,
      unsignedInProfilesExcluded: true, memoryWaitVisible: true, memoryPauseExplained: true,
      stableScrollAndFocus: true, jumpToLatest: true, summaryInsteadOfExcerpt: true, exportSelection: true,
      hiddenWindow: !window.isVisible(), blockedNetworkAttempts: networkAttempts, liveModelCalls: 0, rendererErrors: errors };
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
