import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createDiscoveryStore, deliveryMonth, exportDigest } from '../src/infrastructure/storage/discovery-store.js';

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

test('migration preserves old awaiting batches and their export scope', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'followup'); s.store.finishRun(sub.id, 3);
    const db = new DatabaseSync(s.file); db.exec('ALTER TABLE subscriptions DROP COLUMN expected_count'); db.exec('ALTER TABLE subscriptions DROP COLUMN recipe_run'); db.exec('ALTER TABLE delivery_exports DROP COLUMN error'); db.close();
    s.reopen(); assert.equal(s.store.list()[0]!.awaitingExport, true);
    assert.equal(s.store.list()[0]!.recipeRunId, 'source');
    s.export('followup', ['facebook:a']);
    assert.equal(s.store.scopeForRun('followup'), 'source');
    assert.deepEqual(s.store.deliveredKeys('source').sort(), ['facebook:a', 'facebook:initial']);
  } finally { s.close(); }
});

test('explicit recipe attachment preserves stable customer/topic scope and receipts without merging equal labels', () => {
  const s = sandbox();
  try {
    const sub = ready(s);
    s.export('new-manual-recipe', ['facebook:initial', 'threads:new']);
    const attached = s.store.attachRecipe(sub.id, 'new-manual-recipe')[0]!;
    assert.equal(attached.id, sub.id); assert.equal(attached.sourceRunId, 'source'); assert.equal(attached.recipeRunId, 'new-manual-recipe');
    assert.equal(s.store.scopeForRun('new-manual-recipe'), 'source'); assert.equal(attached.deliveredTotal, 2);
    assert.equal(attached.deliveredThisMonth, 1, 'only the stable original initial batch is excluded from monthly additions');
    const unrelated = s.store.create({ sourceRunId: 'another-customer', label: 'Spa' }).find(v => v.sourceRunId === 'another-customer')!;
    assert.equal(unrelated.deliveredTotal, 0, 'equal labels/prompts cannot merge customers implicitly');
    assert.throws(() => s.store.attachRecipe(sub.id, 'another-customer'), /DISCOVERY_SCOPE_CONFLICT/);
    assert.throws(() => s.store.attachRecipe(unrelated.id, 'new-manual-recipe'), /DISCOVERY_SCOPE_CONFLICT/);
    assert.equal(s.reopen().list().find(v => v.id === sub.id)!.recipeRunId, 'new-manual-recipe');
  } finally { s.close(); }
});

test('recipe attachment cannot replace active or awaited work and does not accept path-like run IDs', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.beginRun(sub.id, 'active');
    assert.throws(() => s.store.attachRecipe(sub.id, 'new-recipe'), /DISCOVERY_BUSY/);
    s.store.finishRun(sub.id, 2); s.export('active', ['facebook:a']);
    assert.throws(() => s.store.attachRecipe(sub.id, 'new-recipe'), /DISCOVERY_BUSY/);
    s.export('active', ['facebook:b']); s.store.setEnabled(sub.id, false);
    assert.throws(() => s.store.attachRecipe(sub.id, '../outside'), /DISCOVERY_INPUT_INVALID/);
    s.store.attachRecipe(sub.id, 'new-recipe'); assert.equal(s.store.list()[0]!.enabled, false);
  } finally { s.close(); }
});

test('previouslyDeliveredForRun removes other batches while preserving repeat exports of this same batch', () => {
  const s = sandbox();
  try {
    const sub = ready(s); s.store.attachRecipe(sub.id, 'manual');
    assert.deepEqual(s.store.previouslyDeliveredForRun('manual'), ['facebook:initial']);
    s.export('manual', ['facebook:initial', 'threads:mine']);
    assert.deepEqual(s.store.previouslyDeliveredForRun('manual'), ['facebook:initial']);
    assert.deepEqual(s.store.previouslyDeliveredForRun('source'), ['threads:mine']);
    s.store.beginRun(sub.id, 'followup');
    assert.deepEqual(s.store.previouslyDeliveredForRun('followup'), ['facebook:initial', 'threads:mine']);
    s.export('followup', ['facebook:new-followup']);
    assert.deepEqual(s.store.previouslyDeliveredForRun('followup'), ['facebook:initial', 'threads:mine']);
    assert.throws(() => s.store.previouslyDeliveredForRun('../outside'), /DISCOVERY_RUN_INVALID/);
  } finally { s.close(); }
});
