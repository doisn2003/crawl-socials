// Exercises the production Electron IPC/preload with isolated local storage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.versions.electron) {
  const isolated = mkdtempSync(join(tmpdir(), 'csd-project-runtime-'));
  const env = { ...process.env, USERPROFILE: isolated, HOME: isolated,
    CSD_PROJECT_SMOKE_ROOT: isolated, CSD_ENV_FILE: join(isolated, 'absent.env') };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'DATABASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete env[name];
  const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(import.meta.url)],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  const code = await new Promise((done, fail) => { child.on('exit', done); child.on('error', fail); });
  assert.equal(code, 0, output);
  console.log('Production project IPC smoke passed.');
} else {
  const { app } = await import('electron');
  const isolated = process.env.CSD_PROJECT_SMOKE_ROOT;
  assert.ok(isolated?.startsWith(tmpdir()));
  app.setPath('appData', isolated);
  app.disableHardwareAcceleration();
  const legacyData = join(isolated, 'csd-desktop', 'data');
  mkdirSync(legacyData, { recursive: true });
  writeFileSync(join(legacyData, 'user-config.json'), JSON.stringify({
    keywords: ['piano'], minimumPosts: 20, spendLimits: { totalUsd: 7, dailyUsd: 4 },
  }));
  const timeout = setTimeout(() => { console.error('PROJECT_RUNTIME_TIMEOUT'); app.exit(1); }, 45000);
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {};
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`(async () => {
          const initial = await window.csd.projects.state();
          const original = await window.csd.getState();
          const created = await window.csd.projects.create({name:'Second project'});
          const second = await window.csd.getState();
          second.config.keywords = ['guitar'];
          second.config.spendLimits = { totalUsd: 5, dailyUsd: 2 };
          await window.csd.saveConfig(second.config);
          await window.csd.projects.select({id: initial.activeProjectId});
          const restored = await window.csd.getState();
          await window.csd.projects.select({id: created.activeProjectId});
          const persisted = await window.csd.getState();
          await window.csd.projects.update({id:created.activeProjectId,name:'Renamed project'});
          const renamed = await window.csd.projects.state();
          await window.csd.projects.remove({id:created.activeProjectId});
          const removed = await window.csd.projects.state();
          let denied = false;
          try { await window.csd.projects.select({id:'../other'}); } catch { denied = true; }
          return {initial, original:original.config.keywords, restored:restored.config.keywords,
            persisted:persisted.config.keywords, initialLimits:original.config.spendLimits,
            secondLimits:second.spending, restoredLimits:restored.config.spendLimits,
            restoredSpending:restored.spending, renamed, removed, denied};
        })()`);
        assert.deepEqual(result.original, ['piano']);
        assert.deepEqual(result.restored, ['piano']);
        assert.deepEqual(result.persisted, ['guitar']);
        assert.deepEqual(result.initialLimits, { totalUsd: 7, dailyUsd: 4 });
        assert.equal(result.secondLimits.remainingUsd, 7);
        assert.equal(result.secondLimits.dailyRemainingUsd, 4);
        assert.deepEqual(result.restoredLimits, { totalUsd: 5, dailyUsd: 2 });
        assert.equal(result.restoredSpending.remainingUsd, 5);
        assert.equal(result.restoredSpending.dailyRemainingUsd, 2);
        assert.equal(result.restoredSpending.calls, 0);
        assert.ok(result.renamed.projects.some(project => project.name === 'Renamed project'));
        assert.equal(result.removed.projects.length, 1);
        assert.equal(result.removed.activeProjectId, result.initial.activeProjectId);
        assert.equal(result.denied, true);
        clearTimeout(timeout);
        app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  await import(pathToFileURL(resolve('dist/main/index.js')).href);
}
