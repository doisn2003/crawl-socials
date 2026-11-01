import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { prepareFocusedAblation, prepareFocusedResume, purposeCostUpper, requestCostUpper, evaluateFocusedAblation,
  runFocusedAblation } from '../scripts/benchmark/focused-verifier-ablation-v2.mjs';

function fixture(perPlatform = 1) {
  const campaign = { campaign_id: 'test', version: 'v1', filter_version: 'v1', budget: { model_usd: 3 } }, rows = [], conversations = [];
  for (const platform of ['facebook', 'threads']) for (let n = 1; n <= perPlatform; n++) {
    const id = `${platform}-${n}`, text = 'Xin quán cafe yên tĩnh để học.', at = '2026-10-30T00:00:00Z';
    const post = { entity_id: id, entity_type: 'POST', root_post_id: id, parent_id: null, text, observed_at: at,
      published_at: at, permalink: null, content_hash: 'hash', author: { role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [] };
    const s = { id: id + '-snapshot', platform, root_post_id: id, revision: 1, observed_at: at, content_hash: 'hash', post, comments: [],
      coverage: { status: 'NOT_ATTEMPTED' }, spans: [{ id: id + '-span', entity_id: id, entity_type: 'POST', start: 0, end: text.length, text }] };
    rows.push({ ...s, sample_id: id + '-sample', snapshot_id: s.id, rank: n, as_of: at });
    conversations.push({ snapshot: s, stale: false, decision: { snapshot_id: s.id, snapshot_revision: 1, campaign_id: campaign.campaign_id,
      campaign_version: campaign.version, filter_version: campaign.filter_version, classification: 'SUITABLE', assessment_status: 'ASSESSED' } });
  }
  return { data: { campaign, conversations, watermark: { journal_sequence: 1 }, cost: { measured_cost_usd: 1 } }, rows };
}

test('prepare uses only exact frozen current top20 and rejects stale revision or changed content', () => {
  const { data, rows } = fixture();
  assert.equal(prepareFocusedAblation(data, rows, { perPlatform: 1 }).snapshots.length, 2);
  const mismatch = structuredClone(rows); mismatch[0].post.text = 'different';
  assert.throws(() => prepareFocusedAblation(data, mismatch, { perPlatform: 1 }));
  const stale = structuredClone(data); stale.conversations[0].decision.snapshot_revision = 0;
  assert.throws(() => prepareFocusedAblation(stale, rows, { perPlatform: 1 }), /FROZEN_CONTEXT/);
  assert.throws(() => prepareFocusedAblation(data, [rows[1], rows[0]], { perPlatform: 1 }), /FROZEN_CONTEXT/);
});

test('purpose cumulative cap includes metered failed unknown and unfinished calls exactly once', () => {
  const events = [{ type: 'START', invocation_id: 'old', purpose: 'primary', reserved_usd: 1 },
    { type: 'START', invocation_id: 'a', purpose: 'v2', reserved_usd: .02 },
    { type: 'FINISH', invocation_id: 'a', cost_usd: .004, unmetered_cost_upper_usd: 0 },
    { type: 'FINISH', invocation_id: 'a', cost_usd: .004, unmetered_cost_upper_usd: 0 },
    { type: 'START', invocation_id: 'b', purpose: 'v2', reserved_usd: .03 },
    { type: 'FINISH', invocation_id: 'b', cost_usd: null, unmetered_cost_upper_usd: .01 },
    { type: 'START', invocation_id: 'c', purpose: 'v2', reserved_usd: .02 }];
  assert.ok(Math.abs(purposeCostUpper(events, 'v2') - .034) < 1e-12);
  const bound = requestCostUpper({ system: 'system', input: { text: 'hello' }, schema: {}, max_output_tokens: 100 },
    { input_per_million: .3, output_per_million: 2.5 }, JSON.stringify, v => v);
  assert.ok(bound > .00055); assert.ok(bound < .001);
});

test('resume submits only technical failures and preserves all completed assessments byte-for-byte', () => {
  const { data, rows } = fixture(20), prepared = prepareFocusedAblation(data, rows);
  const audits = rows.map((r, i) => ({ snapshot_id: r.snapshot_id, sample_id: r.sample_id, as_of: r.as_of, platform: r.platform,
    rank: r.rank, version: 'v2', prompt_sha256: 'frozen', verdict: i < 24 ? 'KEEP' : 'UNRESOLVED',
    reason: i < 24 ? 'PRESERVE_CONSUMER_OPENING' : 'TECHNICAL_FAILURE',
    ...(i < 24 ? {} : { error_code: i < 32 ? 'MODEL_NETWORK_USAGE_UNKNOWN' : 'MODEL_BUDGET_ABLATION_EXHAUSTED' }) }));
  const resume = prepareFocusedResume(prepared, audits, 'v2', 'frozen');
  assert.equal(resume.snapshots.length, 16); assert.equal(resume.proposals.length, 16); assert.equal(resume.retained.size, 24);
  assert.ok(resume.snapshots.every(s => !resume.retained.has(s.id)));
  for (let i = 0; i < 24; i++) assert.equal(resume.retained.get(audits[i].snapshot_id), audits[i]);
  assert.throws(() => prepareFocusedResume(prepared, audits, 'v3', 'frozen'), /CONTEXT_MISMATCH/);
  assert.throws(() => prepareFocusedResume(prepared, audits, 'v2', 'changed'), /CONTEXT_MISMATCH/);
  const semantic = structuredClone(audits); semantic[24].reason = 'INSUFFICIENT_CONTEXT'; delete semantic[24].error_code;
  assert.equal(prepareFocusedResume(prepared, semantic, 'v2', 'frozen').snapshots.length, 15);
});

test('offline evaluation reports reference uncertainty and cannot count technical pending as removed false positive', () => {
  const refs = ['SUITABLE', 'NOT_YET', 'REFERENCE_UNRESOLVED'].map((final_label, i) => ({ sample_id: String(i), snapshot_id: String(i), as_of: 'date', final_label }));
  const audits = ['KEEP', 'UNRESOLVED', 'DOWNGRADE_NOT_YET'].map((verdict, i) => ({ sample_id: String(i), snapshot_id: String(i), as_of: 'date', platform: 'facebook', verdict }));
  const m = evaluateFocusedAblation(audits, refs).by_platform.facebook;
  assert.equal(m.retainedTP, 1); assert.equal(m.pendingFP, 1); assert.equal(m.removedFP, 0); assert.equal(m.referenceUnresolved, 1);
  assert.throws(() => evaluateFocusedAblation(audits, refs.slice(1)), /ALIGNMENT/);
});

test('plan mode validates original campaign, writes only plan and never initializes model ledgers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focused-verifier-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { data, rows } = fixture(20), input = path.join(dir, 'export.json'), bundle = path.join(dir, 'bundle'), campaign = path.join(dir, 'opportunity');
  fs.mkdirSync(bundle); fs.mkdirSync(campaign); const bytes = JSON.stringify(data);
  fs.writeFileSync(input, bytes); fs.writeFileSync(path.join(campaign, 'campaign.json'), JSON.stringify(data.campaign));
  fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({ source_export_sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
  fs.writeFileSync(path.join(bundle, 'top20-blinded-reference.jsonl'), rows.map(JSON.stringify).join('\n'));
  const result = await runFocusedAblation({ export: input, bundle, campaignDirectory: campaign, output: path.join(dir, 'plan') });
  assert.equal(result.api_calls, 0); assert.equal(result.count, 40); assert.deepEqual(fs.readdirSync(campaign), ['campaign.json']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'plan')), ['manifest.json']);
  const extendedPlan = await runFocusedAblation({ export: input, bundle, campaignDirectory: campaign, output: path.join(dir, 'extended-plan'), maxUsd: .12 });
  assert.equal(extendedPlan.max_purpose_cumulative_usd, .12);
  await assert.rejects(runFocusedAblation({ export: input, bundle, campaignDirectory: campaign, output: path.join(dir, 'invalid'), maxUsd: .121 }), /BUDGET_INVALID/);
  await assert.rejects(runFocusedAblation({ export: input, bundle, campaignDirectory: campaign, output: path.join(dir, 'reference-forbidden'), reference: 'must-not-read' }), /REFERENCE_FORBIDDEN/);
});
