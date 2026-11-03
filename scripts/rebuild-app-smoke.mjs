// Exercise the real main/preload/renderer together, using isolated data and no model access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const { app } = await import('electron');
  const root = mkdtempSync(join(tmpdir(), 'csd-rebuild-app-')); mkdirSync(output, { recursive: true });
  // Keep the global spending account isolated too. Windows User key may be read but is never transmitted.
  process.env.USERPROFILE = root; app.setPath('appData', root);
  const errors = [], timer = setTimeout(() => { console.error('APP_SMOKE_TIMEOUT'); app.exit(1); }, 25000);
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {}; // Hidden verification window, never changes the user's active app.
    window.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    window.webContents.once('did-finish-load', () => { void (async () => {
      try {
        const run = script => window.webContents.executeJavaScript(script);
        for (let i = 0; i < 100 && await run("document.getElementById('filter-mode').disabled"); i++) await new Promise(r => setTimeout(r, 50));
        const state = await run('window.csd.getState()');
        assert.equal(state.run, null); assert.equal(state.accounts.length, 0); assert.equal(state.spending.calls, 0);
        assert.equal(await run("document.getElementById('filter-mode').value"), '0');
        assert.equal(await run("document.getElementById('spend-total').value"), '0');
        const config = { schemaVersion: 2, keywords: ['piano'], minimumPosts: 3, spendLimits: { totalUsd: 0, dailyUsd: 0, maxCalls: 0 },
          opportunity: { enabled: true, filterMode: 'OFF', prompt: '', brandContext: '', totalTarget: 3, rawCap: 10, budgetUsd: 0, commentsEnabled: false } };
        await run('window.csd.saveConfig(' + JSON.stringify(config) + ')');
        assert.equal((await run('window.csd.getState()')).config.opportunity.filterMode, 'OFF');
        const refusal = await run("window.csd.prepareCampaign().then(()=>null,e=>String(e.message))");
        assert.match(refusal, /OFF_MODEL_CALL_FORBIDDEN/);
        assert.deepEqual(errors, []);
        writeFileSync(join(output, 'main-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        const report = { passed: true, actualMainPreloadRenderer: true, module: entry, appDataIsolated: true, globalSpendIsolated: true,
          defaultFilter: 'OFF', zeroInitialSpend: true, settingsRoundTrip: true, offRejectsPlanner: true, calls: 0, rendererErrors: errors };
        writeFileSync(join(output, 'app-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
        clearTimeout(timer); app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
    })(); });
  });
  // Load the exact ASAR module, so every relative preload, renderer, worker and asset uses the candidate package.
  await import(pathToFileURL(entry).href);
}
