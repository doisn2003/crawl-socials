// Real Electron windows, isolated temporary profile, localhost fixtures only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || 'artifacts/parallel-crawl-20261103/windows');
await mkdir(output, { recursive: true });
if (!process.versions.electron) {
  const require = createRequire(import.meta.url), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url), output], { cwd: workspace, env, windowsHide: true, stdio: 'inherit' });
  process.exitCode = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)); });
} else { void (async () => {
  const { app, session } = await import('electron');
  app.on('window-all-closed', () => {});
  const watchdog = setTimeout(() => { console.error('WINDOW_SMOKE_TIMEOUT'); app.exit(1); }, 30_000);
  const temporaryBase = await realpath(tmpdir()), temporary = await mkdtemp(join(temporaryBase, 'csd-parallel-window-'));
  app.setPath('userData', join(temporary, 'user-data')); app.setPath('sessionData', join(temporary, 'sessions'));
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  const server = createServer((request, response) => {
    if (request.url.startsWith('/slow')) { setTimeout(() => response.end('ready'), 120); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>CSD parallel fixture</title><body>Independent keyword page ' + request.url + '</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let host;
  try {
    await app.whenReady();
    const { createBrowserHost } = await import('../dist/infrastructure/browser/browser-host.js');
    const { createBrowserProfiles } = await import('../dist/infrastructure/browser/profile-repository.js');
    const { createOwnedObserverResolver } = await import('../dist/infrastructure/browser/electron-observer-target.js');
    const profiles = createBrowserProfiles(join(temporary, 'profiles')), secrets = new Map();
    host = createBrowserHost({ profiles, secrets: { async get(k) { return secrets.get(k) ?? null; }, async set(k, v) { secrets.set(k, v); }, async delete(k) { secrets.delete(k); } },
      journalDirectory: join(temporary, 'journal'), manualLoginEnabled: false, fixtureOrigin: origin, hidden: true, backgroundThrottling: false,
      sessionForPartition: partition => session.fromPartition('memory-' + partition) });
    const profile = await profiles.create('Parallel fixture', 'threads'), other = await profiles.create('Isolated account', 'threads');
    const a = host.forWorker('threads-1'), b = host.forWorker('threads-2');
    await Promise.all([a.open(profile.id), b.open(profile.id)]);
    const ta = a.observerTarget(profile.id), tb = b.observerTarget(profile.id);
    assert.ok(ta && tb); assert.notEqual(ta.webContentsId, tb.webContentsId); assert.notEqual(ta.viewGeneration, tb.viewGeneration);
    assert.equal(ta.contents.session, tb.contents.session);
    await Promise.all([ta.contents.loadURL(origin + '/keyword-a'), tb.contents.loadURL(origin + '/keyword-b')]);
    assert.ok((await ta.contents.executeJavaScript('document.body.innerText')).includes('keyword-a'));
    assert.ok((await tb.contents.executeJavaScript('document.body.innerText')).includes('keyword-b'));
    await ta.contents.session.cookies.set({ url: origin, name: 'fixture-session', value: 'synthetic', path: '/' });
    assert.equal((await tb.contents.session.cookies.get({ name: 'fixture-session' }))[0].value, 'synthetic');
    await host.open(other.id);
    assert.equal((await host.ownedSession(other.id).cookies.get({ name: 'fixture-session' })).length, 0);
    assert.equal(createOwnedObserverResolver(a)(tb), null);
    assert.ok(createOwnedObserverResolver(a)(ta));
    const pending = tb.contents.executeJavaScript("fetch('/slow').then(r=>r.text())");
    await a.close(profile.id); assert.equal(await pending, 'ready');
    assert.equal(ta.contents.isDestroyed(), true); assert.equal(tb.contents.isDestroyed(), false);
    assert.equal(createOwnedObserverResolver(a)(ta), null);
    assert.equal(host.diagnostics().openViews, 2);
    await a.open(profile.id); const reopened = a.observerTarget(profile.id); assert.notEqual(reopened.viewGeneration, ta.viewGeneration);
    await a.close(profile.id); await b.close(profile.id); await host.close(other.id);
    const { sampleResources } = await import('../dist/application/window-scheduler.js');
    const baseline = { system: sampleResources(), processes: app.getAppMetrics() };
    const facebook = await profiles.create('Facebook query fixture', 'facebook');
    const started = performance.now(), queryWindows = [];
    for (let i = 0; i < 12; i++) for (const account of [profile, facebook]) {
      const worker = host.forWorker(account.platform + '-query-' + i);
      await worker.open(account.id); const target = worker.observerTarget(account.id);
      await target.contents.loadURL(origin + '/' + account.platform + '/query-' + i);
      queryWindows.push({ worker, account, target, query: 'query-' + i });
    }
    assert.equal(host.diagnostics().openViews, 24);
    assert.equal(new Set(queryWindows.map(row => row.target.webContentsId)).size, 24);
    const probes = [];
    for (const row of queryWindows) {
      const at = performance.now(), body = await row.target.contents.executeJavaScript('document.body.innerText');
      assert.ok(body.includes(row.query)); probes.push(performance.now() - at);
    }
    const processes = app.getAppMetrics(), resourceProfile = { windows: 24, loadMs: performance.now() - started, baseline,
      system: sampleResources(), processes, rendererWorkingSetMiB: processes.filter(p => p.type === 'Tab').reduce((n, p) => n + p.memory.workingSetSize / 1024, 0),
      responseMs: { average: probes.reduce((n, v) => n + v, 0) / probes.length, maximum: Math.max(...probes) },
      scope: '24 actual Electron host windows with localhost text fixtures; not Facebook/Threads page memory or capacity.' };
    await host.shutdown(); assert.equal(tb.contents.isDestroyed(), true); assert.equal(reopened.contents.isDestroyed(), true);
    assert.equal(host.diagnostics().openViews, 0);
    const result = { passed: true, checks: ['two real Electron windows navigate independently', 'shared login session per profile',
      'different profiles isolated', 'observer cannot claim sibling window', 'closing one window preserves sibling inflight request',
      'reopened window invalidates old ownership', '24 query windows (12 per platform) own distinct webContents',
      'shutdown closes all webContents and flushes session'], network: 'LOCALHOST_ONLY', appData: 'ISOLATED_TEMPORARY', resourceProfile };
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await host?.shutdown().catch(() => {}); await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(temporary), temporaryBase); assert.ok(basename(temporary).startsWith('csd-parallel-window-'));
    // Release Chromium handles before cleanup; the OS temp root may retain locked cache files.
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    clearTimeout(watchdog); app.exit(process.exitCode ?? 0);
  }
})().catch(error => { console.error(error); process.exit(1); }); }
