import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createDiscoveryStore, deliveryMonth, exportDigest } from '../src/infrastructure/storage/discovery-store.js';
import { createDiscoveryWatch } from '../src/application/discovery-watch.js';
import type { ProductionState, RunState } from '../src/shared/production-api.js';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'csd-watch-')); let current = new Date('2026-11-06T01:00:00Z');
  const file = join(root, 'discovery.sqlite'), now = () => new Date(current);
  let store = createDiscoveryStore(file, now), sequence = 0;
  return { root, file, now, get store() { return store; }, setTime(value: string) { current = new Date(value); },
    advance(hours: number) { current = new Date(current.getTime() + hours * 3600000); },
    reopen() { store.close(); store = createDiscoveryStore(file, now); return store; },
    export(runId: string, roots: string[]) {
      const destination = join(root, 'export-' + (++sequence) + '.json'); writeFileSync(destination, JSON.stringify(roots));
      const receipt = store.prepareExport(runId, roots, destination, exportDigest(destination)); store.completeExport(receipt); return receipt;
    },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function run(id: string, count = 0, state: RunState['state'] = 'COMPLETED', source?: string): RunState {
  const counts = { raw: count, comments: 0, suitable: count, pending: 0, failed: 0, notYet: 0, unrelated: 0 };
  return { id, state, startedAt: '2026-11-06T01:00:00Z', finishedAt: state === 'RUNNING' ? null : '2026-11-06T02:00:00Z',
    minimumPosts: 100, keywords: ['spa'], outputDirectory: 'fixture', platforms: [], preview: [], ...(source ? { discoverySourceRunId: source } : {}),
    opportunity: { campaignId: id, totalTarget: 100, targetCount: count, threadsShare: .5, counts, byPlatform: { facebook: counts, threads: counts },
      costUsd: 0, costUpperUsd: 0, usageUnknown: 0, budgetUsd: 3, phase: 'SETTLED', lastError: null, preview: [], filterMode: 'STANDARD' } };
}
const stateFor = (r: RunState | null): ProductionState => ({ version: 'fixture', config: { keywords: [], minimumPosts: 100 }, accounts: [], run: r });
function ready(s: ReturnType<typeof sandbox>, intervalHours = 6) {
  s.export('source', ['facebook:initial']); const [sub] = s.store.create({ sourceRunId: 'source', label: 'Spa', intervalHours });
  s.advance(intervalHours); return sub!;
}

test('subscriptions default to daily /100 with six-hour minimum and reject invalid IDs, roots and destinations', () => {
  const s = sandbox();
  try {
    const [sub] = s.store.create({ sourceRunId: 'source', label: ' Spa ' });
    assert.equal(sub!.intervalHours, 24); assert.equal(sub!.monthlyTarget, 100); assert.equal(sub!.label, 'Spa');
    assert.equal(Date.parse(sub!.nextRunAt) - s.now().getTime(), 24 * 3600000);
    assert.throws(() => s.store.create({ sourceRunId: '../outside', label: 'x' }), /DISCOVERY_INPUT_INVALID/);
    assert.throws(() => s.store.create({ sourceRunId: 'other', label: 'x', intervalHours: 5 }), /DISCOVERY_INPUT_INVALID/);
    assert.throws(() => s.store.setEnabled('../outside', true), /DISCOVERY_INPUT_INVALID/);
    assert.throws(() => s.store.scopeForRun('C:\\outside'), /DISCOVERY_RUN_INVALID/);
    assert.throws(() => s.store.prepareExport('source', ['facebook:a\nb'], join(s.root, 'x'), 'a'.repeat(64)), /DELIVERY_INPUT_INVALID/);
    assert.throws(() => s.store.prepareExport('source', ['facebook:a'], '../outside', 'a'.repeat(64)), /DELIVERY_INPUT_INVALID/);
    assert.throws(() => s.store.completeExport('../outside'), /DELIVERY_INPUT_INVALID/);
  } finally { s.close(); }
});

test('monthly delivery excludes initial batch, counts old never-delivered posts, and deduplicates repeat/overlapping exports for life', () => {
  const s = sandbox();
  try {
    s.export('source', ['facebook:initial', 'threads:initial']);
    const [sub] = s.store.create({ sourceRunId: 'source', label: 'Spa' });
    assert.equal(sub!.deliveredTotal, 2); assert.equal(sub!.deliveredThisMonth, 0);
    s.store.beginRun(sub!.id, 'followup');
    const receipt = s.export('followup', ['facebook:initial', 'facebook:published-in-2018', 'facebook:published-in-2018']);
    s.store.completeExport(receipt); s.export('followup', ['facebook:published-in-2018']);
    assert.equal(s.store.exportedCount('followup'), 2);
    assert.equal(s.store.list()[0]!.deliveredTotal, 3); assert.equal(s.store.list()[0]!.deliveredThisMonth, 1);
    s.setTime('2026-11-30T17:00:00Z'); assert.equal(deliveryMonth(s.now()), '2026-12');
    assert.equal(s.store.list()[0]!.deliveredThisMonth, 0);
    s.export('followup', ['facebook:published-in-2018', 'threads:newly-discovered-old-post']);
    assert.equal(s.store.list()[0]!.deliveredThisMonth, 1); assert.equal(s.store.deliveredKeys('followup').length, 4);
  } finally { s.close(); }
});

test('partial/live exports cannot release a finished batch until enough distinct roots of that run are exported', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup');
    s.export('followup', ['facebook:a']); s.store.finishRun(sub.id, 3);
    assert.equal(s.store.list()[0]!.awaitingExport, true); assert.equal(s.store.hasExport('followup', 3), false);
    s.export('followup', ['facebook:a']); s.export('source', ['facebook:unrelated-initial-export']);
    assert.equal(s.store.list()[0]!.awaitingExport, true);
    s.export('followup', ['facebook:b', 'facebook:c']);
    assert.equal(s.store.list()[0]!.awaitingExport, false); assert.equal(s.store.exportedCount('followup'), 3);
    assert.equal(s.reopen().list()[0]!.awaitingExport, false);
  } finally { s.close(); }
});

