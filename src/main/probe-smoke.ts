import assert from 'node:assert/strict';
import { BrowserWindow, session } from 'electron';
import { once } from 'node:events';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserHost } from '../infrastructure/browser/browser-host.js';
import type { ProbeController } from './probe-controller.js';
import { bytesHash, digest } from './probe-contract.js';

export async function runProbeSmoke(input: { probe: ProbeController; browserHost: BrowserHost; mainWindow: BrowserWindow; userData: string; smokeRoot: string }) {
  const { probe, browserHost: host, mainWindow: window } = input;
  let stage = 'PRIOR_RUN';
  try {
  const checks: string[] = [];
  const interrupted = JSON.parse(readFileSync(join(input.smokeRoot, 'probe-interrupted.json'), 'utf8')) as { runId: string };
  const interruptedDirectory = join(input.userData, 'source-probes', interrupted.runId);
  const priorFiles = readdirSync(interruptedDirectory);
  stage = 'PRIOR_MANIFEST'; assert.ok(priorFiles.includes('manifest.json'));
  stage = 'PRIOR_NOT_FINALIZED'; assert.ok(!priorFiles.includes('summary.json'));
  const priorBytes = readFileSync(join(interruptedDirectory, 'manifest.json'));
  stage = 'UI_READY';
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript(`document.documentElement.dataset.ready === 'true'`)) break;
    await sleep(20);
  }
  const profile = await host.create('Local probe fixture'); await host.open(profile.id);
  // Refresh the real UI with the exact existing bridge; only local smoke instrumentation executes JS.
  await window.webContents.executeJavaScript(`window.dispatchEvent(new Event('focus'))`);
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript(`document.getElementById('probe-profile').options.length > 0`)) break;
    await sleep(20);
  }
  const configuration = await window.webContents.executeJavaScript(`window.csd.probe.config()`);
  stage = 'IPC_INPUT';
  assert.equal(configuration.available, true); assert.equal(configuration.liveAvailable, false);
  const rejected = await window.webContents.executeJavaScript(`(async()=>{
    const malformed = [{profileId:${JSON.stringify(profile.id)},approved:true},{profileId:${JSON.stringify(profile.id)},captureMode:'LIVE'},{profileId:${JSON.stringify(profile.id)},url:'https://www.facebook.com/'}];
    const rejected=[]; for(const value of malformed) {try{await window.csd.probe.start(value);rejected.push(false)}catch{rejected.push(true)}}return rejected;
  })()`);
  assert.deepEqual(rejected, [true, true, true]); checks.push('EXACT_IPC_NO_APPROVAL_MODE_URL_OVERRIDE');
  const race = await window.webContents.executeJavaScript(`Promise.allSettled([window.csd.probe.start({profileId:${JSON.stringify(profile.id)}}),window.csd.probe.stop()]).then(values=>values.map(value=>value.status))`);
  assert.deepEqual(race, ['rejected', 'fulfilled']); assert.equal(probe.status().counters.actions, 0);
  checks.push('IPC_STOP_INVALIDATES_PENDING_START_PREFLIGHT');
  stage = 'UI_START';
  await window.webContents.executeJavaScript(`document.getElementById('probe-start').click()`);
  for (let i = 0; i < 100 && probe.status().state === 'IDLE'; i++) await sleep(20);
  assert.notEqual(probe.status().state, 'IDLE');
  assert.throws(() => probe.start(profile.id), /PROBE_ALREADY_RUNNING/);
  const debug = process.argv.includes('--csd-probe-diagnostic') ? setInterval(() => {
    const state = probe.status(); console.log('PROBE_PROGRESS:' + state.state + ':' + state.reason + ':' + state.counters.actions + ':' + state.counters.diagnosticCaptures);
  }, 100) : null;
  let complete;
  try { complete = await probe.wait(); } finally { if (debug) clearInterval(debug); }
  stage = 'COMPLETED_RUN';
  console.log('PROBE_STAGE:COMPLETED_RUN');
  assert.equal(complete.reason, 'COMPLETED_FIXTURE'); assert.equal(complete.counters.actions, 16);
  assert.equal(complete.counters.diagnosticCaptures, 15); assert.deepEqual(complete.counters.batches, [5, 5, 5]);
  assert.equal(complete.counters.candidates, null); assert.equal(complete.verifiedValidUniquePosts, 0);
  checks.push('REAL_UI_START_THREE_QUERIES_FIFTEEN_BATCHES_SIXTEEN_ACTIONS');
  stage = 'FROZEN_FILES';
  console.log('PROBE_STAGE:FROZEN_FILES');
  const directory = join(input.userData, 'source-probes', complete.runId!);
  const json = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
  const manifest = json('manifest.json'), freezeHash = manifest.freeze_sha256; delete manifest.freeze_sha256;
  assert.equal(digest(manifest), freezeHash);
  const snapshot = json('snapshot.json'), snapshotHash = snapshot.snapshot_sha256; delete snapshot.snapshot_sha256;
  assert.equal(digest(snapshot), snapshotHash); assert.equal(snapshot.membership.length, 15);
  for (const entry of json('evidence-map.json').entries) assert.equal(bytesHash(readFileSync(join(directory, entry.file))), entry.sha256);
  const allText = readdirSync(directory).map(name => readFileSync(join(directory, name), 'utf8')).join('\n');
  assert.equal(/synthetic-private|synthetic-cookie|synthetic-auth|synthetic-query-secret/.test(allText), false);
  assert.equal(json('summary.json').parser, 'NOT_IMPLEMENTED');
  assert.equal(json('summary.json').retention_cleanup, 'MANUAL_REQUIRED_NO_SCHEDULER');
  checks.push('FROZEN_HASHES_SAFE_METADATA_UNKNOWN_CANDIDATES_AND_MANUAL_EXPIRY');
  stage = 'STOP_REQUEST';
  console.log('PROBE_STAGE:UI_CAPTURE');
  // Capture UI after the completed run, including the added section.
  await window.webContents.executeJavaScript(`window.dispatchEvent(new Event('focus'));document.getElementById('probe-heading').scrollIntoView({block:'center'})`);
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript(`document.getElementById('probe-status').dataset.state === 'STOPPED'`)) break;
    await sleep(20);
  }
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('probe-status').dataset.state`), 'STOPPED');
  writeFileSync(join(input.smokeRoot, 'probe-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  console.log('PROBE_STAGE:STOP_REQUEST');
  probe.start(profile.id);
  for (let i = 0; i < 100 && probe.status().counters.actions < 2; i++) await sleep(5);
  const stopped = await window.webContents.executeJavaScript(`window.csd.probe.stop()`);
  assert.equal(stopped.reason, 'OPERATOR_STOP'); assert.equal(stopped.state, 'STOPPED');
  assert.equal(host.ownedContents(profile.id)!.debugger.isAttached(), false);
  checks.push('REAL_IPC_STOP_DURING_REQUEST_DETACHES_OBSERVER');
  stage = 'DEVTOOLS';
  probe.start(profile.id);
  for (let i = 0; i < 100 && probe.status().counters.actions < 2; i++) await sleep(5);
  const toolsSession = session.fromPartition('csd-probe-tools');
  toolsSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  toolsSession.setPermissionCheckHandler(() => false);
  toolsSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['devtools:', 'chrome-devtools:', 'about:', 'data:'].includes(new URL(details.url).protocol) }));
  const tools = new BrowserWindow({ show: false, webPreferences: { session: toolsSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let toolsReason: string | null = null, toolsRunId: string | null = null;
  try {
    const wc = host.ownedContents(profile.id)!;
    wc.setDevToolsWebContents(tools.webContents);
    const opened = once(wc, 'devtools-opened'); wc.openDevTools({ mode: 'detach', activate: false });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([opened, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PROBE_CHECK_DEVTOOLS_TIMEOUT')), 3000); })]).finally(() => { if (timer) clearTimeout(timer); });
    const toolsState = await probe.wait(); toolsReason = toolsState.reason; toolsRunId = toolsState.runId;
    assert.equal(toolsReason, 'DEVTOOLS_OPENED'); wc.closeDevTools();
  } finally { tools.destroy(); }
  checks.push('REAL_DEVTOOLS_POLICY_STOPS_CONTROLLER');
  stage = 'COVERAGE';
  console.log('PROBE_STAGE:COVERAGE');
  // Actual uncontrolled navigation is detected even when no input event is generated.
  probe.start(profile.id);
  for (let i = 0; i < 100 && probe.status().counters.actions < 2; i++) await sleep(5);
  void host.ownedContents(profile.id)!.loadURL('about:blank').catch(() => {});
  const coverage = await probe.wait(); assert.equal(coverage.reason, 'COVERAGE_LOST');
  checks.push('UNCONTROLLED_NAVIGATION_STOPS_COVERAGE');
  stage = 'CLOSE';
  console.log('PROBE_STAGE:CLOSE');
  probe.start(profile.id);
  for (let i = 0; i < 100 && probe.status().counters.actions < 2; i++) await sleep(5);
  await host.close(profile.id);
  const closed = await probe.wait(); assert.equal(closed.reason, 'TARGET_CLOSED');
  checks.push('TARGET_CLOSE_STOPS_ACTIONS_AND_CLEANUP');
  assert.equal(bytesHash(readFileSync(join(interruptedDirectory, 'manifest.json'))), bytesHash(priorBytes));
  assert.equal(readdirSync(interruptedDirectory).includes('summary.json'), false);
  assert.notEqual(interrupted.runId, complete.runId);
  checks.push('INTERRUPTED_RUN_UNCHANGED_AND_NEW_RUN_ID_ON_RESTART');
  return { task: 'P02.02_CONTROLLER_FIXTURE', version: 1, result: 'PASS', mode: 'FIXTURE', checks,
    completedRun: { actions: complete.counters.actions, diagnosticCaptures: complete.counters.diagnosticCaptures,
      batches: complete.counters.batches, candidates: null, verifiedValidUniquePosts: 0, persistedBytes: complete.persistedBytes,
      manifestSha256: freezeHash, snapshotSha256: snapshotHash },
    stoppedRunReason: stopped.reason, devToolsRunReason: toolsReason, coverageRunReason: coverage.reason, closeRunReason: closed.reason,
    runIdsUnique: new Set([interrupted.runId, complete.runId, stopped.runId, toolsRunId, coverage.runId, closed.runId]).size === 6,
    interruptedRunLeftUnresumed: true,
    liveAvailable: false, facebookDriver: 'NOT_IMPLEMENTED', parser: 'NOT_IMPLEMENTED', verifiedValidUniquePosts: 0 };
  } catch { throw new Error('PROBE_CHECK_' + stage); }
}
