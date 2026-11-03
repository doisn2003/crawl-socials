// Exercise the real main/preload/renderer together, using isolated data and no model access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
const output = resolve(process.argv.find(s => s.startsWith('--out='))?.slice(6) ?? 'artifacts/csd-rebuild-20261103/packaged');
const entry = resolve(process.argv.find(s => s.startsWith('--module='))?.slice(9) ?? 'release/win-unpacked/resources/app.asar/dist/main/index.js');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url), '--out=' + output, '--module=' + entry],
    { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs); console.log(logs.trim());
} else {
  const { app, ipcMain, BrowserWindow } = await import('electron');
  // Script launches otherwise report the Electron runtime version as the product version.
  app.getVersion = () => JSON.parse(readFileSync(resolve(dirname(entry), '../../package.json'), 'utf8')).version;
  const root = mkdtempSync(join(tmpdir(), 'csd-rebuild-app-')); mkdirSync(output, { recursive: true });
  // Keep the global spending account isolated too. Windows User key may be read but is never transmitted.
  process.env.USERPROFILE = root; app.setPath('appData', root);
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw Error('LIVE_NETWORK_FORBIDDEN'); };
  const errors = [], timer = setTimeout(() => { console.error('APP_SMOKE_TIMEOUT'); app.exit(1); }, 45000);
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {}; // Hidden verification window, never changes the user's active app.
    window.webContents.setBackgroundThrottling(false);
    window.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    window.webContents.once('did-finish-load', () => { void (async () => {
      try {
        const run = script => window.webContents.executeJavaScript(script);
        const until = async script => { for (let i = 0; i < 100; i++) { if (await run(script)) return; await new Promise(r => setTimeout(r, 50)); } throw Error('UI_WAIT_FAILED: ' + script); };
        const reload = async () => { const loaded = once(window.webContents, 'did-finish-load'); window.reload(); await loaded; await until("!document.getElementById('filter-mode').disabled"); };
        for (let i = 0; i < 100 && await run("document.getElementById('filter-mode').disabled"); i++) await new Promise(r => setTimeout(r, 50));
        const state = await run('window.csd.getState()');
        assert.equal(state.run, null); assert.equal(state.accounts.length, 0); assert.equal(state.spending.calls, 0);
        assert.equal(await run("document.getElementById('filter-mode').value"), '0');
        assert.equal(await run("document.getElementById('content-language').value"), 'VIETNAMESE');
        assert.equal(await run("document.getElementById('spend-total').value"), '3');
        assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgb(255, 255, 255)');
        assert.equal(await run("getComputedStyle(document.body).color"), 'rgb(0, 0, 0)');
        assert.match(await run("getComputedStyle(document.body).fontFamily"), /Cascadia Code.*Consolas/);
        assert.equal(await run("document.getElementById('make-it-cooler')"), null);
        assert.equal(await run("typeof window.csd.cooler"), 'undefined');
        assert.equal(await run("document.getElementById('spend-calls')"), null);
        const config = { schemaVersion: 2, keywords: ['piano'], minimumPosts: 3, spendLimits: { totalUsd: 0, dailyUsd: 0, maxCalls: 3 },
          opportunity: { enabled: true, filterMode: 'OFF', languageScope: 'VIETNAMESE', prompt: '', brandContext: '', totalTarget: 3, rawCap: 10, budgetUsd: 0, commentsEnabled: false } };
        await run('window.csd.saveConfig(' + JSON.stringify(config) + ')');
        assert.equal((await run('window.csd.getState()')).config.opportunity.filterMode, 'OFF');
        assert.equal((await run('window.csd.getState()')).config.opportunity.languageScope, 'VIETNAMESE');
        assert.deepEqual((await run('window.csd.getState()')).config.spendLimits, { totalUsd: 0, dailyUsd: 0 });
        const refusal = await run("window.csd.prepareCampaign().then(()=>null,e=>String(e.message))");
        assert.match(refusal, /OFF_MODEL_CALL_FORBIDDEN/);
        // A previous technical configuration must not leak into new UI runs.
        const legacy = { ...config, performance: 'FAST', spendLimits: { totalUsd: 12, dailyUsd: 5 },
          opportunity: { ...config.opportunity, filterMode: 'STANDARD', languageScope: 'PROMPT', budgetUsd: .2, prompt: 'Tìm người muốn học piano' } };
        await run('window.csd.saveConfig(' + JSON.stringify(legacy) + ')');
        await reload();
        for (const [index, mode] of ['OFF', 'STANDARD', 'QUALITY'].entries()) {
          await run(`(() => { const input = document.getElementById('filter-mode'); input.value = '${index}'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('blur')); })()`);
          await until("document.getElementById('save-status').dataset.state === 'saved'");
          const saved = (await run('window.csd.getState()')).config;
          assert.equal(saved.performance, 'BALANCED'); assert.equal(saved.opportunity.languageScope, 'VIETNAMESE');
          assert.equal(saved.opportunity.filterMode, mode); assert.equal(saved.opportunity.budgetUsd, mode === 'OFF' ? 0 : 3);
          assert.deepEqual(saved.spendLimits, { totalUsd: 12, dailyUsd: 5 }, 'existing monetary limits are preserved');
        }
        for (const id of ['performance-mode', 'content-language', 'model-budget', 'spending-controls', 'gemini-api-key', 'campaign-preset', 'campaign-preset-name', 'off-saved-queries']) {
          assert.equal(await run(`document.getElementById('${id}').checkVisibility()`), false, id + ' is hidden');
        }
        await new Promise(r => setTimeout(r, 250));
        writeFileSync(join(output, 'main-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        const current = await run('window.csd.getState()');
        const counts = { raw: 2718, comments: 2401, suitable: 1274, notSuitable: 980, notYet: 0, unrelated: 0, pending: 464, failed: 0 };
        const fixture = { ...current, run: { id: 'synthetic-ui-fixture', state: 'COMPLETED', startedAt: '2026-11-03T16:40:55Z', finishedAt: '2026-11-03T17:00:00Z', minimumPosts: 1000,
          keywords: ['PRIVATE_WINDOW_QUERY'], outputDirectory: root, preview: [],
          platforms: ['facebook', 'threads'].map(platform => ({ platform, profileId: null, state: 'COMPLETED', count: platform === 'facebook' ? 284 : 990,
            reason: 'INTENT_TARGET_REACHED', workers: [{ worker: 1, query: 'PRIVATE_WINDOW_QUERY', state: 'STOPPED', reason: 'USER_STOP' }] })),
          opportunity: { campaignId: 'synthetic-ui-fixture', filterMode: 'STANDARD', resultPolicy: 'GLOBAL_FIRST_QUALIFIED', targetCount: 1000, extraCount: 274,
            totalTarget: 1000, threadsShare: .7, counts, byPlatform: { facebook: { ...counts, suitable: 284 }, threads: { ...counts, suitable: 990 } },
            costUsd: .7771, costUpperUsd: .7771, usageUnknown: 0, budgetUsd: 3, phase: 'COMPLETED', lastError: null,
            modelScheduling: { active: 0, concurrency: 2, queued: 0 }, preview: [{ platform: 'threads', rootId: 'example', classification: 'SUITABLE',
              text: 'Mình muốn tìm một lớp tiếng Anh phù hợp cho người đi làm. Mọi người có gợi ý nào không?', link: '', reason: 'Đang hỏi nơi học tiếng Anh.',
              evidence: [], observedAt: '2026-11-03T16:45:00Z', coverage: 'NOT_ATTEMPTED' }] } } };
        ipcMain.removeHandler('csd:state'); ipcMain.handle('csd:state', () => fixture);
        await reload();
        assert.equal(await run("document.body.innerText.includes('PRIVATE_WINDOW_QUERY')"), false);
        assert.equal(await run("document.body.innerText.includes('yêu cầu đang xử lý')"), false);
        assert.match(await run("document.getElementById('opportunity-summary').innerText"), /2.718 bài đã tìm.*464 bài chưa kiểm tra.*\$0.7771 \/ \$3.00.*274/);
        assert.match(await run("document.getElementById('start-help').innerText"), /1.000\/1.000/);
        await run("document.querySelector('.run-panel').scrollIntoView()");
        await new Promise(r => setTimeout(r, 250));
        writeFileSync(join(output, 'results-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        assert.equal(BrowserWindow.getAllWindows().length, 1, 'no cooler window');
        assert.equal(current.spending.calls, 0); assert.equal(networkAttempts, 0);
        assert.deepEqual(errors, []);
        const report = { passed: true, actualMainPreloadRenderer: true, module: entry, appDataIsolated: true, globalSpendIsolated: true,
          defaultFilter: 'OFF', defaultLanguageScope: 'VIETNAMESE', zeroInitialSpend: true, settingsRoundTrip: true, legacyCallCapRemoved: true, offRejectsPlanner: true,
          whiteBackgroundBlackTextOriginalFont: true, technicalControlsHidden: true, newRunDefaultsEnforced: true, savedMoneyLimitsPreserved: true,
          noCooler: true, workerQueriesHidden: true, resultFixtureOnly: true, calls: 0, networkAttempts, rendererErrors: errors };
        writeFileSync(join(output, 'app-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
        clearTimeout(timer); app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
    })(); });
  });
  // Load the exact ASAR module, so every relative preload, renderer, worker and asset uses the candidate package.
  await import(pathToFileURL(entry).href);
}
