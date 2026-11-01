import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIVE_HOLDOUT_SEED, sampleLiveExport, freezeLiveSample } from '../scripts/benchmark/sample-live-v2.mjs';
import { evaluateOpportunitySample } from '../scripts/benchmark/evaluate-opportunity-v2.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const time = '2026-10-30T12:00:00Z';
function snapshot(platform, index, text = 'PRIVATE_POST_SENTINEL có quán cafe yên tĩnh không?') {
  const root = String(9000000000000000n + BigInt(index));
  const post = { entity_id: root, entity_type: 'POST', root_post_id: root, parent_id: null, text, observed_at: time, published_at: time,
    permalink: `https://example.test/${platform}/${root}`, content_hash: sha(text), author: { id: 'author', name: 'PRIVATE_NAME_SENTINEL', role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [] };
  return { id: `${platform}:${root}:1:hash`, platform, root_post_id: root, revision: 1, content_hash: sha(text), observed_at: time, post, comments: [], coverage: { status: 'NOT_ATTEMPTED' },
    spans: text ? [{ id: `${platform}-${root}-span`, entity_id: root, entity_type: 'POST', start: 0, end: text.length, text }] : [] };
}
function decision(s, overrides = {}) {
  return { id: 'decision-' + s.id, campaign_id: 'test', campaign_version: 'v1', filter_version: 'filter1', snapshot_id: s.id, classification: 'SUITABLE', assessment_status: 'ASSESSED',
    reason_code: 'OPPORTUNITY_REQUEST', evidence_ids: s.spans.map(span => span.id), model: 'test-model', attributes: { need_summary: 'PRIVATE_MODEL_REASON' }, ...overrides };
}
function exported(facebook = 160, threads = 260) {
  const snapshots = [...Array.from({ length: facebook }, (_, i) => snapshot('facebook', i)), ...Array.from({ length: threads }, (_, i) => snapshot('threads', i))];
  return { campaign: { campaign_id: 'test', version: 'v1', filter_version: 'filter1', prompt: 'Tìm quán cafe', budget: { model_usd: 3 } }, snapshots,
    conversations: snapshots.map(s => ({ snapshot: s, decision: decision(s), stale: false })), decisions: snapshots.map(s => decision(s)),
    watermark: { journal_sequence: 999, journal_event_id: 'event-last', captured_at: time }, cost: { model: 'test-model', measured_cost_usd: 0.1, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }, cost_captured_at: time };
}
test('default frozen hash sample selects100 Facebook and200 Threads independent of row order and model labels', () => {
  const data = exported(), first = sampleLiveExport(data, { createdAt: time });
  assert.equal(first.blindedRows.length, 300); assert.equal(first.manifest.seed, DEFAULT_LIVE_HOLDOUT_SEED);
  assert.equal(first.manifest.strata.facebook.inclusion_probability, 100 / 160); assert.equal(first.manifest.strata.threads.design_weight, 260 / 200);
  const changed = structuredClone(data); changed.snapshots.reverse(); changed.conversations.reverse();
  for (const view of changed.conversations) Object.assign(view.decision, { classification: null, assessment_status: 'FAILED', reason_code: 'PRIVATE_RETRY_REASON' });
  const second = sampleLiveExport(changed, { createdAt: time });
  assert.deepEqual(second.blindedRows, first.blindedRows); assert.equal(second.manifest.population_frame_sha256, first.manifest.population_frame_sha256);
  assert.equal(second.predictions.every(row => row.assessment_status === 'FAILED'), true);
});
test('all snapshots including empty context, technical pending and absent current decisions remain eligible', () => {
  const data = exported(0, 3), blank = snapshot('threads', 1, ''); data.snapshots[1] = blank;
  data.conversations = [{ snapshot: data.snapshots[0], decision: decision(data.snapshots[0], { classification: null, assessment_status: 'PENDING' }), stale: false }];
  // A stale decision for the same root must never stand in for a missing current snapshot decision.
  data.decisions.push(decision(data.snapshots[2], { snapshot_id: data.snapshots[2].id + '-old' }));
  const sampled = sampleLiveExport(data);
  assert.equal(sampled.blindedRows.length, 3); assert.equal(sampled.manifest.sample_status, 'UNDERSIZED');
  assert.equal(sampled.predictions.filter(row => row.assessment_status === 'MISSING').length, 2);
  assert.ok(sampled.blindedRows.some(row => row.post.text === '' && row.spans.length === 0));
  const ref = sampled.blindedRows.map(row => ({ snapshot_id: row.snapshot_id, final_label: 'SUITABLE' }));
  const metrics = evaluateOpportunitySample(ref, sampled.predictions, () => 'threads').threads;
  assert.equal(metrics.fn, 3); assert.equal(metrics.pending_or_failed, 3);
});
test('blinded files preserve complete comment context and exact evidence while excluding extra prediction fields', () => {
  const data = exported(0, 1), s = data.snapshots[0], body = 'PRIVATE_COMMENT_SENTINEL hỏi giá';
  const comment = { ...s.post, entity_id: 'comment-1', entity_type: 'COMMENT', parent_id: s.root_post_id, text: body, content_hash: sha(body) };
  s.comments.push(comment); s.spans.push({ id: 'comment-span', entity_id: 'comment-1', entity_type: 'COMMENT', start: 0, end: body.length, text: body });
  s.coverage = { status: 'PARTIAL', advertised_count: 25, observed_count: 1, has_more: true, sort_mode: 'ranked', stop_reason: 'BUDGET', pages: 1 };
  s.classification = 'PRIVATE_PREDICTION_LEAK'; s.post.prediction = 'PRIVATE_PREDICTION_LEAK'; s.post.author.model_reason = 'PRIVATE_PREDICTION_LEAK';
  const row = sampleLiveExport(data).blindedRows[0];
  assert.equal(row.comments[0].text, body); assert.equal(row.comments[0].parent_id, row.root_post_id); assert.equal(row.coverage.status, 'PARTIAL');
  assert.equal(row.spans.find(span => span.id === 'comment-span').text, body); assert.equal(row.as_of, time);
  assert.equal(JSON.stringify(row).includes('PRIVATE_PREDICTION_LEAK'), false); assert.equal(JSON.stringify(row).includes('PRIVATE_MODEL_REASON'), false);
});
test('blinded identity is stable while changed content gets a different frozen snapshot hash', () => {
  const data = exported(1, 0), first = sampleLiveExport(data).blindedRows[0];
  const changed = structuredClone(data); changed.snapshots[0].post.author.name = 'Another observed name';
  const second = sampleLiveExport(changed).blindedRows[0];
  assert.equal(first.sample_id, second.sample_id); assert.equal(first.sampling.selection_sha256, second.sampling.selection_sha256); assert.notEqual(first.blinded_snapshot_sha256, second.blinded_snapshot_sha256);
});
test('duplicate roots and broken evidence fail rather than silently shrinking the sample frame', () => {
  const data = exported(1, 0); data.snapshots.push(structuredClone(data.snapshots[0]));
  assert.throws(() => sampleLiveExport(data), /DUPLICATE_CURRENT_SNAPSHOT/);
  const invalid = exported(1, 0); invalid.snapshots[0].spans[0].text = 'wrong evidence'; assert.throws(() => sampleLiveExport(invalid), /SNAPSHOT_EVIDENCE_INVALID/);
  const missingWatermark = exported(1, 0); delete missingWatermark.watermark; assert.throws(() => sampleLiveExport(missingWatermark), /FROZEN_WATERMARK_REQUIRED/);
});
test('freezing writes private files outside repo once and reports no raw text in CLI stdout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-live-sample-test-'));
  try {
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'holdout'); fs.writeFileSync(input, JSON.stringify(exported(3, 5)));
    const script = fileURLToPath(new URL('../scripts/benchmark/sample-live-v2.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--input', input, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout); assert.equal(summary.sample_count, 8); assert.equal(summary.sample_status, 'UNDERSIZED');
    for (const marker of ['PRIVATE_POST_SENTINEL', 'PRIVATE_NAME_SENTINEL', 'PRIVATE_MODEL_REASON', 'https://example.test']) assert.equal(result.stdout.includes(marker), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.files.blinded_reference.sha256, sha(fs.readFileSync(path.join(output, 'blinded-reference.jsonl'))));
    assert.equal(manifest.input.sha256, sha(fs.readFileSync(input))); assert.equal(manifest.cost_snapshot.measured_cost_usd, 0.1);
    assert.equal(manifest.independence_checks.prior_calibration_root_overlap, 'NOT_CHECKED');
    assert.throws(() => freezeLiveSample({ input, output }), /FROZEN_OUTPUT_ALREADY_EXISTS/);
    const root = fileURLToPath(new URL('../', import.meta.url));
    assert.throws(() => freezeLiveSample({ input, output: path.join(root, '.brain', 'forbidden-raw-holdout') }), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('history fallback matches exact snapshot and does not overwrite assessed output with a late failure', () => {
  const data = exported(1, 0); delete data.conversations;
  data.decisions.push(decision(data.snapshots[0], { classification: null, assessment_status: 'FAILED' }));
  const sample = sampleLiveExport(data); assert.equal(sample.predictions[0].classification, 'SUITABLE'); assert.equal(sample.manifest.predictions_source, 'EXACT_SNAPSHOT_HISTORY_REPLAY');
});

test('historical roots are excluded by platform before uniform sampling and weights use the eligible frame', () => {
  const data = exported(160, 260), firstId = data.snapshots[0].root_post_id;
  const exclusionRecords = [
    ...Array.from({ length: 12 }, (_, index) => ({ platform: 'facebook', root_post_id: data.snapshots[index].root_post_id })),
    { platform: 'facebook', post_id: firstId }, { platform: 'threads', post_id: 'previous-root-not-in-this-run' },
  ];
  const options = { exclusionRecords, createdAt: time }, result = sampleLiveExport(data, options);
  assert.equal(result.blindedRows.length, 300); assert.equal(result.manifest.input_population_count, 420); assert.equal(result.manifest.population_count, 408);
  assert.equal(result.manifest.strata.facebook.population_count, 148); assert.equal(result.manifest.strata.facebook.inclusion_probability, 100 / 148);
  assert.equal(result.manifest.strata.threads.population_count, 260); assert.equal(result.manifest.exclusions.excluded_population_count, 12);
  assert.equal(result.manifest.exclusions.input_record_count, 14); assert.equal(result.manifest.exclusions.unique_root_count, 13); assert.equal(result.manifest.exclusions.duplicate_record_count, 1);
  assert.equal(result.manifest.exclusions.by_platform.threads.supplied_roots_absent_from_population, 1);
  assert.equal(result.manifest.independence_checks.prior_calibration_root_overlap, 'SUPPLIED_ROOTS_EXCLUDED_BEFORE_SAMPLING');
  const forbidden = new Set(exclusionRecords.filter(row => row.platform === 'facebook').map(row => row.root_post_id ?? row.post_id));
  assert.equal(result.blindedRows.some(row => row.platform === 'facebook' && forbidden.has(row.root_post_id)), false);
  // An identical root string on another network is a different sampling unit.
  const census = sampleLiveExport(data, { ...options, facebookCount: 1000, threadsCount: 1000 });
  assert.equal(census.blindedRows.some(row => row.platform === 'threads' && row.root_post_id === firstId), true);
  const reversed = structuredClone(data); reversed.snapshots.reverse(); reversed.conversations.reverse();
  reversed.conversations.forEach(view => { view.decision.classification = null; view.decision.assessment_status = 'FAILED'; });
  const second = sampleLiveExport(reversed, { ...options, exclusionRecords: [...exclusionRecords].reverse() });
  assert.deepEqual(second.blindedRows, result.blindedRows); assert.equal(second.manifest.exclusions.root_set_sha256, result.manifest.exclusions.root_set_sha256);
  assert.equal(second.manifest.population_frame_sha256, result.manifest.population_frame_sha256);
});

test('invalid exclusion identities fail and an entirely excluded population is explicitly undersized', () => {
  const data = exported(1, 0), root = data.snapshots[0].root_post_id;
  assert.throws(() => sampleLiveExport(data, { exclusionRecords: [{ platform: 'facebook', post_id: Number(root) }] }), /EXCLUSION_ROOT_ID_INVALID/);
  assert.throws(() => sampleLiveExport(data, { exclusionRecords: [{ platform: 'invalid', post_id: root }] }), /EXCLUSION_PLATFORM_INVALID/);
  assert.throws(() => sampleLiveExport(data, { exclusionRecords: [{ platform: 'facebook', post_id: root, root_post_id: 'different' }] }), /EXCLUSION_ROOT_ID_CONFLICT/);
  const empty = sampleLiveExport(data, { exclusionRecords: [{ platform: 'facebook', root_post_id: root }] });
  assert.equal(empty.blindedRows.length, 0); assert.equal(empty.manifest.population_count, 0); assert.equal(empty.manifest.sample_status, 'UNDERSIZED');
  assert.equal(empty.manifest.strata.facebook.inclusion_probability, null); assert.equal(empty.manifest.strata.facebook.shortfall, 100);
});

test('CLI exclusion JSONL is frozen by file hash and never prints excluded IDs or private content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csd-live-exclusion-test-'));
  try {
    const data = exported(3, 5), input = path.join(directory, 'input.json'), output = path.join(directory, 'holdout'), excluded = path.join(directory, 'excluded.jsonl');
    fs.writeFileSync(input, JSON.stringify(data));
    fs.writeFileSync(excluded, JSON.stringify({ platform: 'facebook', post_id: data.snapshots[0].root_post_id }) + '\r\n\r\n');
    const script = fileURLToPath(new URL('../scripts/benchmark/sample-live-v2.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--input', input, '--output', output, '--exclude-ids', excluded], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout); assert.equal(summary.sample_count, 7); assert.equal(summary.excluded_population_count, 1);
    assert.equal(result.stdout.includes(data.snapshots[0].root_post_id), false); assert.equal(result.stdout.includes('PRIVATE_'), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.exclusion_input.sha256, sha(fs.readFileSync(excluded))); assert.equal(manifest.exclusion_input.path, excluded);
    assert.equal(manifest.strata.facebook.population_count, 2); assert.equal(manifest.strata.facebook.excluded_population_count, 1);
    fs.writeFileSync(excluded, '{broken');
    assert.throws(() => freezeLiveSample({ input, output: path.join(directory, 'invalid'), excludeIds: excluded }), /EXCLUSION_JSONL_INVALID/);
    assert.equal(fs.existsSync(path.join(directory, 'invalid')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
