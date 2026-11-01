import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pinStoragePolicy, measureStorageUsage, evaluateStoragePressure, DEFAULT_STORAGE_LIMITS } from '../src/application/storage-backpressure.js';
import type { StorageUsage } from '../src/application/storage-backpressure.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import type { ConversationObservation, EvaluationContext } from '../src/domain/conversation.js';

const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
const temp = () => mkdtempSync(join(tmpdir(), 'csd-storage-pressure-'));
const context: EvaluationContext = { campaign_id: 'storage-fixture', campaign_version: '1', filter_version: 'test' };
const observation: ConversationObservation = { platform: 'threads', entity_type: 'POST', entity_id: 'post-1', root_post_id: 'post-1', parent_id: null,
  text: 'Thảo luận về đàn piano, chỗ học gần nhà và học phí 🎹', observed_at: '2026-10-31T03:00:00Z', provenance: { run_id: 'storage-fixture', method: 'TEST_FIXTURE' } };

test('storage policy is pinned once; resume retains limits and migration marker rather than resetting or applying new defaults', () => {
  const dir = temp();
  try {
    const first = pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: true, now: new Date('2026-10-31T00:00:00Z') });
    const bytes = readFileSync(join(dir, 'storage-policy.json'), 'utf8');
    assert.equal(first.backfilled_on_resume, true); assert.deepEqual(first.limits, DEFAULT_STORAGE_LIMITS);
    const resumed = pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: false,
      limits: { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes } });
    assert.deepEqual(resumed, first); assert.equal(readFileSync(join(dir, 'storage-policy.json'), 'utf8'), bytes);
    assert.throws(() => pinStoragePolicy({ directory: dir, campaignSha256: otherHash, existingRun: true }), /STORAGE_POLICY_CAMPAIGN_MISMATCH/);
    assert.equal(readFileSync(join(dir, 'storage-policy.json'), 'utf8'), bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt or partially written pins fail closed without repair; unverifiable legacy locks are preserved', () => {
  const dir = temp();
  try {
    const lock = join(dir, '.storage-policy.lock'); writeFileSync(lock, 'other owner');
    assert.throws(() => pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: false }), /STORAGE_POLICY_LEGACY_LOCK/);
    assert.equal(readFileSync(lock, 'utf8'), 'other owner'); assert.equal(existsSync(join(dir, 'storage-policy.json')), false);
    const file = join(dir, 'storage-policy.json'); writeFileSync(file, '{partial');
    assert.throws(() => pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: true }), /STORAGE_POLICY_INVALID/);
    assert.equal(readFileSync(file, 'utf8'), '{partial');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function launchPinCreator(directory: string, mode: 'before' | 'after' | 'race', id: string, maxRunBytes: number) {
  const script = join(directory, `creator-${id}.mjs`), marker = join(directory, `ready-${id}`), gate = join(directory, 'publish-go');
  writeFileSync(script, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config = JSON.parse(process.argv[2]);
const original = fs.linkSync;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
fs.linkSync = (source, target) => {
  if (config.mode === 'after') original(source, target);
  fs.writeFileSync(config.marker, 'ready');
  if (config.mode === 'race') {
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(config.gate)) { if (Date.now() > deadline) throw Error('TEST_GATE_TIMEOUT'); Atomics.wait(sleeper, 0, 0, 10); }
    return original(source, target);
  }
  Atomics.wait(sleeper, 0, 0);
};
syncBuiltinESMExports();
const { pinStoragePolicy, DEFAULT_STORAGE_LIMITS } = await import(config.module);
try {
  const result = pinStoragePolicy({ directory: config.directory, campaignSha256: config.hash, existingRun: false,
    limits: { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: config.maxRunBytes }, now: new Date('2026-10-31T00:00:00Z') });
  process.stdout.write(JSON.stringify(result));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
`);
  const child = spawn(process.execPath, [script, JSON.stringify({ directory, marker, gate, mode, maxRunBytes, hash,
    module: new URL('../src/application/storage-backpressure.js', import.meta.url).href })], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', finished = false;
  child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { finished = true; resolve({ code, signal, stdout, stderr }); });
  });
  return { child, marker, gate, completion, isFinished: () => finished, errors: () => stderr };
}

async function waitForCreator(creator: ReturnType<typeof launchPinCreator>): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!existsSync(creator.marker)) {
    if (creator.isFinished()) throw Error('Pin creator exited before publication boundary: ' + creator.errors());
    if (Date.now() >= deadline) throw Error('Pin creator did not reach publication boundary');
    await sleep(10);
  }
}

test('terminated pin writer before publish leaves only an orphan temp; resume can create a complete pin', async () => {
  const dir = temp(), creator = launchPinCreator(dir, 'before', 'crash', 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes);
  try {
    await waitForCreator(creator);
    assert.equal(existsSync(join(dir, 'storage-policy.json')), false);
    assert.equal(readdirSync(dir).filter(name => name.startsWith('.storage-policy-') && name.endsWith('.tmp')).length, 1);
    creator.child.kill('SIGKILL'); await creator.completion;
    assert.equal(existsSync(join(dir, '.storage-policy.lock')), false);
    const pin = pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: true });
    assert.equal(pin.limits.max_run_bytes, DEFAULT_STORAGE_LIMITS.max_run_bytes); assert.equal(pin.backfilled_on_resume, true);
    assert.equal(JSON.parse(readFileSync(join(dir, 'storage-policy.json'), 'utf8')).policy_sha256, pin.policy_sha256);
    assert.equal(readdirSync(dir).filter(name => name.startsWith('.storage-policy-') && name.endsWith('.tmp')).length, 1, 'another dead writer temp is retained, not adopted or deleted');
  } finally { if (!creator.isFinished()) creator.child.kill('SIGKILL'); await creator.completion; rmSync(dir, { recursive: true, force: true }); }
});

test('terminated writer after atomic publication preserves the winning policy and its bytes on resume', async () => {
  const dir = temp(), creator = launchPinCreator(dir, 'after', 'published', 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes);
  try {
    await waitForCreator(creator); const bytes = readFileSync(join(dir, 'storage-policy.json'), 'utf8');
    creator.child.kill('SIGKILL'); await creator.completion;
    const saved = JSON.parse(bytes); assert.equal(saved.limits.max_run_bytes, 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes);
    writeFileSync(join(dir, '.storage-policy.lock'), '', 'utf8');
    const resumed = pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: true });
    assert.equal(resumed.policy_sha256, saved.policy_sha256); assert.equal(resumed.limits.max_run_bytes, saved.limits.max_run_bytes);
    assert.equal(readFileSync(join(dir, 'storage-policy.json'), 'utf8'), bytes, 'installed defaults and legacy orphan lock cannot replace a valid pin');
  } finally { if (!creator.isFinished()) creator.child.kill('SIGKILL'); await creator.completion; rmSync(dir, { recursive: true, force: true }); }
});

test('simultaneous creators publish exactly one complete policy without overwriting the winner', async () => {
  const dir = temp(), creators = [launchPinCreator(dir, 'race', 'a', DEFAULT_STORAGE_LIMITS.max_run_bytes), launchPinCreator(dir, 'race', 'b', 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes)];
  try {
    await Promise.all(creators.map(waitForCreator));
    assert.equal(readdirSync(dir).filter(name => name.startsWith('.storage-policy-') && name.endsWith('.tmp')).length, 2);
    writeFileSync(creators[0]!.gate, 'go');
    const results = await Promise.all(creators.map(creator => creator.completion));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const pins = results.map(result => JSON.parse(result.stdout));
    assert.equal(pins[0].policy_sha256, pins[1].policy_sha256);
    const saved = JSON.parse(readFileSync(join(dir, 'storage-policy.json'), 'utf8'));
    assert.deepEqual(pins[0], saved); assert.deepEqual(pins[1], saved);
    assert.ok([DEFAULT_STORAGE_LIMITS.max_run_bytes, 2 * DEFAULT_STORAGE_LIMITS.max_run_bytes].includes(saved.limits.max_run_bytes));
    assert.equal(readdirSync(dir).filter(name => name.startsWith('.storage-policy-') && name.endsWith('.tmp')).length, 0);
    assert.equal(existsSync(join(dir, '.storage-policy.lock')), false);
  } finally {
    for (const creator of creators) if (!creator.isFinished()) creator.child.kill('SIGKILL');
    await Promise.all(creators.map(creator => creator.completion)); rmSync(dir, { recursive: true, force: true });
  }
});

test('unsupported atomic hardlink publication fails explicitly and never falls back to replace or partial final writes', t => {
  const dir = temp();
  try {
    t.mock.method(fs, 'linkSync', () => { throw Object.assign(Error('filesystem lacks hardlink publication'), { code: 'ENOTSUP' }); }); syncBuiltinESMExports();
    assert.throws(() => pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: false }), /STORAGE_POLICY_ATOMIC_PUBLISH_UNSUPPORTED/);
    assert.equal(existsSync(join(dir, 'storage-policy.json')), false); assert.equal(existsSync(join(dir, '.storage-policy.lock')), false);
    assert.equal(readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0);
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.doesNotThrow(() => pinStoragePolicy({ directory: dir, campaignSha256: hash, existingRun: false }));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

test('whole-run disk measurement includes raw, DB/WAL, cache and large nested files without mutating source bytes', async () => {
  const dir = temp();
  try {
    mkdirSync(join(dir, 'opportunity', 'store'), { recursive: true }); mkdirSync(join(dir, 'facebook'), { recursive: true });
    const raw = Buffer.from('nội dung thô 🎹\n'), large = Buffer.alloc(8 * 1024 * 1024, 97);
    writeFileSync(join(dir, 'facebook', 'posts.jsonl'), raw); writeFileSync(join(dir, 'opportunity', 'store', 'conversations.sqlite-wal'), large);
    writeFileSync(join(dir, 'opportunity', 'cache.json'), '{}');
    const usage = await measureStorageUsage({ directory: dir, pendingBytes: 53, limits: DEFAULT_STORAGE_LIMITS, now: new Date('2026-10-31T00:00:00Z') });
    assert.equal(usage.run_bytes, raw.length + large.length + 2); assert.equal(usage.files, 3); assert.equal(usage.entries, 6);
    assert.equal(usage.pending_bytes, 53); assert.equal(usage.measured_at, '2026-10-31T00:00:00.000Z');
    assert.ok(Number.isSafeInteger(usage.free_bytes) && usage.free_bytes > 0);
    assert.deepEqual(readFileSync(join(dir, 'facebook', 'posts.jsonl')), raw);
    assert.deepEqual(readFileSync(join(dir, 'opportunity', 'store', 'conversations.sqlite-wal')), large);
    writeFileSync(join(dir, 'newly-admitted-batch.jsonl'), 'observed');
    const next = await measureStorageUsage({ directory: dir, pendingBytes: 0, limits: DEFAULT_STORAGE_LIMITS });
    assert.equal(next.run_bytes, usage.run_bytes + 8); assert.equal(next.pending_bytes, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bounded scans and external junctions stop rather than silently undercounting or traversing unrelated data', async () => {
  const dir = temp(), outside = temp();
  try {
    writeFileSync(join(dir, 'one'), '1'); writeFileSync(join(dir, 'two'), '22');
    await assert.rejects(measureStorageUsage({ directory: dir, pendingBytes: 0, limits: { ...DEFAULT_STORAGE_LIMITS, max_scan_entries: 1 } }), /STORAGE_SCAN_LIMIT/);
    mkdirSync(join(dir, 'deep', 'deeper'), { recursive: true });
    await assert.rejects(measureStorageUsage({ directory: dir, pendingBytes: 0, limits: { ...DEFAULT_STORAGE_LIMITS, max_scan_depth: 1 } }), /STORAGE_SCAN_LIMIT/);
    writeFileSync(join(outside, 'untouched'), 'outside');
    symlinkSync(outside, join(dir, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(measureStorageUsage({ directory: dir, pendingBytes: 0, limits: DEFAULT_STORAGE_LIMITS }), /STORAGE_LINK_NOT_ALLOWED/);
    assert.equal(readFileSync(join(outside, 'untouched'), 'utf8'), 'outside');
    await assert.rejects(measureStorageUsage({ directory: join(dir, 'missing'), pendingBytes: 0, limits: DEFAULT_STORAGE_LIMITS }), /STORAGE_MEASUREMENT_FAILED/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('a just-renamed temporary file causes a complete bounded rescan; persistent instability stops instead of undercounting', async t => {
  const dir = temp(), file = join(dir, 'changing.json'), original = fs.promises.lstat;
  try {
    writeFileSync(file, '1234567'); let injected = 0, persistent = false;
    const replacement = (async (...args: unknown[]) => {
      if (args[0] === file && (persistent || injected++ === 0)) throw Object.assign(Error('simulated atomic rename window'), { code: 'ENOENT' });
      return Reflect.apply(original, fs.promises, args);
    }) as typeof fs.promises.lstat;
    t.mock.method(fs.promises, 'lstat', replacement); syncBuiltinESMExports();
    const stable = await measureStorageUsage({ directory: dir, pendingBytes: 0, limits: DEFAULT_STORAGE_LIMITS });
    assert.equal(stable.run_bytes, 7); assert.equal(stable.files, 1); assert.ok(injected >= 2);
    persistent = true;
    await assert.rejects(measureStorageUsage({ directory: dir, pendingBytes: 0, limits: DEFAULT_STORAGE_LIMITS }), /STORAGE_SCAN_UNSTABLE/);
    assert.equal(readFileSync(file, 'utf8'), '1234567');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

test('admission reserves space, distinguishes disk/run stops from drainable backlog, and recovers after queue drain', () => {
  const limits = { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: 1000, in_flight_reserve_bytes: 100, min_free_bytes: 500, max_pending_bytes: 200 };
  const usage: StorageUsage = { run_bytes: 899, free_bytes: 601, pending_bytes: 200, files: 0, entries: 0, measured_at: '2026-10-31T00:00:00Z' };
  assert.deepEqual(evaluateStoragePressure(limits, usage), { state: 'READY', reason: null });
  assert.deepEqual(evaluateStoragePressure(limits, { ...usage, run_bytes: 900 }), { state: 'STOP', reason: 'STORAGE_RUN_BYTES_REACHED' });
  assert.deepEqual(evaluateStoragePressure(limits, { ...usage, free_bytes: 600 }), { state: 'STOP', reason: 'STORAGE_DISK_RESERVE_REACHED' });
  assert.deepEqual(evaluateStoragePressure(limits, { ...usage, pending_bytes: 201 }), { state: 'BACKLOG', reason: 'STORAGE_BACKLOG_BYTES_REACHED' });
  assert.deepEqual(evaluateStoragePressure(limits, { ...usage, pending_bytes: 0 }), { state: 'READY', reason: null });
  assert.throws(() => evaluateStoragePressure(limits, { ...usage, free_bytes: -1 }), /STORAGE_USAGE_INVALID/);
});

test('backlog bytes count UTF-8 snapshots once across CLASSIFY/VERIFY, isolate context and shrink after successful work', () => {
  const dir = temp(), store = createConversationStore(dir);
  try {
    const saved = store.ingest(observation, context), snapshot = saved.snapshot!;
    const verify = store.enqueue({ type: 'VERIFY', idempotency_key: 'same-snapshot-verify', payload: { ...context, snapshot_id: snapshot.id, note: 'đối chiếu' } });
    store.enqueue({ type: 'CLASSIFY', idempotency_key: 'other-context', payload: { ...context, filter_version: 'other', snapshot_id: snapshot.id } });
    store.enqueue({ type: 'REVISIT', idempotency_key: 'browser-job', payload: { ...context, snapshot_id: snapshot.id } });
    const expectedSnapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
    assert.ok(expectedSnapshotBytes > JSON.stringify(snapshot).length);
    const full = store.backlogBytes(context), classify = store.backlogBytes(context, { includeVerification: false });
    assert.equal(full.jobs, 2); assert.equal(classify.jobs, 1);
    assert.equal(full.snapshot_bytes, expectedSnapshotBytes); assert.equal(classify.snapshot_bytes, expectedSnapshotBytes);
    assert.equal(full.payload_bytes, Buffer.byteLength(JSON.stringify(saved.job!.payload)) + Buffer.byteLength(JSON.stringify(verify.payload)));
    assert.equal(full.total_bytes, full.payload_bytes + full.snapshot_bytes); assert.equal(full.missing_snapshots, 0);
    let job = store.claim('inference', { types: ['CLASSIFY'], context })!; store.complete(job.id, job.lease_token!);
    assert.equal(store.backlogBytes(context).jobs, 1); assert.equal(store.backlogBytes(context).snapshot_bytes, expectedSnapshotBytes);
    job = store.claim('verification', { types: ['VERIFY'], context })!; store.complete(job.id, job.lease_token!);
    assert.deepEqual(store.backlogBytes(context), { jobs: 0, payload_bytes: 0, snapshot_bytes: 0, total_bytes: 0, missing_snapshots: 0 });
    store.enqueue({ type: 'CLASSIFY', idempotency_key: 'missing-snapshot-id', payload: { ...context } });
    assert.equal(store.backlogBytes(context).missing_snapshots, 1, 'absent/non-text references must not silently count as zero snapshot bytes');
    assert.equal(store.observations().length, 1); assert.ok(readFileSync(store.journalPath, 'utf8').includes(observation.text));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('worker exposes the same byte accounting and resume keeps already stored raw', async () => {
  const dir = temp(); let store = await createAsyncConversationStore(dir);
  try {
    const saved = await store.ingest(observation, context); const initial = await store.backlogBytes(context);
    assert.equal(initial.jobs, 1); assert.ok(initial.total_bytes > 0);
    await store.pause({ context }); assert.equal((await store.backlogBytes(context)).total_bytes, 0);
    await store.close(); store = await createAsyncConversationStore(dir);
    await store.resume({ context }); assert.deepEqual(await store.backlogBytes(context), initial);
    assert.equal((await store.getSnapshot(saved.snapshot!.id))!.post!.text, observation.text);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
