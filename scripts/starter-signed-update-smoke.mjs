import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import asar from '@electron/asar';
import { inspectStarterFeed, verifyHostedStarterFeed } from './starter-release-feed.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw Error('SIGNED_UPDATE_SMOKE_REQUIRES_DISPOSABLE_WINDOWS_RUNNER');
}

const { APPDATA, RUNNER_TEMP, FINDLINK_TEST_TLS_PFX, FINDLINK_TEST_TLS_PASSWORD, npm_execpath } = process.env;
assert.ok(APPDATA && RUNNER_TEMP && FINDLINK_TEST_TLS_PFX && FINDLINK_TEST_TLS_PASSWORD && npm_execpath);
const appData = join(APPDATA, 'csd-desktop');
assert.equal(existsSync(appData), false, 'Expected a clean FindLink profile');
const installDir = mkdtempSync(join(RUNNER_TEMP, 'findlink-signed-'));
const executable = join(installDir, 'FindLink.exe');
const from = '0.0.1', to = '0.0.2';
const feedRoot = resolve('release', 'starter-feed');
const files = new Map();
const leasePublicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
let checks = 0, downloads = 0;
const server = createServer({ pfx: readFileSync(FINDLINK_TEST_TLS_PFX), passphrase: FINDLINK_TEST_TLS_PASSWORD }, (req, res) => {
  const pathname = new URL(req.url, 'https://localhost').pathname;
  if (pathname === '/v1/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ protocol: 1, leasePublicKey }));
    return;
  }
  const file = files.get(pathname);
  if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
  if (pathname.endsWith('/latest.yml')) checks++;
  if (pathname.endsWith('.exe')) downloads++;
  const size = statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || (req.headers.range && !range)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
  res.writeHead(range ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

async function waitFor(probe, code, timeout = 90_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await delay(500);
  }
  throw Error(code);
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target);
  const signal = AbortSignal.timeout(5000);
  try {
    await once(socket, 'open', { signal });
    const response = once(socket, 'message', { signal });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    const [{ data }] = await response;
    const reply = JSON.parse(data);
    if (reply.error || reply.result?.exceptionDetails) throw Error('SIGNED_UPDATE_RENDERER_EVALUATION_FAILED');
    return reply.result?.result?.value;
  } finally { socket.close(); }
}

async function launchApp() {
  const probe = createTcpServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolveClose => probe.close(resolveClose));
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { windowsHide: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {});
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    const pages = await response.json();
    return pages.find(page => page.type === 'page' && page.url.startsWith('file:') && page.url.endsWith('/renderer/index.html'))?.webSocketDebuggerUrl;
  }, 'SIGNED_UPDATE_APP_NOT_READY');
  return { child, run: expression => evaluate(target, expression) };
}

function installedVersion() {
  return JSON.parse(asar.extractFile(join(installDir, 'resources', 'app.asar'), 'package.json').toString('utf8')).version;
}

function updatedAppWindow(initialPid, close = false) {
  const script = `
    $window = Get-Process -Name FindLink -ErrorAction SilentlyContinue | Where-Object {
      $_.Id -ne [int]$env:FINDLINK_TEST_PRIOR_PID -and $_.Path -eq $env:FINDLINK_TEST_EXE -and $_.MainWindowHandle -ne 0
    } | Select-Object -First 1
    if ($window) {
      ${close ? 'if (!$window.CloseMainWindow()) { exit 1 }' : ''}
      [Console]::Write($window.Id)
    }`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 6000, windowsHide: true,
    env: { ...process.env, FINDLINK_TEST_PRIOR_PID: String(initialPid), FINDLINK_TEST_EXE: executable },
  }));
}