test('staged export counts nothing before rename, recovers after rename/restart, and remains idempotent', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup'); s.store.finishRun(sub.id, 1);
    const staged = join(s.root, 'stage.json'), destination = join(s.root, 'saved.json'); writeFileSync(staged, 'durable export');
    s.store.prepareExport('followup', ['facebook:old-but-new-to-customer'], destination, exportDigest(staged));
    s.reopen(); assert.equal(s.store.exportedCount('followup'), 0); assert.equal(s.store.list()[0]!.awaitingExport, true);
    assert.equal(s.store.list()[0]!.lastError, 'DELIVERY_FILE_MISSING');
    renameSync(staged, destination); s.reopen();
    assert.equal(s.store.exportedCount('followup'), 1); assert.equal(s.store.list()[0]!.deliveredThisMonth, 1);
    assert.equal(s.store.list()[0]!.awaitingExport, false); assert.equal(s.store.list()[0]!.lastError, null);
    s.reopen(); assert.equal(s.store.list()[0]!.deliveredThisMonth, 1);
  } finally { s.close(); }
});

test('SQLite completion failure rolls back both delivery and receipt, then recovery finishes the saved file exactly once', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup'); s.store.finishRun(sub.id, 1);
    const destination = join(s.root, 'saved.json'); writeFileSync(destination, 'saved file');
    const receipt = s.store.prepareExport('followup', ['facebook:a'], destination, exportDigest(destination));
    const db = new DatabaseSync(s.file);
    db.exec("CREATE TRIGGER crash_completion BEFORE UPDATE OF complete ON delivery_exports WHEN NEW.complete=1 BEGIN SELECT RAISE(ABORT,'simulated_crash'); END;");
    assert.throws(() => s.store.completeExport(receipt), /simulated_crash/);
    assert.equal(s.store.exportedCount('followup'), 0); assert.equal(s.store.list()[0]!.deliveredThisMonth, 0);
    db.exec('DROP TRIGGER crash_completion'); db.close();
    s.reopen(); assert.equal(s.store.list()[0]!.deliveredThisMonth, 1); assert.equal(s.store.list()[0]!.awaitingExport, false);
  } finally { s.close(); }
});

