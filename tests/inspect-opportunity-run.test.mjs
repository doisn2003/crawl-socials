import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeOpportunityLedgers, inspectOpportunityRun } from '../scripts/inspect-opportunity-run.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const start = (id, reserved = 0.1) => ({ type: 'START', invocation_id: id, model: 'model', purpose: 'conversation-v2', started_at: '2026-10-30T10:00:00Z', reserved_usd: reserved });
const finish = (id, cost = 0.01, unknown = 0) => ({ type: 'FINISH', invocation_id: id, model: 'model', finished_at: '2026-10-30T10:00:02Z',
  cost_usd: cost, unmetered_cost_upper_usd: unknown, error_code: null, result: { value: [{ private_text: 'PRIVATE_MODEL_TEXT' }], elapsed_ms: 2000 } });
function ledger(root, name, events, tail = '') { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'model-ledger.jsonl'); fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n' + tail); return file; }

test('legacy single-ledger diagnostic fields remain usable and do not expose model content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-inspect-ledger-'));
  try {
    ledger(dir, 'model', [start('a'), finish('a')]);
    const result = summarizeOpportunityLedgers(dir, Date.parse('2026-10-30T10:01:00Z'));
    assert.equal(result.attempts, 1); assert.equal(result.finished, 1); assert.equal(result.total_cost_usd, 0.01);
    assert.deepEqual(result.result_codes, { SUCCESS: 1 }); assert.equal(result.latency_ms.median, 2000);
    assert.equal(result.by_model[0].ledger_present, true); assert.equal(result.by_model[1].ledger_present, false);
    assert.equal(result.recent[0].returned_items, 1); assert.equal(JSON.stringify(result).includes('PRIVATE_MODEL_TEXT'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mixed-model costs include both ledgers, usage unknown and unfinished upper bounds without ID collisions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-inspect-ledger-'));
  try {
    const unknown = { ...finish('unknown', null, 0.05), error_code: 'MODEL_NETWORK_USAGE_UNKNOWN', result: null };
    ledger(dir, 'model', [start('same-id'), finish('same-id'), start('unknown', 0.05), unknown]);
    ledger(dir, 'model-gemini-3.5-flash-lite', [start('same-id'), finish('same-id', 0.03), start('unfinished', 0.2)]);
    const result = summarizeOpportunityLedgers(dir);
    assert.equal(result.attempts, 4); assert.equal(result.finished, 3); assert.equal(result.total_cost_usd, 0.04);
    assert.equal(result.total_unmetered_upper_usd, 0.05); assert.equal(result.unfinished_reservation_upper_usd, 0.2);
    assert.ok(Math.abs(result.combined_cost.total_upper_usd - 0.29) < 1e-12);
    assert.equal(result.by_model[0].total_cost_usd, 0.01); assert.equal(result.by_model[1].total_cost_usd, 0.03);
    assert.equal(result.running[0].model, 'gemini-3.5-flash-lite'); assert.equal(result.running[0].ledger_state, 'START_WITHOUT_FINISH');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('inspection skips a torn final line without repairing the file and rejects middle corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-inspect-ledger-'));
  try {
    const file = ledger(dir, 'model', [start('a'), finish('a'), finish('a')], '{partial');
    const before = fs.readFileSync(file); const result = summarizeOpportunityLedgers(dir);
    assert.equal(result.skipped_partial_tail, true); assert.equal(result.finished, 1); assert.equal(result.total_cost_usd, 0.01);
    assert.deepEqual(fs.readFileSync(file), before);
    fs.writeFileSync(file, JSON.stringify(start('a')) + '\n{corrupt\n' + JSON.stringify(finish('a')) + '\n');
    assert.throws(() => summarizeOpportunityLedgers(dir), /MODEL_LEDGER_INVALID/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const canonical = value => JSON.stringify((function normalize(v) { return Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)])) : v; })(value));
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
function contextFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-inspect-context-')), output = path.join(root, 'collection'), directory = path.join(output, 'opportunity');
  fs.mkdirSync(path.join(directory, 'store'), { recursive: true });
  const source = { campaign_id: 'synthetic', version: 'baseline', filter_version: 'primary' }, campaign = { ...source, version: 'upgraded', filter_version: 'combined' };
  const sourceContext = { campaign_id: source.campaign_id, campaign_version: source.version, filter_version: source.filter_version };
  const activeContext = { campaign_id: campaign.campaign_id, campaign_version: campaign.version, filter_version: campaign.filter_version };
  const recipe = { version: 'synthetic-combined' }, recipeHash = hash(recipe), plan = { entries: [] }, folder = path.join(directory, 'evaluations', recipeHash);
  const manifest = { recipe_sha256: recipeHash, campaign_sha256: hash(campaign), plan_sha256: hash(plan), baseline_campaign_sha256: hash(source), source_context: sourceContext, context: activeContext };
  fs.mkdirSync(folder, { recursive: true });
  const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
  write(path.join(directory, 'campaign.json'), source); write(path.join(folder, 'campaign.json'), campaign); write(path.join(folder, 'filter-recipe.json'), recipe);
  write(path.join(folder, 'migration-plan.json'), plan); write(path.join(folder, 'manifest.json'), manifest);
  const pointer = path.join(directory, 'active-evaluation.json'); write(pointer, { schema_version: 1, recipe_sha256: recipeHash, manifest_sha256: hash(manifest), state: 'MIGRATING' });
  const latest = path.join(root, 'latest.json'); write(latest, { id: 'synthetic', outputDirectory: output, state: 'COMPLETED', startedAt: '2026-10-30T10:00:00Z' });
  write(path.join(directory, 'progress.json'), { counts: { suitable: 99 }, byPlatform: {}, phase: 'COMPLETE', lastError: null, costUsd: 0, costUpperUsd: 0 });
  const file = path.join(directory, 'store', 'conversations.sqlite'), db = new DatabaseSync(file);
  db.exec(`CREATE TABLE applied_events(sequence INTEGER);
    CREATE TABLE conversations(platform TEXT,root_post_id TEXT,snapshot_id TEXT,revision INTEGER);
    CREATE TABLE snapshots(id TEXT,platform TEXT,root_post_id TEXT,revision INTEGER,payload TEXT);
    CREATE TABLE campaign_roots(context_key TEXT,platform TEXT,root_post_id TEXT);
    CREATE TABLE current_decisions(context_key TEXT,platform TEXT,root_post_id TEXT,decision_id TEXT);
    CREATE TABLE decisions(id TEXT,context_key TEXT,platform TEXT,root_post_id TEXT,snapshot_id TEXT,classification TEXT,assessment_status TEXT,payload TEXT);
    CREATE TABLE jobs(type TEXT,state TEXT,payload TEXT,created_at TEXT,updated_at TEXT,attempts INTEGER,priority INTEGER,lease_until TEXT,id TEXT);
    INSERT INTO applied_events VALUES(5); INSERT INTO conversations VALUES('threads','1','snapshot',1);`);
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)').run('snapshot', 'threads', '1', 1, JSON.stringify({ comments: [] }));
  for (const [index, context] of [sourceContext, activeContext].entries()) {
    const key = JSON.stringify(Object.values(context)), id = String(index);
    db.prepare('INSERT INTO campaign_roots VALUES(?,?,?)').run(key, 'threads', '1');
    db.prepare('INSERT INTO current_decisions VALUES(?,?,?,?)').run(key, 'threads', '1', id);
    db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?,?,?)').run(id, key, 'threads', '1', 'snapshot', index ? null : 'SUITABLE', index ? 'PENDING' : 'ASSESSED', JSON.stringify({ created_at: '2026-10-30T10:00:00Z' }));
    db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)').run(index ? 'VERIFY' : 'CLASSIFY', index ? 'PENDING' : 'RUNNING', JSON.stringify({ ...context, platform: 'threads', snapshot_id: 'snapshot' }), '2026-10-30T10:00:00Z', '2026-10-30T10:00:00Z', 0, 1, '2030-01-01T00:00:00Z', id);
  }
  db.close(); return { root, latest, pointer, file };
}
test('active-context inspection excludes baseline positives and old jobs instead of double counting current decisions', () => {
  const fixture = contextFixture();
  try {
    const before = fs.readFileSync(fixture.file), result = inspectOpportunityRun(fixture.latest);
    assert.equal(result.evaluation.state, 'MIGRATING'); assert.equal(result.progress.counts.raw, 1);
    assert.equal(result.progress.counts.suitable, 0); assert.equal(result.progress.counts.pending, 1);
    assert.equal(result.database.current_decisions.length, 1); assert.equal(result.database.current_decisions[0].assessment_status, 'PENDING');
    assert.deepEqual(result.database.jobs.map(job => job.type), ['VERIFY']); assert.equal(result.database.active_classifier.length, 0);
    assert.equal(result.database.decision_history.count, 1); assert.deepEqual(fs.readFileSync(fixture.file), before);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
test('corrupt active evaluation pointer fails inspection instead of falling back to baseline counts', () => {
  const fixture = contextFixture();
  try {
    fs.writeFileSync(fixture.pointer, JSON.stringify({ schema_version: 1, recipe_sha256: '../../unsafe', state: 'MIGRATING' }));
    assert.throws(() => inspectOpportunityRun(fixture.latest), /INSPECTION_ACTIVE_CONTEXT_INVALID/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
