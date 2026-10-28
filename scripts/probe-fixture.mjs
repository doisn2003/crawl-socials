import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
async function main() {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
  const output = option('--output') ? resolve(option('--output')) : null;
  const screenshot = option('--screenshot') ? resolve(option('--screenshot')) : null;
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const electron = createRequire(import.meta.url)('electron');
  const timers = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/page') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>CSD probe fixture</title><h1>Local fixture</h1>'); return; }
    if (url.pathname !== '/capture') { response.writeHead(404); response.end(); return; }
    response.setHeader('content-type', 'application/json'); response.setHeader('set-cookie', 'diagnostic=synthetic-cookie; Path=/');
    const timer = setTimeout(() => { timers.delete(timer); response.end(JSON.stringify({ token: 'synthetic-private',
      authorization: 'synthetic-auth', url: 'https://invalid.example/?token=synthetic-query-secret',
      unexpected: { personal_text: 'synthetic-private' }, payload: { query: url.searchParams.get('q'), batch: url.searchParams.get('batch') } })); }, 100);
    timers.add(timer);
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const tempBase = await realpath(tmpdir()), root = await mkdtemp(join(tempBase, 'csd-bootstrap-'));
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const launch = async interrupted => {
      const child = spawn(electron, [workspace, '--csd-probe-smoke', '--csd-smoke-root=' + root, '--csd-fixture-origin=' + origin,
        ...(interrupted ? ['--csd-probe-interrupt'] : []), ...(process.argv.includes('--diagnostic') ? ['--csd-probe-diagnostic'] : [])], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let diagnostics = '';
      child.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
      child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
      const timer = setTimeout(() => child.kill(), 30000);
      const exited = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
      if (interrupted) {
        let marker = false;
        for (let i = 0; i < 500; i++) { try { await readFile(join(root, 'probe-interrupted.json')); marker = true; break; } catch { await sleep(10); } }
        assert.ok(marker, 'PROBE_INTERRUPT_MARKER_MISSING'); child.kill();
      }
      try { const code = await exited;
        if (interrupted) return;
        if (code !== 0) { const codes = diagnostics.match(/(?:CSD_STARTUP_FAILED|PROBE_CHECK_FAILED):[A-Z_0-9:]+/g); console.error(codes?.join('\n') || 'PROBE_ELECTRON_FAILED_CODE_' + code);
          if (process.argv.includes('--diagnostic')) console.error(diagnostics.split('\n').filter(line => /^PROBE_(?:PROGRESS|STAGE):[A-Z_a-z0-9:]+$/.test(line.trim())).join('\n')); }
        assert.equal(code, 0, 'PROBE_ELECTRON_FAILED'); }
      finally { clearTimeout(timer); }
    };
    await launch(true); await launch(false);
    const report = JSON.parse(await readFile(join(root, 'probe-result.json'), 'utf8'));
    assert.equal(report.result, 'PASS'); assert.equal(report.mode, 'FIXTURE'); assert.equal(report.liveAvailable, false);
    assert.equal(report.windowsAfterClose, 0); assert.equal(report.webContentsAfterClose, 0); assert.equal(report.runIdsUnique, true);
    assert.equal(report.interruptedRunLeftUnresumed, true);
    if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
    if (screenshot) { await mkdir(dirname(screenshot), { recursive: true }); await copyFile(join(root, 'probe-ui.png'), screenshot); }
    console.log(JSON.stringify({ result: report.result, mode: report.mode, checks: report.checks.length,
      launches: 2, diagnosticCaptures: report.completedRun.diagnosticCaptures, verifiedValidUniquePosts: 0, output, screenshot }, null, 2));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
    const target = resolve(root); assert.ok(dirname(target) === tempBase && basename(target).startsWith('csd-bootstrap-'));
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
void main().catch(() => { console.error('PROBE_FIXTURE_FAILED'); process.exitCode = 1; });
