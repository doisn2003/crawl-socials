import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
async function main() {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
  const output = option('--output'), screenshot = option('--screenshot');
  assert.ok(output && screenshot, 'VISIBLE_OUTPUT_ARGUMENTS_REQUIRED');
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const electron = createRequire(import.meta.url)('electron');
  const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'csd-visible-'));
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    // The task explicitly requires a visible interactive CSD window. No temp userData/smoke flag.
    const child = spawn(electron, ['.', '--allow-manual-facebook-login', '--csd-visible-startup-root=' + root],
      { cwd: workspace, env, stdio: 'ignore', detached: true, windowsHide: false });
    child.unref();
    let report;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { report = JSON.parse(await readFile(join(root, 'visible-startup.json'), 'utf8')); break; }
      catch { await sleep(100); }
    }
    assert.ok(report, 'VISIBLE_REPORT_TIMEOUT_CLOSE_OLD_CSD_FIRST');
    assert.equal(report.pid, child.pid, 'VISIBLE_REPORT_WRONG_PROCESS');
    assert.equal(report.smoke, false); assert.equal(report.visible, true); assert.equal(report.loading, false);
    assert.equal(report.mainManualLoginEnabled, true); assert.equal(report.dom.manualLoginEnabled, true);
    assert.equal(report.dom.ready, true); assert.equal(report.dom.headingMatches, true); assert.equal(report.dom.profileFormPresent, true);
    assert.equal(report.probeLiveAvailable, false); assert.equal(report.dom.probeLiveAvailable, false);
    assert.equal(report.probeState, 'IDLE'); assert.equal(report.dom.probeActions, 0); assert.equal(report.dom.diagnosticCaptures, 0);
    assert.equal(report.uiDebuggerAttached, false); assert.equal(report.browserOpenViews, 0);
    assert.equal(report.dom.nodeAvailable, false); assert.deepEqual(report.rendererErrors, []);
    assert.ok(report.capture.distinctFromBackground > report.capture.width * report.capture.height * .02);
    await mkdir(dirname(resolve(output)), { recursive: true }); await copyFile(join(root, 'visible-startup.json'), resolve(output));
    await mkdir(dirname(resolve(screenshot)), { recursive: true }); await copyFile(join(root, 'visible-startup.png'), resolve(screenshot));
    console.log(JSON.stringify({ result: 'PASS', pid: child.pid, normalUserData: true, manualLoginEnabled: true,
      probeLiveAvailable: false, observerViews: 0, leftVisibleForNativeInspection: true, output, screenshot }, null, 2));
  } finally {
    const target = resolve(root); assert.ok(dirname(target) === temp && basename(target).startsWith('csd-visible-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
void main().catch(() => { console.error('VISIBLE_STARTUP_CHECK_FAILED'); process.exitCode = 1; });
