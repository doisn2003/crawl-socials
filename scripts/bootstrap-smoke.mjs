import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL('../', import.meta.url));
const electron = require('electron');
assert.ok(resolve(electron).startsWith(resolve(workspace, 'node_modules') + '\\'), 'Use CSD-owned Electron binary');
const outputArg = process.argv.indexOf('--output');
const output = outputArg < 0 ? null : resolve(process.argv[outputArg + 1]);
const screenshotArg = process.argv.indexOf('--screenshot');
const screenshot = screenshotArg < 0 ? null : resolve(process.argv[screenshotArg + 1]);
const tempBase = await realpath(tmpdir());
const root = await mkdtemp(join(tempBase, 'csd-bootstrap-'));
const fakeHotMatch = join(root, 'hotmatch-desktop');
await mkdir(fakeHotMatch);
const sentinel = join(fakeHotMatch, 'synthetic-sentinel.txt');
const sentinelBody = 'Synthetic unrelated app data; must remain unchanged.\n';
await writeFile(sentinel, sentinelBody);
const runs = [];
try {
  for (let run = 1; run <= 2; run++) {
    await rm(join(root, 'smoke-result.json'), { force: true });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = performance.now();
    const child = spawn(electron, [workspace, '--csd-smoke', '--csd-smoke-root=' + root], {
      cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    const timer = setTimeout(() => child.kill(), 25000);
    let code;
    try { code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); }); }
    finally { clearTimeout(timer); }
    assert.equal(code, 0, 'Electron failed: ' + stderr);
    const report = JSON.parse(await readFile(join(root, 'smoke-result.json'), 'utf8'));
    assert.equal(report.appId, 'io.csd.desktop');
    assert.equal(report.appName, 'CSD');
    assert.equal(report.appRoot.toLowerCase(), resolve(workspace).toLowerCase());
    assert.equal(report.electronExecutable.toLowerCase(), resolve(electron).toLowerCase());
    assert.equal(report.initial.info.product, 'CSD');
    assert.equal(report.initial.info.benchmarkReady, false);
    assert.equal(report.initial.nodeAvailable, false);
    assert.equal(report.initial.processAvailable, false);
    assert.deepEqual(report.initial.bridgeKeys, ['getInfo', 'probe', 'profiles', 'runOfflineCheck']);
    assert.equal(report.offlineCheckPassed, true);
    assert.deepEqual(report.configuredWebPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
    assert.equal(report.dataPathsIsolated, true);
    assert.equal(report.uiPartition, 'csd-ui');
    assert.equal(report.networkBlocked, true);
    assert.equal(report.blockedExternalRequests, 1);
    assert.equal(report.windowsAfterClose, 0);
    assert.equal(report.webContentsAfterClose, 0);
    assert.deepEqual(report.rendererErrors, []);
    assert.equal(report.captureMode, 'FIXTURE');
    assert.equal(report.verifiedValidUniquePosts, 0);
    assert.equal(await readFile(sentinel, 'utf8'), sentinelBody);
    // Remove machine paths from the saved evidence.
    delete report.appRoot; delete report.electronExecutable;
    runs.push({ run, elapsedMilliseconds: Math.round(performance.now() - started), ...report });
  }
  const summary = { task: 'P01.01', date: '2026-10-27', timezone: 'Asia/Bangkok', result: 'PASS',
    launches: runs.length, sameIsolatedDataRootOnRestart: true, ownElectronBinary: true,
    unrelatedSyntheticSentinelUnchanged: true, runs,
    limitations: ['Offline bootstrap only', 'No real HotMatch userData inspected',
      'No Facebook session, live source, collection throughput or packaged executable tested'] };
  if (screenshot) { await mkdir(dirname(screenshot), { recursive: true }); await copyFile(join(root, 'offline-ui.png'), screenshot); }
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(summary, null, 2) + '\n'); }
  console.log(JSON.stringify({ result: 'PASS', launches: runs.length, checks: 'UI, IPC, offline fixture, blocked remote request, shutdown/relaunch, data isolation', screenshot, output }, null, 2));
} finally {
  const target = resolve(root);
  assert.ok(dirname(target) === tempBase && basename(target).startsWith('csd-bootstrap-'));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
