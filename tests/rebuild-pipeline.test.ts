import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { unassessedGateway } from '../src/application/filter-policy.js';
import { withFilterPolicy } from '../src/application/filter-policy.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';

test('OFF collects a global target from one source, persists extras/resume, and never invokes AI or enrichment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-rebuild-'));
  let calls = 0, comments = 0;
  const input = { directory, runId: 'free-test', config: { enabled: true, prompt: '', brandContext: '', filterMode: 'OFF' as const,
    totalTarget: 3, rawCap: 20, budgetUsd: 0, commentsEnabled: true }, platforms: ['facebook', 'threads'] as ('facebook' | 'threads')[],
    seedQueries: ['học piano'], gateway: { ...unassessedGateway, generateJson: async () => { calls++; throw Error('NO_AI'); } },
    collectConversation: async () => { comments++; } };
  let pipeline: Awaited<ReturnType<typeof createOpportunityPipeline>> | undefined;
  try {
    pipeline = await createOpportunityPipeline(input);
    const posts = Array.from({ length: 5 }, (_, i) => ({ post_id: String(i + 1), text: 'bài ' + i, query: 'học piano' }));
    await pipeline.ingestRows('facebook', [...posts, posts[0]!], {});
    await pipeline.drain();
    assert.equal(calls, 0); assert.equal(comments, 0); assert.equal(pipeline.progress().costUsd, 0);
    assert.equal(pipeline.progress().counts.raw, 5); assert.equal(pipeline.progress().counts.suitable, 0);
    assert.equal(pipeline.progress().targetCount, 3); assert.equal(pipeline.progress().extraCount, 2);
    assert.equal(pipeline.progress().preview.length, 3);
    assert.ok(pipeline.progress().preview.every(row => row.classification === 'UNASSESSED'));
    assert.equal(pipeline.targetReached(), true); assert.equal(pipeline.discoveryStopReason('threads'), 'INTENT_TARGET_REACHED');
    const exported = await pipeline.results(); assert.equal(exported.snapshots.length, 5); assert.equal(exported.decisions.length, 0);
    assert.equal(exported.progress.preview.length, 3);
    const selection = exported.selection;
    await pipeline.close(); pipeline = await createOpportunityPipeline(input);
    assert.deepEqual((await pipeline.results()).selection, selection);
    assert.equal(calls, 0);
  } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('model budget pause leaves new raw collection usable with a durable pending queue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-rebuild-')); let calls = 0;
  const campaign = withFilterPolicy(literalCampaign({ prompt: 'Tìm người học piano', seed_queries: ['học piano'], suitable_target: 10, raw_cap: 30, model_usd: 0.1 }), 'STANDARD');
  const pipeline = await createOpportunityPipeline({ directory, runId: campaign.campaign_id, campaign,
    config: { enabled: true, prompt: campaign.prompt, brandContext: '', filterMode: 'STANDARD', totalTarget: 10, rawCap: 30, budgetUsd: .1, commentsEnabled: false },
    platforms: ['facebook', 'threads'], collectConversation: async () => {}, gateway: { ...unassessedGateway,
      generateJson: async () => { calls++; throw new ModelGatewayError('MODEL_GLOBAL_BUDGET_EXHAUSTED'); } } });
  try {
    await pipeline.ingestRows('facebook', [{ post_id: '1', text: 'Con tôi muốn học piano' }], {}); await pipeline.drain();
    assert.equal(calls, 1); assert.equal(pipeline.progress().phase, 'MODEL_PAUSED'); assert.equal(pipeline.discoveryStopReason('facebook'), null);
    await pipeline.ingestRows('threads', [{ post_id: '2', text: 'Nên mua đàn piano nào' }], {});
    assert.equal(pipeline.progress().counts.raw, 2); assert.equal(pipeline.progress().counts.pending, 2); assert.equal(calls, 1);
  } finally { await pipeline.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('global admission uses durable arrival/assessment order, independent of dates and platform', () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-admission-'));
  const store = createConversationStore(directory), context = { campaign_id: 'a', campaign_version: '1', filter_version: 'coverage-standard-v1' };
  try {
    const add = (id: string, platform: 'facebook' | 'threads', day: string, ctx = context) => store.ingest({ platform, entity_type: 'POST', entity_id: id,
      root_post_id: id, parent_id: null, text: id, observed_at: day, provenance: { run_id: 'a', method: 'FIXTURE' } }, ctx).snapshot!;
    const first = add('first', 'facebook', '2026-11-03T00:00:00Z');
    const second = add('second', 'threads', '2026-11-01T00:00:00Z');
    add('other-campaign', 'threads', '2026-10-01T00:00:00Z', { ...context, campaign_id: 'b' });
    const offContext = context;
    assert.deepEqual(store.selectTarget(offContext, 1, true).target.map(r => r.rootId), ['first']);
    assert.deepEqual(store.selectTarget(offContext, 1, true).extra.map(r => r.rootId), ['second']);
    const filtered = { ...context, filter_version: 'quality-test' };
    for (const snapshot of [second, first]) store.recordDecision({ ...filtered, snapshot_id: snapshot.id, classification: 'SUITABLE',
      assessment_status: 'ASSESSED', reason_code: 'COVERAGE_DIRECT', evidence_ids: [snapshot.spans[0]!.id], model: 'fixture', attributes: { signal_strength: 3 } });
    assert.deepEqual(store.selectTarget(filtered, 1).target.map(r => r.rootId), ['second']);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
