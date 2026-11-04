// Real renderer/layout checks with a held mock host. No profiles, collectors or paid API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const entry = resolve(option('page', 'dist/renderer/index.html'));
const output = resolve(option('out', 'artifacts/r13-light-ui'));
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url), '--page=' + entry, '--out=' + output],
    { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs); console.log(logs.trim());
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  const root = mkdtempSync(join(tmpdir(), 'csd-light-ui-'));
  app.setPath('userData', join(root, 'user-data')); app.setPath('sessionData', join(root, 'sessions'));
  mkdirSync(output, { recursive: true });
  const preload = join(root, 'preload.cjs');
  writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const api={};
for(const name of ['getState','saveConfig','prepareCampaign','continueCampaign','start','stop','listRetainedSources'])api[name]=arg=>ipcRenderer.invoke('mock:'+name,arg);
api.geminiKey={status:async()=>({source:'NONE',readError:false})};contextBridge.exposeInMainWorld('csd',api);`);
  const config = { schemaVersion: 2, filterPercent: 50, performance: 'BALANCED', keywords: [], minimumPosts: 10,
    spendLimits: { totalUsd: 3, dailyUsd: 3 }, opportunity: { enabled: true, filterMode: 'STANDARD', languageScope: 'VIETNAMESE',
      prompt: 'Tìm các bài viết liên quan đến piano', brandContext: '', totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false } };
  const cost = { measuredUsd: .001, unknownUpperUsd: 0, reservedUsd: 0, budgetUsd: 3, billableAttempts: 1 };
  const accounts = ['facebook', 'threads'].map(platform => ({ id: platform + '-fixture', platform, label: 'Tài khoản thử nghiệm', authenticated: true, open: false, persistenceError: null }));
  const fresh = () => ({ version: '0.4.0-rebuild.5.2', config: structuredClone(config), accounts: structuredClone(accounts), run: null, campaignPresets: [] });
  let state = fresh(), scene = 'READY', prepareResolve, startResolve, prepares = 0, starts = 0, answers = 0, lastStart;
  const draft = () => ({ runId: 'fixture-draft', revision: 'revision-ready', config: structuredClone(state.config.opportunity), configHash: 'fixture-hash', status: 'DRAFT', supported: true, cost,
    criteriaCapabilities: { extendedClassificationCriteria: true }, criteria: { topic: 'Piano', audience: [], needs: [], participation_intents: [], research_intents: [], inclusions: [], exclusions: [], required_geographies: [], preferred_geographies: [], languages: ['vi'], source_priority: ['PROFILE','GROUP','PAGE','UNKNOWN'],
      queries: [{ text: 'piano', family: 'BROAD', platforms: ['facebook','threads'] }], assumptions: [], max_age_days: null, watch: { enabled: false, revisit_hours: [], ttl_hours: 72, max_attempts: 3 } } });
  const intentFields = ['target_roles','purpose','include','exclude','topics','geography','time'];
  const dialogue = ready => ({ runId: 'fixture-draft', revision: ready ? 'dialogue-2' : 'dialogue-1', config: structuredClone(state.config.opportunity), configHash: 'fixture-hash', cost,
    input: { stage: 'S2', prompt: state.config.opportunity.prompt, context: '', seeds: [], revision: ready ? 2 : 1, answers: [], edits: [] },
    plan: { state: ready ? 'READY' : 'NEEDS_CLARIFICATION', understanding: 'Tìm bài viết về piano', intent_revision: ready ? 2 : 1,
      intent: intentFields.map(field => ({ field, value: 'Chưa đặt giới hạn', status: field === 'target_roles' && !ready ? 'UNRESOLVED' : 'UNSPECIFIED', evidence: [] })),
      questions: ready ? [] : [{ id: 'scope', target_field: 'target_roles', type: 'single_select', prompt: 'Bạn muốn lấy bài của những ai?', required: true,
        options: [{ id: 'all', label: 'Không giới hạn người đăng' }, { id: 'seeker', label: 'Người đang tìm dịch vụ' }], reason: 'Xác nhận phạm vi người đăng.' }] } });
  const completePreparation = () => {
    if (scene === 'ERROR') state.campaignDraftError = { code: 'MODEL_BUDGET_EXHAUSTED', runId: 'fixture-draft', cost };
    else if (scene === 'CLARIFY') state.campaignDialogue = dialogue(false);
    else state.campaignDraft = draft();
    prepareResolve(structuredClone(state)); prepareResolve = null;
  };
  const completeStart = () => {
    state.run = { id: 'fixture-run', state: 'RUNNING', startedAt: '2026-11-04T00:00:00Z', finishedAt: null, minimumPosts: 10,
      keywords: ['piano'], outputDirectory: root, preview: [], platforms: [{ platform: 'facebook', profileId: 'facebook-fixture', state: 'RUNNING', count: 0, reason: null }] };
    startResolve(structuredClone(state)); startResolve = null;
  };
  ipcMain.handle('mock:getState', () => structuredClone(state));
  ipcMain.handle('mock:saveConfig', (_event, next) => {
    next.opportunity.prompt = next.opportunity.prompt.normalize('NFC').trim();
    next.opportunity.brandContext = next.opportunity.brandContext.normalize('NFC').trim();
    state.config = next; return next;
  });
  ipcMain.handle('mock:listRetainedSources', () => ({ sources: [], issues: [] }));
  ipcMain.handle('mock:prepareCampaign', () => { prepares++; return new Promise(resolve => { prepareResolve = resolve; }); });
  ipcMain.handle('mock:continueCampaign', () => { answers++; state.campaignDialogue = dialogue(true); state.campaignDraft = draft(); return structuredClone(state); });
  ipcMain.handle('mock:start', (_event, request) => { starts++; lastStart = request; return new Promise(resolve => { startResolve = resolve; }); });
  const timer = setTimeout(() => { console.error('LIGHT_UI_SMOKE_TIMEOUT'); app.exit(1); }, 60000);
  app.whenReady().then(async () => {
    let window;
    try {
      window = new BrowserWindow({ show: false, width: 1150, height: 1050, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload } });
      let blockedRequests = 0; const errors = [];
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, done) => { blockedRequests++; done({ cancel: true }); });
      window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      const run = code => window.webContents.executeJavaScript(code);
      const until = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error('UI_WAIT_FAILED: ' + code); };
      const loaded = async () => { await until("!document.getElementById('filter-mode').disabled"); };
      const reload = async () => { const loadedEvent = once(window.webContents, 'did-finish-load'); window.reload(); await loadedEvent; await loaded(); };
      const select = async () => { await run("document.getElementById('select-facebook').click()"); await until("!document.getElementById('start').disabled"); };
      const screenshot = async name => { await new Promise(resolve => setTimeout(resolve, 130)); writeFileSync(join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
      await window.loadFile(entry); await loaded();
      assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgb(243, 246, 251)');
      assert.equal(await run("getComputedStyle(document.getElementById('status-facebook')).color"), 'rgb(18, 109, 76)');
      assert.equal(await run("document.getElementById('filter-mode').step"), '1');
      for (const [percent, mode] of [[0,'OFF'],[20,'OFF'],[21,'STANDARD'],[80,'STANDARD'],[81,'QUALITY'],[100,'QUALITY'],[57,'STANDARD']]) {
        await run(`(() => { const input=document.getElementById('filter-mode');input.value='${percent}';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('blur')); })()`);
        await until("document.getElementById('save-status').dataset.state==='saved'");
        assert.equal(state.config.filterPercent, percent); assert.equal(state.config.opportunity.filterMode, mode);
        assert.equal(await run("document.getElementById('filter-percent').textContent"), percent + '%');
      }
      await reload(); assert.equal(await run("document.getElementById('filter-mode').value"), '57');
      await screenshot('theme-and-slider.png');
      const sliderGeometry = await run(`(() => {const fill=document.querySelector('.filter-fill'),rail=document.querySelector('.filter-rail');return {fill:fill.getBoundingClientRect().width,rail:rail.clientWidth,progress:getComputedStyle(fill).getPropertyValue('--filter-progress'),percent:Number(document.getElementById('filter-mode').value)};})()`);
      assert.ok(Math.abs(sliderGeometry.fill / sliderGeometry.rail * 100 - sliderGeometry.percent) < 1, JSON.stringify(sliderGeometry));
      await select();
      await run("var prompt=document.getElementById('campaign-prompt');prompt.value='  '+prompt.value+'  ';prompt.dispatchEvent(new Event('input',{bubbles:true}))");
      await run("document.getElementById('start').click();document.getElementById('start').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
      await until("document.getElementById('start-label').textContent.includes('phân tích')");
      assert.equal(prepares, 1); assert.equal(starts, 0);
      assert.equal(await run("document.getElementById('start').getAttribute('aria-busy')"), 'true');
      assert.equal(await run("getComputedStyle(document.querySelector('.button-spinner')).animationName"), 'button-spin');
      assert.equal(await run("getComputedStyle(document.getElementById('start')).backgroundColor"), 'rgb(55, 101, 173)');
      await run("document.getElementById('start').scrollIntoView({block:'center',behavior:'instant'})"); await screenshot('planning-loading.png');
      completePreparation(); await until("document.getElementById('start-label').textContent.includes('bắt đầu')");
      assert.equal(starts, 1); assert.equal(lastStart.draft.revision, 'revision-ready');
      completeStart(); await until("!document.getElementById('stop').hidden");
      state = fresh(); scene = 'ERROR'; prepares = starts = 0; await reload(); await select();
      await run("window.scrollTo(0,0);document.getElementById('start').click()");
      await until("document.getElementById('start-label').textContent.includes('phân tích')"); completePreparation();
      await until("document.getElementById('operation-status').dataset.state==='error' && document.getElementById('start').getAttribute('aria-busy')==='false'");
      assert.equal(starts, 0); assert.equal(await run("getComputedStyle(document.getElementById('operation-status')).backgroundColor"), 'rgb(255, 240, 242)');
      await until("document.activeElement.id==='operation-status' && document.getElementById('operation-status').getBoundingClientRect().bottom<=innerHeight");
      assert.equal(await run("document.getElementById('start').disabled"), false); await screenshot('error-scrolled-into-view.png');
      state = fresh(); scene = 'CLARIFY'; prepares = starts = answers = 0; await reload(); await select();
      await run("document.getElementById('start').click()"); await until("document.getElementById('start-label').textContent.includes('phân tích')"); completePreparation();
      await until("!document.getElementById('campaign-dialogue').hidden && document.getElementById('start').getAttribute('aria-busy')==='false'"); assert.equal(starts, 0);
      await run("document.querySelector('#campaign-dialogue input[value=all]').click();document.querySelector('#campaign-dialogue form').requestSubmit()");
      await until("document.getElementById('start-label').textContent.includes('bắt đầu')");
      assert.equal(starts, 1); assert.equal(answers, 1); assert.equal(prepares, 1); completeStart(); await until("!document.getElementById('stop').hidden");
      // A deliberate preview never starts collection; Start then reuses its plan.
      state = fresh(); scene = 'READY'; prepares = starts = 0; await reload(); await select();
      await run("document.getElementById('prepare-campaign').click()");
      for (let i = 0; i < 100 && !prepareResolve; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(prepareResolve); completePreparation(); await until("!document.getElementById('start').disabled"); assert.equal(starts, 0);
      await run("document.getElementById('start').click()"); await until("document.getElementById('start-label').textContent.includes('bắt đầu')");
      assert.equal(starts, 1); assert.equal(prepares, 1); completeStart(); await until("!document.getElementById('stop').hidden");
      // Editing the request while answering cancels the earlier automatic-start intent.
      state = fresh(); scene = 'CLARIFY'; prepares = starts = answers = 0; await reload(); await select();
      await run("document.getElementById('start').click()"); await until("document.getElementById('start-label').textContent.includes('phân tích')"); completePreparation();
      await until("!document.getElementById('campaign-dialogue').hidden && document.getElementById('start').getAttribute('aria-busy')==='false'");
      await run("var percent=document.getElementById('filter-mode');percent.value='53';percent.dispatchEvent(new Event('input',{bubbles:true}));percent.dispatchEvent(new Event('blur'))");
      await until("document.getElementById('save-status').dataset.state==='saved'");
      await run("document.querySelector('#campaign-dialogue input[value=all]').click();document.querySelector('#campaign-dialogue form').requestSubmit()");
      await until("!document.querySelector('#campaign-dialogue input[value=all]') && !document.getElementById('start').disabled"); assert.equal(starts, 0);
      assert.deepEqual(errors, []); assert.equal(blockedRequests, 0);
      const report = { passed: true, actualRenderer: entry, percentageBandsAndPersistence: true, greenLoginStatus: true,
        singleClickPlanAndStart: true, normalizedPromptStartsCorrectly: true, duplicateClickBlocked: true, animatedBusyPhases: true, redErrorScrolledAndFocused: true,
        clarificationResumesAutomatically: true, previewDoesNotStart: true, editsCancelAutomaticStart: true,
        isolatedData: true, liveApiCalls: 0, rendererErrors: errors };
      writeFileSync(join(output, 'light-ui-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
      clearTimeout(timer); window.destroy(); app.quit();
    } catch (error) { console.error(error); clearTimeout(timer); window?.destroy(); app.exit(1); }
  });
}