const hash = value => createHash('sha256').update(value).digest('hex');
const runId = 'crawl-' + randomUUID(), profileId = 'csd-' + randomUUID();
const dataDir = join(appData, 'data'), outputDirectory = join(dataDir, 'collections', runId);
const results = JSON.stringify({ facebook: [{ post_id: 'signed-update-fixture', text: 'Bài đã lưu trước khi cập nhật.' }], threads: [] });
const children = [];
let phase = 'build';
try {
  server.listen(0, 'localhost');
  await once(server, 'listening');
  const origin = `https://localhost:${server.address().port}`;
  const feed = origin + '/downloads/windows/';
  for (const version of [from, to]) {
    execFileSync(process.execPath, [npm_execpath, 'run', 'dist:starter'], { windowsHide: true, stdio: 'inherit',
      env: { ...process.env, FINDLINK_PUBLIC_URL: origin, FINDLINK_UPDATE_URL: feed, FINDLINK_LEASE_PUBLIC_KEY: leasePublicKey,
        FINDLINK_STARTER_VERSION: version } });
    const directory = join(feedRoot, version);
    const metadata = await inspectStarterFeed(directory, version);
    for (const name of [metadata.filename, metadata.blockmapName]) files.set('/downloads/windows/' + name, join(directory, name));
  }
  files.set('/downloads/windows/latest.yml', join(feedRoot, to, 'latest.yml'));
  phase = 'hosted feed';
  await verifyHostedStarterFeed(feed, await inspectStarterFeed(join(feedRoot, to), to));
  checks = downloads = 0;

  phase = 'initial install';
  execFileSync(join(feedRoot, from, `FindLink-Starter-${from}-Setup.exe`), ['/S', '/D=' + installDir],
    { windowsVerbatimArguments: true, windowsHide: true, timeout: 120_000 });
  assert.equal(installedVersion(), from);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, 'results.json'), results);
  const now = new Date().toISOString();
  writeFileSync(join(dataDir, 'latest-run.json'), JSON.stringify({ id: runId, state: 'STOPPED', startedAt: now, finishedAt: now,
    minimumPosts: 1, keywords: ['cà phê'], outputDirectory, platforms: [{ platform: 'facebook', profileId, state: 'STOPPED', count: 1, reason: 'USER_STOP' }], preview: [] }));

  async function verifySavedRun(app, version) {
    const state = await waitFor(() => app.run('window.csd?.getState()'), 'SIGNED_UPDATE_STATE_UNAVAILABLE');
    assert.equal(state.managed, true);
    assert.equal(state.version, version);
    assert.equal(state.run.id, runId);
    assert.equal(state.run.resultsOnly, true);
    assert.equal(hash(readFileSync(join(state.run.outputDirectory, 'results.json'))), hash(results));
  }

  const original = await launchApp();
  children.push(original.child);
  await verifySavedRun(original, from);
  phase = 'update download';
  await original.run("document.getElementById('managed-service-open').click()");
  await waitFor(() => original.run("!document.getElementById('managed-update').hidden && !document.getElementById('managed-update').disabled"),
    'SIGNED_UPDATE_BUTTON_NOT_READY', 150_000);
  assert.ok(checks > 0 && downloads > 0);
  assert.equal(await original.run("document.getElementById('managed-update').click(); true"), true);
  phase = 'update install';
  await waitFor(async () => installedVersion() === to, 'SIGNED_UPDATE_INSTALL_DID_NOT_FINISH', 120_000);
  phase = 'updated app restart';
  await waitFor(async () => updatedAppWindow(original.child.pid), 'SIGNED_UPDATE_APP_DID_NOT_RESTART');
  const restartedPid = updatedAppWindow(original.child.pid, true);
  assert.ok(restartedPid);
  await waitFor(async () => {
    try { process.kill(restartedPid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  }, 'SIGNED_UPDATE_APP_DID_NOT_CLOSE');
  const updated = await launchApp();
  children.push(updated.child);
  await verifySavedRun(updated, to);
  console.log('STARTER_SIGNED_UPDATE_SMOKE_PASSED HTTPS, verified installer, app restart, preserved results');
} catch (error) {
  console.error('STARTER_SIGNED_UPDATE_SMOKE_FAILED', { phase, checks, downloads });
  throw error;
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
