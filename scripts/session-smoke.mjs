import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL('../', import.meta.url));
const electron = require('electron');
const flag = process.argv.indexOf('--output');
const output = flag < 0 ? null : resolve(process.argv[flag + 1]);
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshot = screenshotFlag < 0 ? null : resolve(process.argv[screenshotFlag + 1]);
const tempBase = await realpath(tmpdir());
const root = await mkdtemp(join(tempBase, 'csd-bootstrap-'));
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/redirect') { response.writeHead(302, { location: 'https://csd-session.invalid/denied' }); response.end(); return; }
  const seed = ['A', 'B'].includes(url.searchParams.get('seed')) ? url.searchParams.get('seed') : null;
  if (seed) response.setHeader('Set-Cookie', ['persistent_cookie=persistent-' + seed + '; Path=/; Max-Age=3600; SameSite=Lax', 'session_cookie=session-' + seed + '; Path=/; SameSite=Lax']);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>CSD local session fixture</title><h1>Local session fixture</h1><script>
    const seed = ${JSON.stringify(seed)}; if(seed) localStorage.setItem('marker', seed);
    window.fixtureState = () => ({ storage: localStorage.getItem('marker'), cookies: document.cookie });
  </script>`);
});
const phases = [];
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  for (const phase of ['seed', 'logout-crash', 'verify-logout']) {
    await rm(join(root, 'session-result.json'), { force: true });
    const env = { ...process.env, CSD_SESSION_SMOKE_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [workspace, '--csd-session-smoke', '--csd-smoke-root=' + root, '--csd-fixture-origin=' + origin], {
      cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = ''; child.stdout.on('data', () => {}); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    const timer = setTimeout(() => child.kill(), 30000);
    let code;
    try { code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); }); }
    finally { clearTimeout(timer); }
    assert.equal(code, 0, phase + ': ' + stderr);
    const report = JSON.parse(await readFile(join(root, 'session-result.json'), 'utf8'));
    assert.equal(report.phase, phase);
    if (phase !== 'logout-crash') { assert.equal(report.windowsAfterClose, 0); assert.equal(report.webContentsAfterClose, 0); }
    else assert.equal(report.abruptExit, true);
    phases.push(report);
  }
  const report = { task: 'P01.02', date: '2026-10-27', timezone: 'Asia/Bangkok', result: 'PASS',
    electronVersion: require('electron/package.json').version, platform: process.platform, arch: process.arch,
    phaseCount: phases.length, phases,
    limitations: ['Local loopback fixtures only; no Facebook login or collection',
      'Controlled abrupt app.exit with pending 10s test debounce; production debounce is 150ms',
      'Dirty marker covers cookie events delivered to host; not a guarantee against OS power loss or pre-event crashes',
      'Only custom session-cookie backup is OS-encrypted; Chromium profile is not wholly encrypted by CSD'] };
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  if (screenshot) { await mkdir(dirname(screenshot), { recursive: true }); await copyFile(join(root, 'profile-ui.png'), screenshot); }
  console.log(JSON.stringify({ result: 'PASS', phases: phases.length, checks: phases.reduce((sum, p) => sum + p.checks.length, 0), output }, null, 2));
} finally {
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
  const target = resolve(root); assert.ok(dirname(target) === tempBase && basename(target).startsWith('csd-bootstrap-'));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
