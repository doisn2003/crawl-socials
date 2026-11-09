// Real packaged main + preload + renderer, isolated AppData and spending, no inference.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const entry = resolve(option('module', 'release/win-unpacked/resources/app.asar/dist/main/index.js'));
const output = resolve(option('out', 'artifacts/demo-incident-20261109/packaged-smoke'));
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url), '--module=' + entry, '--out=' + output],
    { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, logs); console.log(logs.trim());
} else {
  const { app, BrowserWindow } = await import('electron');
  const isolated = mkdtempSync(join(tmpdir(), 'csd-v2-packaged-')); mkdirSync(output, { recursive: true });
  app.setPath('appData', isolated); process.env.USERPROFILE = isolated;
  process.env.CSD_ENV_FILE = join(isolated, 'absent.env');
  for (const key of ['DATABASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete process.env[key];
  app.getVersion = () => JSON.parse(readFileSync(resolve(dirname(entry), '../../package.json'), 'utf8')).version;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw Error('LIVE_NETWORK_FORBIDDEN'); };
  const errors = [], timer = setTimeout(() => { console.error('PACKAGED_SMOKE_TIMEOUT'); app.exit(1); }, 45000);
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {}; window.webContents.setBackgroundThrottling(false);
    window.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    window.webContents.on('render-process-gone', (_event, d) => errors.push('RENDERER_GONE:' + d.reason));
    window.webContents.once('did-finish-load', () => { void (async () => {
      try {
        const run = script => window.webContents.executeJavaScript(script);
        for (let i = 0; i < 100 && await run("document.getElementById('filter-mode').disabled"); i++) await new Promise(r => setTimeout(r, 50));
        assert.equal(await run("document.getElementById('filter-mode').disabled"), false);
        assert.equal(await run("document.title"), 'TrendLink');
        assert.equal(await run("document.querySelector('.brand-mark').naturalWidth > 0"), true);
        const initial = await run('window.csd.getState()');
        assert.equal(initial.run, null); assert.equal(initial.accounts.length, 0); assert.equal(initial.spending.calls, 0);
        assert.equal(initial.version, '0.4.0-rebuild.5.4');
        assert.equal(await run("document.getElementById('filter-mode').value"), '25');
        assert.equal(await run("document.getElementById('raw-cap').value"), '5000');
        assert.equal(await run("document.getElementById('spend-total').value"), '30');
        assert.equal(await run("document.getElementById('spend-daily').value"), '6');
        assert.match(await run("document.querySelector('.session-note').textContent"), /TrendLink luôn giữ phiên đăng nhập/);
        for (const [i, mode] of ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY'].entries()) {
          const config = { schemaVersion: 2, keywords: ['cafe'], minimumPosts: 20, performance: 'BALANCED', filterPercent: [0, 25, 60, 100][i],
            spendLimits: { totalUsd: 7, dailyUsd: 4 }, opportunity: { enabled: true, filterMode: mode, prompt: 'Tìm quán cafe yên tĩnh', brandContext: '',
              totalTarget: 20, rawCap: 5000, budgetUsd: mode === 'OFF' ? 0 : 3, commentsEnabled: false, languageScope: 'VIETNAMESE' } };
          await run('window.csd.saveConfig(' + JSON.stringify(config) + ')');
          const saved = await run('window.csd.getState()');
          assert.equal(saved.config.opportunity.filterMode, mode); assert.deepEqual(saved.config.spendLimits, { totalUsd: 7, dailyUsd: 4 });
          assert.equal(saved.spending.remainingUsd, 7); assert.equal(saved.spending.dailyRemainingUsd, 4);
          if (mode === 'OFF') assert.match(await run("window.csd.prepareCampaign().then(()=>'',e=>String(e.message))"), /OFF_MODEL_CALL_FORBIDDEN/);
        }
        const state = await run('window.csd.getState()');
        assert.equal(state.spending.calls, 0); assert.equal(networkAttempts, 0); assert.deepEqual(errors, []);
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        const report = { passed: true, version: state.version, actualMainPreloadRenderer: true, module: entry,
          isolatedAppData: isolated, isolatedSpending: true, fourModeSettingsRoundTrip: true, explicitLimitsPreserved: true,
          offCallsForbidden: true, liveModelCalls: 0, networkAttempts, rendererErrors: errors };
        writeFileSync(join(output, 'packaged-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
        clearTimeout(timer); app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
    })(); });
  });
  await import(pathToFileURL(entry).href);
}
