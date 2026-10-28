import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
async function main() {
  const index = process.argv.indexOf('--output'), output = index < 0 ? null : resolve(process.argv[index + 1]);
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const electron = createRequire(import.meta.url)('electron');
  const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'csd-bootstrap-'));
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('cache-control', 'no-store');
    if (path === '/ok.js') { response.setHeader('content-type', 'application/javascript'); response.end('void 0'); return; }
    if (path === '/status') { response.writeHead(503); response.end('fixture'); return; }
    if (path === '/abort') { response.destroy(); return; }
    if (path === '/slow') { response.setHeader('content-type', 'text/html'); response.write('<!doctype html><p>Slow fixture'); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><title>Local metadata fixture</title><h1>Fixture</h1>
      <script src="/ok.js?token=synthetic-private-not-for-log"></script>
      <script src="https://connect.facebook.net/fixture.js?token=synthetic-private-not-for-log"></script>
      <script>window.runFixtures=async()=>{await fetch('/status?token=synthetic-private-not-for-log');
      await fetch('/abort?token=synthetic-private-not-for-log').catch(()=>{});
      window.open('https://www.facebook.com/two_step_verification/?token=synthetic-private-not-for-log');};</script>`);
  });
  try {
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [workspace, '--csd-policy-smoke', '--csd-smoke-root=' + root, '--csd-fixture-origin=' + origin],
      { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let codes = ''; child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/)) if (/^CSD_STARTUP_FAILED:[A-Z_]+$/.test(line)) codes += line + '\n'; });
    const timeout = setTimeout(() => child.kill(), 35000);
    try { const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
      if (code !== 0) console.error(codes.trim() || 'POLICY_ELECTRON_FAILED'); assert.equal(code, 0); }
    finally { clearTimeout(timeout); }
    const text = await readFile(join(root, 'policy-diagnostics-result.json'), 'utf8');
    assert.equal(text.includes('synthetic-private'), false);
    const report = JSON.parse(text); assert.equal(report.result, 'PASS'); assert.equal(report.windowsAfterClose, 0); assert.equal(report.webContentsAfterClose, 0);
    if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify({ result: report.result, checks: report.checks.length, mode: report.mode, postsCollected: 0, output }, null, 2));
  } finally {
    server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
    const target = resolve(root); assert.ok(dirname(target) === temp && basename(target).startsWith('csd-bootstrap-'));
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
void main().catch(() => { console.error('POLICY_DIAGNOSTICS_FIXTURE_FAILED'); process.exitCode = 1; });