test('mismatching, unreadable and malformed incomplete receipts do not crash startup or claim delivery', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup');
    const mismatch = join(s.root, 'wrong.json'), directory = join(s.root, 'not-a-file'); writeFileSync(mismatch, 'wrong'); mkdirSync(directory);
    s.store.prepareExport('followup', ['facebook:a'], mismatch, 'a'.repeat(64));
    s.store.prepareExport('followup', ['facebook:b'], directory, 'a'.repeat(64));
    s.reopen(); assert.equal(s.store.exportedCount('followup'), 0); assert.equal(s.store.list()[0]!.lastError, 'DELIVERY_FILE_UNREADABLE');
    const valid = join(s.root, 'valid.json'); writeFileSync(valid, 'valid');
    const receipt = s.store.prepareExport('followup', ['facebook:c'], valid, exportDigest(valid));
    const db = new DatabaseSync(s.file); db.prepare('UPDATE delivery_exports SET roots=? WHERE id=?').run('{bad', receipt); db.close();
    s.reopen(); assert.equal(s.store.exportedCount('followup'), 0); assert.equal(s.store.list()[0]!.lastError, 'DELIVERY_RECEIPT_INVALID');
  } finally { s.close(); }
});

test('recovering an orphan service run moves already-completed receipts into the original lifetime scope', () => {
  const s = sandbox();
  try {
    const sub = ready(s);
    // Service persisted/ran/exported before its subscription mapping survived a crash.
    s.export('orphan', ['facebook:initial', 'facebook:new']);
    assert.equal(s.store.scopeForRun('orphan'), 'orphan');
    s.store.beginRun(sub.id, 'orphan'); s.store.beginRun(sub.id, 'orphan');
    assert.equal(s.store.scopeForRun('orphan'), 'source');
    assert.deepEqual(s.store.deliveredKeys('source').sort(), ['facebook:initial', 'facebook:new']);
    assert.equal(s.store.list()[0]!.deliveredThisMonth, 1);
    s.store.finishRun(sub.id, 2); assert.equal(s.store.list()[0]!.awaitingExport, false);
  } finally { s.close(); }
});

test('controller protects a manual result after partial export and supplies only remaining target and lifetime exclusions', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); let current = stateFor(run('manual', 2)); const starts: { source: string; target: number; excluded: string[] }[] = [];
    s.export('manual', ['facebook:manual-a']);
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => current, readRunState: () => null,
      start: async (source, target, excluded) => { starts.push({ source, target, excluded }); current = stateFor(run('next', 0, 'RUNNING', source)); return current; } });
    await watch.tick(); assert.equal(starts.length, 0);
    await assert.rejects(watch.tick(sub.id), /DISCOVERY_EXPORT_REQUIRED/);
    s.export('manual', ['facebook:manual-b']); await watch.tick();
    assert.deepEqual(starts, [{ source: 'source', target: 100, excluded: ['facebook:initial'] }]);
    assert.equal(s.store.list()[0]!.activeRunId, 'next'); await watch.stop();
  } finally { s.close(); }
});

test('controller finishes partial exports safely, waits for full batch, then fills remaining monthly target', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup'); s.export('followup', ['facebook:a']);
    let current = stateFor(run('followup', 3, 'COMPLETED', 'source')); let target = 0;
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => current, readRunState: () => current.run,
      start: async (source, count) => { target = count; current = stateFor(run('next', 0, 'RUNNING', source)); return current; } });
    await watch.tick(); assert.equal(s.store.list()[0]!.awaitingExport, true); assert.equal(target, 0);
    s.advance(24); await watch.tick(); assert.equal(target, 0);
    s.export('followup', ['facebook:b', 'facebook:c']); await watch.tick(); assert.equal(target, 97);
    await watch.stop();
  } finally { s.close(); }
});

test('controller recovers sourceRunId before finishing an orphan completed run, even with the subscription disabled', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.setEnabled(sub.id, false);
    const current = stateFor(run('orphan', 3, 'COMPLETED', 'source'));
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => current, readRunState: () => null,
      start: async () => { throw Error('must not start'); } });
    await watch.tick(); assert.equal(s.store.scopeForRun('orphan'), 'source');
    assert.equal(s.store.list()[0]!.awaitingExport, true); assert.equal(s.store.list()[0]!.activeRunId, null);
    s.export('orphan', ['facebook:a']); assert.equal(s.store.list()[0]!.awaitingExport, true);
    s.export('orphan', ['facebook:b', 'facebook:c']); assert.equal(s.store.list()[0]!.awaitingExport, false);
    await watch.stop();
  } finally { s.close(); }
});

