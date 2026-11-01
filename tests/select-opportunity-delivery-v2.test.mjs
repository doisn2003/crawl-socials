import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { selectOpportunityDelivery, writeOpportunityDelivery } from '../scripts/benchmark/select-opportunity-delivery-v2.mjs';

const at = '2026-10-30T10:00:00Z';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const count = n => ({ raw: n, comments: 0, suitable: n, notYet: 0, unrelated: 0, pending: 0, failed: 0 });
function data(facebook, threads) {
  const views = [];
  for (const [platform, amount] of [['facebook', facebook], ['threads', threads]]) for (let index = 0; index < amount; index++) {
    const root = String(9000000000000000000n + BigInt(index)), body = '=PRIVATE_POST_LITERAL';
    const snapshot = { id: `${platform}:${root}:1:hash`, platform, root_post_id: root, revision: 1, content_hash: 'hash', observed_at: at,
      post: { entity_id: root, entity_type: 'POST', root_post_id: root, parent_id: null, text: body, content_hash: 'hash', observed_at: at, published_at: at,
        permalink: `https://${platform === 'facebook' ? 'www.facebook.com' : 'www.threads.com'}/${root}`, author: { name: 'PRIVATE_AUTHOR' }, source: { kind: 'PROFILE' }, media: [] },
      comments: [], coverage: { status: 'NOT_ATTEMPTED' }, spans: [{ id: `span-${root}`, entity_id: root, entity_type: 'POST', start: 0, end: body.length, text: body }] };
    const decision = { id: 'd-' + snapshot.id, platform, root_post_id: root, snapshot_id: snapshot.id, snapshot_revision: 1,
      campaign_id: 'test', campaign_version: 'v1', filter_version: 'filter1', classification: 'SUITABLE', assessment_status: 'ASSESSED',
      evidence_ids: [`span-${root}`], action_target: { type: 'POST', entity_id: root }, reason_code: 'TEST', model: 'mock', created_at: at };
    views.push({ snapshot, decision, stale: false });
  }
  // This is the frozen deployed order, deliberately opposite lexical root order.
  views.reverse();
  return { campaign: { campaign_id: 'test', version: 'v1', filter_version: 'filter1' }, conversations: views, snapshots: views.map(v => v.snapshot),
    decisions: views.map(v => v.decision), decision_snapshots: views.map(v => v.snapshot), watermark: { journal_sequence: 42, captured_at: at },
    cost: { model: 'mixed', measured_cost_usd: 0.6, unmetered_cost_upper_usd: 0.2, reserved_usd: 0.1, budget_usd: 3,
      components: [{ model: 'first', measured_cost_usd: 0.5, unmetered_cost_upper_usd: 0.2, reserved_usd: 0 }, { model: 'second', measured_cost_usd: 0.1, unmetered_cost_upper_usd: 0, reserved_usd: 0.1 }] },
    cost_captured_at: at, progress: { counts: count(facebook + threads), byPlatform: { facebook: count(facebook), threads: count(threads) }, preview: [] } };
}

test('default delivery selects exactly1000 with800Threads200Facebook and preserves frozen rank and full source', () => {
  const input = data(240, 820), before = JSON.stringify(input), selected = selectOpportunityDelivery(input);
  assert.equal(selected.status, 'READY'); assert.deepEqual(selected.manifest.selected_counts, { total: 1000, facebook: 200, threads: 800 });
  assert.equal(selected.selected.snapshots.length, 1000); assert.equal(selected.selected.conversations.length, 1000);
  assert.deepEqual(selected.selected.conversations.slice(0, 800), input.conversations.filter(v => v.snapshot.platform === 'threads').slice(0, 800));
  assert.equal(JSON.stringify(input), before); assert.equal(selected.manifest.label_provenance, 'model_assessed_not_individually_human_verified');
  assert.ok(Math.abs(selected.manifest.model_cost_upper_usd - 0.9) < 1e-12); assert.equal(selected.manifest.cost_snapshot.components.length, 2);
});

test('available mix can use700Threads300Facebook but never silently loosens the allowed range', () => {
  const valid = selectOpportunityDelivery(data(3, 7), { target: 10 }); assert.equal(valid.status, 'READY'); assert.equal(valid.manifest.selected_counts.threads, 7);
  const middle = selectOpportunityDelivery(data(30, 77), { target: 100 }); assert.equal(middle.status, 'READY'); assert.equal(middle.manifest.selected_counts.threads, 77);
  const insufficientThreads = selectOpportunityDelivery(data(6, 6), { target: 10 }); assert.equal(insufficientThreads.status, 'SHORTFALL'); assert.equal(insufficientThreads.selected, null);
  const insufficientFacebook = selectOpportunityDelivery(data(1, 20), { target: 10 }); assert.equal(insufficientFacebook.status, 'SHORTFALL'); assert.equal(insufficientFacebook.manifest.shortfall.minimum_facebook, 1);
});

