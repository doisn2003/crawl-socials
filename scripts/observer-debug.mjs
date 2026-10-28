import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
async function main() {
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const output = option('--output') ? resolve(option('--output')) : null;
const mode = option('--mode') || 'fixture';
const scenario = option('--scenario') || 'query';
assert.ok(['fixture', 'replay'].includes(mode) && ['query', 'all'].includes(scenario), 'OBSERVER_DEBUG_ARGUMENTS_INVALID');
async function deliver(report) {
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ mode: report.mode, result: report.result, captures: report.captures.length, checks: report.checks?.length || 0,
    errors: report.errors || [], verifiedValidUniquePosts: report.verifiedValidUniquePosts, output }, null, 2));
}
if (mode === 'replay') {
  const file = resolve(option('--fixture') || 'tests/fixtures/observer/replay.json');
  assert.ok((await stat(file)).size <= 2 * 1024 * 1024, 'REPLAY_FILE_TOO_LARGE');
  const text = await readFile(file); assert.ok(text.length <= 2 * 1024 * 1024, 'REPLAY_FILE_TOO_LARGE');
  const { runObserverReplay } = await import('../dist/infrastructure/browser/replay-fixture.js');
  const report = await runObserverReplay(JSON.parse(text.toString('utf8')));
  await deliver(report); assert.equal(report.result, 'CAPTURED', 'OBSERVER_REPLAY_INCOMPLETE');
} else {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const require = createRequire(import.meta.url), electron = require('electron');
  const timers = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/page') {
      response.setHeader('content-type', 'text/html; charset=utf-8'); response.setHeader('cache-control', 'no-store');
      response.end(`<!doctype html><title>CSD observer fixture</title><h1>Local observer fixture</h1><script>
        window.queryFixture = name => fetch('/capture?case='+encodeURIComponent(name)+'&token=synthetic-not-exported',
          { method: name === 'post' ? 'POST' : 'GET', cache:'no-store', ...(name === 'post' ? {body:'synthetic'} : {}) })
          .then(response=>response.arrayBuffer()).then(()=>true,()=>false);
      </script>`); return;
    }
    if (url.pathname !== '/capture') { response.writeHead(404); response.end(); return; }
    const kind = url.searchParams.get('case'); response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', kind === 'binary' ? 'application/octet-stream' : kind === 'empty' ? 'text/plain' : 'application/json; charset=utf-8');
    response.setHeader('set-cookie', 'fixture_only=synthetic; Path=/');
    if (kind === 'empty') { response.statusCode = 200; response.end(''); return; }
    if (kind === 'binary') { response.end(Buffer.from([0, 255, 128, 1, 2])); return; }
    if (kind === 'huge') { response.end('x'.repeat(256 * 1024)); return; }
    if (kind === 'http-error') { response.statusCode = 403; response.end('{"error":"synthetic-denied"}'); return; }
    if (kind === 'slow' || kind === 'abort') {
      response.write('{"pending":');
      const timer = setTimeout(() => { timers.delete(timer); if (kind === 'abort') response.destroy(); else response.end('true}'); }, kind === 'abort' ? 20 : 10000);
      timers.add(timer); return;
    }
    response.end(JSON.stringify({ fixture: 'cà phê', method: request.method }));
  });
  const tempBase = await realpath(tmpdir()), root = await mkdtemp(join(tempBase, 'csd-bootstrap-'));
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const args = [workspace, '--csd-observer-smoke', '--csd-smoke-root=' + root,
      '--csd-fixture-origin=http://127.0.0.1:' + address.port, ...(scenario === 'query' ? ['--csd-observer-query'] : [])];
    const child = spawn(electron, args, { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errorCodes = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { for (const line of chunk.toString().split(/\r?\n/)) if (/^(OBSERVER_[A-Z_]+|CSD_STARTUP_FAILED:[A-Z_]+)$/.test(line.trim())) errorCodes += line.trim() + '\n'; });
    const timer = setTimeout(() => child.kill(), 30000);
    let code; try { code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); }); }
    finally { clearTimeout(timer); }
    assert.equal(code, 0, 'OBSERVER_FIXTURE_FAILED\n' + errorCodes);
    const report = JSON.parse(await readFile(join(root, 'observer-result.json'), 'utf8'));
    assert.equal(report.windowsAfterClose, 0); assert.equal(report.webContentsAfterClose, 0);
    assert.equal(report.verifiedValidUniquePosts, 0); assert.ok(report.captures.every(capture => capture.captureMode === 'FIXTURE'));
    await deliver(report);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
    const target = resolve(root); assert.ok(dirname(target) === tempBase && basename(target).startsWith('csd-bootstrap-'));
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
}
void main().catch(error => {
  if (error instanceof Error && error.message.startsWith('OBSERVER_FIXTURE_FAILED\n')) {
    for (const line of error.message.split('\n')) if (/^(OBSERVER_[A-Z_]+|CSD_STARTUP_FAILED:[A-Z_]+)$/.test(line)) console.error(line);
  }
  console.error('OBSERVER_DEBUG_FAILED'); process.exitCode = 1;
});
