import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import type { ObserverEvent, ObserverRead, ResponseObserver } from '../src/application/ports/response-observer.js';
import { createProbeController } from '../src/main/probe-controller.js';
import type { ProbeDriver, ProbeDriverSession, ProbeExtractor } from '../src/main/probe-controller.js';
import { createProbeWriter } from '../src/main/probe-writer.js';
import { bytesHash, digest, PROBE_LIMITS, sanitizeProbeCapture } from '../src/main/probe-contract.js';
import type { ProbeReason } from '../src/main/probe-contract.js';
import { parseProbeCommand } from '../src/main/probe-ipc-policy.js';
const profileId = 'csd-11111111-1111-4111-8111-111111111111';
const runId = 'probe-11111111-1111-4111-8111-111111111111';
type Limits = Parameters<typeof createProbeController>[0]['limits'];
async function fixture(work: (ctx: ReturnType<typeof setup>) => Promise<void> | void,
  options: { limits?: Limits; extractor?: ProbeExtractor; disabled?: boolean; sinkFailure?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'csd-probe-unit-'));
  try { await work(setup(root, options)); }
  finally { assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'csd-probe-unit-'))); rmSync(root, { recursive: true, force: true }); }
}
function setup(root: string, options: { limits?: Limits; extractor?: ProbeExtractor; disabled?: boolean; sinkFailure?: boolean }) {
  const userData = join(root, 'user-data'), workspace = join(root, 'workspace'); mkdirSync(userData); mkdirSync(workspace);
  let wall = Date.now(), mono = 0, segment = 0, actions = 0, released = 0, reads = 0;
  let queued: ObserverRead[] = [], lost: (reason: ProbeReason) => void = () => {};
  let next: (() => ObserverRead) | null = null;
  let observerState: 'ATTACHED' | 'STOPPED' = 'ATTACHED';
  let onAction: ((type: string) => void | Promise<void>) | null = null;
  const body = (extra: Record<string, unknown> = {}): ObserverEvent => ({ owner: { profileId, webContentsId: 1, viewGeneration: 1 },
    captureGeneration: segment, captureMode: 'FIXTURE', observedAt: new Date(wall).toISOString(), kind: 'BODY',
    requestKey: 1, method: 'GET', status: 200, mimeType: 'application/json', responseOrigin: 'NETWORK',
    body: Buffer.from('{"token":"synthetic-private","text":"synthetic-private","unknown":{"cookie":"synthetic-private"}}'), ...extra } as ObserverEvent);
  const driver: ProbeDriver = { acquire(_id, callback) {
    lost = callback;
    const session: ProbeDriverSession = {
      async beginSegment() {
        segment++; queued = [];
        const handle: ResponseObserver = { owner: { profileId, webContentsId: 1, viewGeneration: 1 },
          read: async () => { reads++; return queued.shift() || { kind: 'TIMEOUT' }; },
          snapshot: () => ({ state: observerState, captureGeneration: segment, pendingRequests: 0, activeReads: 0, queuedResults: queued.length,
            bufferedBytes: 0, capturedResponses: 0, totalCapturedBytes: 0, filtered: {}, dropped: {}, rawCommandsInFlight: 0 }),
          suspend: () => {}, resume: async () => {}, stop: () => { queued = []; } };
        return handle;
      },
      async action(type) { actions++; await onAction?.(type); if (type === 'FETCH_FIXTURE_BATCH') queued.push(next ? next() : { kind: 'EVENT', event: body() }); },
      release() { released++; },
    }; return session;
  } };
  const controller = createProbeController({ driver: options.disabled ? null : driver,
    freeze: () => ({ versions: { fixture: 'v1' }, buildInputs: { version: 1, entries: [] }, evidence: [], campaign: { fixture: true } }),
    writer: (runId, maxBytes) => { const writer = createProbeWriter({ userData, workspace, runId, maxBytes, now: () => wall });
      if (options.sinkFailure) writer.observe = () => { throw new Error('PROBE_STORAGE_LIMIT'); }; return writer; },
    clock: { wall: () => wall, mono: () => mono }, ...(options.limits ? { limits: options.limits } : {}),
    ...(options.extractor ? { extractor: options.extractor } : {}) });
  return { controller, userData, workspace, root, body, get actions() { return actions; }, get released() { return released; }, get reads() { return reads; },
    advance(ms: number) { wall += ms; mono += ms; }, wallOnly(ms: number) { wall += ms; },
    setNext: (fn: () => ObserverRead) => { next = fn; }, setAction: (fn: (type: string) => void | Promise<void>) => { onAction = fn; },
    failAttach: () => { observerState = 'STOPPED'; },
    lose: (reason: ProbeReason) => lost(reason),
    report(name: string) { return JSON.parse(readFileSync(join(userData, 'source-probes', controller.status().runId!, name), 'utf8')); },
  };
}
test('fixture budgets, sanitized output, frozen manifest/snapshot/map hashes and expiry are coherent', () => fixture(async ctx => {
  const start = ctx.controller.start(profileId); const end = await ctx.controller.wait();
  assert.equal(end.reason, 'COMPLETED_FIXTURE'); assert.equal(ctx.actions, 16);
  assert.deepEqual(end.counters.batches, [5, 5, 5]); assert.equal(end.counters.diagnosticCaptures, 15);
  assert.equal(end.counters.candidates, null); assert.equal(end.verifiedValidUniquePosts, 0); assert.equal(ctx.released, 1);
  const manifest = ctx.report('manifest.json'), hash = manifest.freeze_sha256; delete manifest.freeze_sha256;
  assert.equal(digest(manifest), hash); assert.equal(Date.parse(start.deadlineAt!) - Date.parse(start.startedAt!), 1800000);
  const snapshot = ctx.report('snapshot.json'), snapshotHash = snapshot.snapshot_sha256; delete snapshot.snapshot_sha256;
  assert.equal(digest(snapshot), snapshotHash); assert.equal(snapshot.membership.length, 15);
  const directory = join(ctx.userData, 'source-probes', end.runId!);
  for (const member of snapshot.membership) {
    const record = JSON.parse(readFileSync(join(directory, member.file), 'utf8').trim().split('\n')[member.line - 1]!);
    assert.equal(digest(record), member.sha256); assert.ok(Date.parse(member.observed_at) <= Date.parse(member.persisted_at));
  }
  for (const entry of ctx.report('evidence-map.json').entries) assert.equal(bytesHash(readFileSync(join(directory, entry.file))), entry.sha256);
  const all = readdirSync(directory).map(name => readFileSync(join(directory, name), 'utf8')).join('\n');
  assert.equal(all.includes('synthetic-private'), false); assert.equal(all.includes('"body":'), false);
  assert.equal(readdirSync(directory).reduce((sum, name) => sum + statSync(join(directory, name)).size, 0), end.persistedBytes);
  assert.equal(ctx.report('summary.json').facebook_driver, 'NOT_IMPLEMENTED');
  assert.equal(ctx.report('summary.json').retention_cleanup, 'MANUAL_REQUIRED_NO_SCHEDULER');
}));
test('duplicate Start, immediate Stop and stop races cannot collect or resurrect a run', () => fixture(async ctx => {
  const started = ctx.controller.start(profileId); assert.throws(() => ctx.controller.start(profileId), /ALREADY_RUNNING/);
  await Promise.all([ctx.controller.stop(), ctx.controller.stop()]); assert.equal(ctx.actions, 0);
  const first = ctx.controller.status(); assert.equal(first.reason, 'OPERATOR_STOP'); assert.equal(first.runId, started.runId);
  const second = ctx.controller.start(profileId); assert.notEqual(second.runId, first.runId); await ctx.controller.stop();
}));
test('outer deadline includes all segments and action waits; cutoff rejects late body', () => fixture(async ctx => {
  ctx.setAction(() => ctx.advance(10));
  const start = ctx.controller.start(profileId); const end = await ctx.controller.wait();
  assert.equal(end.reason, 'DEADLINE_REACHED'); assert.equal(end.deadlineAt, start.deadlineAt);
  assert.equal(ctx.actions, 3); assert.equal(end.counters.diagnosticCaptures, 1); assert.equal(end.counters.segments, 2);
  assert.equal(ctx.report('snapshot.json').membership.length, 1);
}, { limits: { wallMs: 25 } }));
test('clock regression and wall/monotonic drift stop instead of resetting the deadline', async () => {
  for (const ms of [-1, 3000]) await fixture(async ctx => {
    ctx.setAction(() => ctx.wallOnly(ms)); ctx.controller.start(profileId);
    assert.equal((await ctx.controller.wait()).reason, 'CLOCK_UNCERTAIN'); assert.equal(ctx.actions, 1);
  });
});
test('controlled action cap is checked before action; per-query batch cap persists across windows', async () => {
  await fixture(async ctx => { ctx.controller.start(profileId); const end = await ctx.controller.wait();
    assert.equal(end.reason, 'ACTION_LIMIT'); assert.equal(ctx.actions, 3); assert.equal(end.counters.actions, 3);
  }, { limits: { actions: 3 } });
  await fixture(async ctx => { ctx.controller.start(profileId); const end = await ctx.controller.wait();
    assert.deepEqual(end.counters.batches, [2, 2, 2]); assert.equal(ctx.actions, 7);
  }, { limits: { batchesPerQuery: 2 } });
});
test('candidate cap uses the explicit extractor seam and never counts BODY as candidate', () => fixture(async ctx => {
  ctx.controller.start(profileId); const end = await ctx.controller.wait();
  assert.equal(end.reason, 'CANDIDATE_LIMIT'); assert.equal(end.counters.candidates, 60);
  assert.equal(end.counters.diagnosticCaptures, 1); assert.equal(ctx.actions, 3);
}, { extractor: { inspect: () => ({ candidateCount: 60, continuation: 'ADVANCED' }) } }));
test('no-progress needs explicit repeated continuation evidence, unknown never implies source end', async () => {
  await fixture(async ctx => { ctx.controller.start(profileId); assert.equal((await ctx.controller.wait()).reason, 'NO_PROGRESS'); assert.equal(ctx.actions, 3); },
    { extractor: { inspect: () => ({ candidateCount: 0, continuation: 'REPEATED' }) } });
  await fixture(async ctx => { ctx.controller.start(profileId); assert.equal((await ctx.controller.wait()).reason, 'COMPLETED_FIXTURE'); },
    { extractor: { inspect: () => ({ candidateCount: 0, continuation: 'UNKNOWN' }) } });
});
test('one retry per batch consumes total actions and timeout is not source exhaustion', () => fixture(async ctx => {
  ctx.setNext(() => ({ kind: 'TIMEOUT' })); ctx.controller.start(profileId);
  const end = await ctx.controller.wait(); assert.equal(end.reason, 'READ_TIMEOUT'); assert.equal(end.counters.retries, 1);
  assert.equal(ctx.actions, 3); assert.equal(end.counters.diagnosticCaptures, 0);
}));
test('malformed metadata and forbidden capture mode stop with zero stored observations', async () => {
  for (const extra of [{ status: NaN }, { captureMode: 'LIVE' }, { observedAt: 'synthetic-private' }]) await fixture(async ctx => {
    ctx.setNext(() => ({ kind: 'EVENT', event: ctx.body(extra) })); ctx.controller.start(profileId);
    const end = await ctx.controller.wait(); assert.ok(['SCHEMA_FAILURE', 'COVERAGE_LOST'].includes(end.reason!));
    assert.equal(ctx.report('snapshot.json').membership.length, 0);
  });
});
test('auth and access denied statuses stop; trusted challenge/DevTools/close/suspend invalidate all new actions', async () => {
  for (const [status, reason] of [[401, 'AUTH_REQUIRED'], [403, 'ACCESS_DENIED']] as const) await fixture(async ctx => {
    ctx.setNext(() => ({ kind: 'EVENT', event: ctx.body({ status }) })); ctx.controller.start(profileId);
    assert.equal((await ctx.controller.wait()).reason, reason); assert.equal(ctx.actions, 2);
  });
  for (const reason of ['CHALLENGE', 'DEVTOOLS_OPENED', 'TARGET_CLOSED', 'SUSPENDED', 'COVERAGE_LOST'] as const) await fixture(async ctx => {
    ctx.setAction(() => ctx.lose(reason)); ctx.controller.start(profileId);
    assert.equal((await ctx.controller.wait()).reason, reason); assert.equal(ctx.actions, 1);
  });
});
test('Stop cancels a hanging driver await and a late promise cannot write', () => fixture(async ctx => {
  let release!: () => void;
  ctx.setAction(() => new Promise<void>(resolve => { release = resolve; })); ctx.controller.start(profileId); await tick();
  const stopped = await ctx.controller.stop(); assert.equal(stopped.reason, 'OPERATOR_STOP');
  const bytes = stopped.persistedBytes; release(); await tick();
  assert.equal(ctx.controller.status().persistedBytes, bytes); assert.equal(ctx.report('snapshot.json').membership.length, 0);
}));
test('operator time is union-accounted and exhausts through pause/wait without resetting run', () => fixture(async ctx => {
  let release!: () => void;
  ctx.setAction(() => new Promise<void>(resolve => { release = resolve; })); ctx.controller.start(profileId); await tick();
  ctx.controller.operator(true); ctx.controller.operator(true); ctx.advance(10);
  assert.equal(ctx.controller.status().reason, 'OPERATOR_LIMIT'); await ctx.controller.wait(); release();
  assert.equal(ctx.controller.status().counters.operatorMs, 10);
}, { limits: { operatorMs: 10 } }));
test('storage cap rejects before mutation and reserves snapshot/summary bytes', () => fixture(ctx => {
  const writer = createProbeWriter({ userData: ctx.userData, workspace: ctx.workspace, runId,
    maxBytes: 2 * 1024 * 1024, now: Date.now });
  assert.throws(() => writer.initialize({ fixture: true }, { text: 'x'.repeat(2 * 1024 * 1024) }), /STORAGE_LIMIT/);
  assert.equal(writer.bytes(), 0); assert.deepEqual(readdirSync(writer.directory), []);
  writer.initialize({ fixture: true }, {});
  writer.finalize({ cutoff: Date.now(), stoppedAt: Date.now(), summary: { test: true } });
  assert.ok(writer.bytes() < 2 * 1024 * 1024);
  assert.throws(() => writer.ledger({ event: 'SEGMENT', at: new Date().toISOString(), elapsed_ms: 0 }), /WRITE_CLOSED/);
}));
test('storage exhaustion stops controller and still freezes safe output within reserved budget', () => fixture(async ctx => {
  ctx.controller.start(profileId); const end = await ctx.controller.wait();
  assert.equal(end.reason, 'STORAGE_LIMIT'); assert.equal(ctx.actions, 2);
  assert.equal(ctx.report('snapshot.json').membership.length, 0); assert.equal(ctx.report('summary.json').stop_reason, 'STORAGE_LIMIT');
}, { sinkFailure: true }));
test('failed observer attach prevents the next collection action', () => fixture(async ctx => {
  ctx.failAttach(); ctx.controller.start(profileId);
  assert.equal((await ctx.controller.wait()).reason, 'OBSERVER_ERROR'); assert.equal(ctx.actions, 1);
}));
test('writer excludes writes that cross deadline and refuses run directory reuse after interruption', () => fixture(ctx => {
  let now = Date.now(); const start = now;
  const writer = createProbeWriter({ userData: ctx.userData, workspace: ctx.workspace, runId, maxBytes: PROBE_LIMITS.storageBytes,
    now: () => { const result = now; now += 2; return result; } });
  writer.initialize({}, {}); const diagnostic = sanitizeProbeCapture(ctx.body())!;
  assert.equal(writer.observe(diagnostic, { runId, startedAt: start - 100, deadlineAt: start + 1, query: 0, batch: 1, segment: 1 }), false);
  writer.finalize({ cutoff: start + 1, stoppedAt: now, summary: {} });
  const snapshot = JSON.parse(readFileSync(join(writer.directory, 'snapshot.json'), 'utf8')); assert.equal(snapshot.membership.length, 0);
  assert.throws(() => createProbeWriter({ userData: ctx.userData, workspace: ctx.workspace, runId, maxBytes: PROBE_LIMITS.storageBytes, now: Date.now }));
}));
test('writer rejects repo storage, symlink roots and redirected existing output', () => fixture(ctx => {
  assert.throws(() => createProbeWriter({ userData: ctx.workspace, workspace: ctx.workspace, runId, maxBytes: PROBE_LIMITS.storageBytes, now: Date.now }), /ROOT_DENIED/);
  const external = join(ctx.root, 'external'); mkdirSync(external);
  symlinkSync(external, join(ctx.userData, 'source-probes'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createProbeWriter({ userData: ctx.userData, workspace: ctx.workspace, runId, maxBytes: PROBE_LIMITS.storageBytes, now: Date.now }), /PATH_DENIED/);
}));
test('IPC exact shapes disallow live booleans, URL, run ID/resume, budgets and arbitrary methods', () => {
  assert.deepEqual(parseProbeCommand('start', [{ profileId }]), { action: 'start', profileId });
  for (const action of ['config', 'status', 'stop']) assert.deepEqual(parseProbeCommand(action, []), { action });
  for (const payload of [{ profileId, approved: true }, { profileId, captureMode: 'LIVE' }, { profileId, url: 'https://facebook.com' },
    { profileId, runId }, { profileId, limits: {} }, [], null]) assert.throws(() => parseProbeCommand('start', [payload]), /INPUT_INVALID/);
  assert.throws(() => parseProbeCommand('resume', [{ runId }]), /INPUT_INVALID/);
  assert.throws(() => parseProbeCommand('status', [{}]), /INPUT_INVALID/);
});
test('ordinary app keeps live unavailable and refuses Start before allocating a run', () => fixture(ctx => {
  assert.equal(ctx.controller.config().available, false); assert.equal(ctx.controller.config().liveAvailable, false);
  assert.throws(() => ctx.controller.start(profileId), /LIVE_UNAVAILABLE/); assert.equal(ctx.actions, 0); assert.equal(ctx.controller.status().runId, null);
}, { disabled: true }));
