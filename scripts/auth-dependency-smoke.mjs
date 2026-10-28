import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
async function main() {
  const index = process.argv.indexOf('--output'), output = index < 0 ? null : resolve(process.argv[index + 1]);
  const workspace = fileURLToPath(new URL('../', import.meta.url)), electron = createRequire(import.meta.url)('electron');
  const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'csd-bootstrap-'));
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [workspace, '--csd-auth-dependency-smoke', '--allow-manual-facebook-login', '--csd-smoke-root=' + root],
      { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let codes = ''; child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/)) if (/^CSD_STARTUP_FAILED:[A-Z_]+$/.test(line)) codes += line; });
    const timer = setTimeout(() => child.kill(), 25000);
    try { const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
      if (code !== 0) console.error(codes || 'AUTH_FIXTURE_PROCESS_FAILED'); assert.equal(code, 0); }
    finally { clearTimeout(timer); }
    const report = JSON.parse(await readFile(join(root, 'auth-dependency-result.json'), 'utf8'));
    assert.equal(report.result, 'PASS'); assert.equal(report.windowsAfterClose, 0); assert.equal(report.webContentsAfterClose, 0);
    if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify({ result: report.result, checks: report.checks.length, mode: 'FIXTURE', externalNetworkRequests: 0, output }, null, 2));
  } finally {
    const target = resolve(root); assert.ok(dirname(target) === temp && basename(target).startsWith('csd-bootstrap-'));
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
void main().catch(() => { console.error('AUTH_DEPENDENCY_FIXTURE_FAILED'); process.exitCode = 1; });