test('stale views, duplicate roots, invalid evidence or failed labels cannot become a delivery', () => {
  const duplicated = data(2, 8); duplicated.snapshots.push(duplicated.snapshots[0]); assert.equal(selectOpportunityDelivery(duplicated, { target: 10 }).status, 'INVALID_POOL');
  const stale = data(2, 8); stale.conversations[0].stale = true; assert.equal(selectOpportunityDelivery(stale, { target: 10 }).selected, null);
  const broken = data(2, 8); broken.snapshots[0].spans[0].text = 'bad'; assert.equal(selectOpportunityDelivery(broken, { target: 10 }).status, 'INVALID_POOL');
  const pending = data(2, 8); Object.assign(pending.conversations[0].decision, { classification: null, assessment_status: 'FAILED', evidence_ids: [], action_target: null });
  pending.progress.counts.suitable--; pending.progress.counts.pending++; pending.progress.counts.failed++;
  pending.progress.byPlatform.threads.suitable--; pending.progress.byPlatform.threads.pending++; pending.progress.byPlatform.threads.failed++;
  const result = selectOpportunityDelivery(pending, { target: 10 }); assert.equal(result.status, 'SHORTFALL'); assert.equal(result.manifest.available.total_suitable, 9);
});

test('top20 diagnostic keeps deployed rank and flags exposed rows instead of replacing them', () => {
  const input = data(22, 25), firstThread = input.conversations[0].snapshot;
  const result = selectOpportunityDelivery(input, { target: 10, exposureRecords: [{ platform: 'threads', post_id: firstThread.root_post_id }] });
  assert.equal(result.top20.blindedRows.length, 40);
  const thread = result.top20.blindedRows.filter(row => row.platform === 'threads');
  assert.equal(thread[0].snapshot_id, firstThread.id); assert.equal(thread[0].rank, 1); assert.equal(thread[0].prior_exposure, true);
  assert.equal(result.manifest.top20_diagnostic.by_platform.threads.prior_exposed, 1);
  assert.ok(result.top20.predictions.every(row => row.classification === 'SUITABLE'));
  assert.equal(JSON.stringify(result.top20.blindedRows).includes('classification'), false); assert.equal(JSON.stringify(result.top20.blindedRows).includes('reason_code'), false);
});

test('writer reuses workbook exporter, keeps exact full pool, and shortfall writes only its manifest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-delivery-test-'));
  try {
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'delivery'), bytes = JSON.stringify(data(3, 9)); fs.writeFileSync(input, bytes);
    const moduleRoot = fileURLToPath(new URL('../.test-build/src/', import.meta.url));
    const result = await writeOpportunityDelivery({ input, output, moduleRoot, target: 10 }); assert.equal(result.status, 'READY');
    assert.equal(fs.readFileSync(path.join(output, 'full-pool.json'), 'utf8'), bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.source_export_sha256, sha(bytes)); assert.equal(manifest.files['full-pool.json'].sha256, sha(bytes));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path.join(output, 'selected-opportunities.xlsx'));
    assert.equal(workbook.getWorksheet('Conversations').rowCount, 11);
    assert.equal(workbook.getWorksheet('Conversations').getCell('F2').type, ExcelJS.ValueType.String);
    assert.equal(workbook.getWorksheet('Conversations').getCell('F2').value, '=PRIVATE_POST_LITERAL');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false); await assert.rejects(writeOpportunityDelivery({ input, output, moduleRoot, target: 10 }), /OUTPUT_ALREADY_EXISTS/);
    const short = path.join(directory, 'shortfall'); fs.writeFileSync(input, JSON.stringify(data(1, 9)));
    const shortResult = await writeOpportunityDelivery({ input, output: short, moduleRoot, target: 10 }); assert.equal(shortResult.status, 'SHORTFALL');
    assert.deepEqual(fs.readdirSync(short), ['manifest.json']);
    await assert.rejects(writeOpportunityDelivery({ input, output: fileURLToPath(new URL('../.brain/forbidden-delivery', import.meta.url)), target: 10 }), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