test('watch serializes starts and stop waits for in-flight bookkeeping before refusing future work', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); let starts = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => stateFor(run('source', 1)), readRunState: () => null,
      start: async source => { starts++; await gate; return stateFor(run('next', 0, 'RUNNING', source)); } });
    const first = watch.tick(); await Promise.resolve(); await Promise.resolve();
    assert.equal(starts, 1); await watch.tick(); await assert.rejects(watch.tick(sub.id), /DISCOVERY_BUSY/);
    let stopped = false; const stopping = watch.stop().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); release(); await first; await stopping;
    assert.equal(s.store.list()[0]!.activeRunId, 'next'); assert.equal(watch.busy, false);
    await watch.tick(); await assert.rejects(watch.tick(sub.id), /DISCOVERY_STOPPED/); assert.equal(starts, 1);
  } finally { s.close(); }
});

test('pause prevents starts, failed budget/login starts defer at configured cadence, and invalid request IDs do not reach service', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); let starts = 0;
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => stateFor(run('source', 1)), readRunState: () => null,
      start: async () => { starts++; throw Error('MODEL_BUDGET_EXHAUSTED'); } });
    s.store.setEnabled(sub.id, false); await watch.tick(); assert.equal(starts, 0);
    await assert.rejects(watch.tick('../outside'), /DISCOVERY_INPUT_INVALID/);
    s.store.setEnabled(sub.id, true); await watch.tick(); assert.equal(starts, 1);
    assert.equal(s.store.list()[0]!.lastError, 'MODEL_BUDGET_EXHAUSTED'); assert.equal(s.store.list()[0]!.activeRunId, null);
    assert.equal(Date.parse(s.store.list()[0]!.nextRunAt) - s.now().getTime(), 6 * 3600000);
    await watch.tick(); assert.equal(starts, 1); await watch.stop();
  } finally { s.close(); }
});

test('missing or unreadable active run state blocks replacement; an interrupted batch retains its partial results', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'active'); let stored: RunState | null = null, unreadable = false;
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => stateFor(null),
      readRunState: () => { if (unreadable) throw Error('raw diagnostic must not leak'); return stored; },
      start: async () => { throw Error('must not start'); } });
    await watch.tick(); assert.equal(s.store.list()[0]!.lastError, 'DISCOVERY_RUN_STATE_MISSING'); assert.equal(s.store.list()[0]!.activeRunId, 'active');
    unreadable = true; await watch.tick(); assert.equal(s.store.list()[0]!.lastError, 'DISCOVERY_RUN_STATE_UNREADABLE');
    unreadable = false; stored = run('active', 2, 'INTERRUPTED', 'source'); await watch.tick();
    assert.equal(s.store.list()[0]!.lastError, 'DISCOVERY_RUN_INTERRUPTED'); assert.equal(s.store.list()[0]!.awaitingExport, true);
    assert.equal(s.store.list()[0]!.activeRunId, null); await watch.stop();
  } finally { s.close(); }
});

test('migration preserves old awaiting batches and recalculates expected count before accepting a partial export', async () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup'); s.store.finishRun(sub.id, 3);
    const db = new DatabaseSync(s.file); db.exec('ALTER TABLE subscriptions DROP COLUMN expected_count'); db.exec('ALTER TABLE delivery_exports DROP COLUMN error'); db.close();
    s.reopen(); assert.equal(s.store.list()[0]!.awaitingExport, true);
    const watch = createDiscoveryWatch({ store: s.store, now: s.now, getState: async () => stateFor(run('followup', 3, 'COMPLETED', 'source')),
      readRunState: () => null, start: async () => { throw Error('must not start'); } });
    await watch.tick(); s.export('followup', ['facebook:a']); assert.equal(s.store.list()[0]!.awaitingExport, true);
    s.export('followup', ['facebook:b', 'facebook:c']); assert.equal(s.store.list()[0]!.awaitingExport, false); await watch.stop();
  } finally { s.close(); }
});
