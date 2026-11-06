import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy, unassessedGateway } from '../src/application/filter-policy.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';
import { deliveredOpportunityRoots, selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';

test('post-only pipeline skips delivered roots before AI, keeps extras and resumes without counting or delivering them twice', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-v2-integration-'));
  let calls = 0, assessed = 0, captures = 0;
  const campaign = withFilterPolicy(literalCampaign({ prompt: 'Tìm thảo luận và nhu cầu học piano', seed_queries: ['học piano'], suitable_target: 2, raw_cap: 30, model_usd: 3 }), 'CONSISTENT');
  const gateway: ModelGateway = { ...unassessedGateway, async generateJson(request) {
    calls++; assert.equal(request.purpose, 'opportunity-post-evidence-v1');
    assert.ok(!JSON.stringify(request.input).includes('ALREADY_DELIVERED'));
    assert.ok(!JSON.stringify(request.input).includes('COMMENT_SENTINEL'));
    const posts = (request.input as { posts: { i: number }[] }).posts; assessed += posts.length;
    return { value: posts.map(p => ({ i: p.i, topic: 'RELATED', promotion: 'NO', actor: 'CONSUMER', opportunities: ['DISCUSSION'],
      usefulness: 'CONCRETE', goal_fit: 'EXACT', hard: 'PASS', time: 'UNBOUNDED', ev: [0], why: 'Trao đổi về việc học piano', flags: [] })),
      invocation_id: 'mock', request_hash: 'mock', model: 'mock', model_version: null, usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0,
      cache_hit: false, elapsed_ms: 0, price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'mock', source: 'mock' } };
  } };
  const input = { directory, runId: campaign.campaign_id, campaign, gateway, excludedRootKeys: ['facebook:old'],
    config: { enabled: true, prompt: campaign.prompt, brandContext: '', filterMode: 'CONSISTENT' as const, totalTarget: 2, rawCap: 30, budgetUsd: 3, commentsEnabled: true },
    platforms: ['facebook', 'threads'] as ('facebook' | 'threads')[], collectConversation: async () => { captures++; } };
  let pipeline: Awaited<ReturnType<typeof createOpportunityPipeline>> | undefined;
  try {
    pipeline = await createOpportunityPipeline(input);
    await pipeline.ingestRows('facebook', [{ post_id: 'old', text: 'ALREADY_DELIVERED Tôi muốn học piano' },
      ...['one', 'two', 'three'].map(post_id => ({ post_id, text: 'Tôi muốn trao đổi kinh nghiệm học piano ' + post_id, published_at: '2015-01-01T00:00:00Z' })),
      { post_id: 'comment', root_post_id: 'one', entity_type: 'COMMENT', text: 'COMMENT_SENTINEL' }], {});
    await pipeline.drain();
    assert.equal(assessed, 3); assert.equal(captures, 0);
    assert.equal(pipeline.progress().counts.raw, 4); assert.equal(pipeline.progress().counts.comments, 0);
    assert.equal(pipeline.progress().counts.pending, 0); assert.equal(pipeline.progress().previouslyDelivered, 1);
    assert.equal(pipeline.progress().targetCount, 2); assert.equal(pipeline.progress().extraCount, 1);
    const result = await pipeline.results();
    const selected = selectOpportunityExport(result, 'SUITABLE');
    assert.equal(selected.snapshots.length, 2); assert.equal(deliveredOpportunityRoots(selected).length, 2);
    const customerAll = selectOpportunityExport(result, undefined, ['facebook:old']);
    assert.equal(customerAll.snapshots.length, 3); assert.equal(deliveredOpportunityRoots(customerAll).length, 3);
    assert.equal(result.snapshots.length, 4, 'raw evidence remains complete');
    assert.ok(result.progress.preview.every(p => p.publishedAt === '2015-01-01T00:00:00Z'));
    const originalCalls = calls, selection = result.selection;
    await pipeline.close(); pipeline = await createOpportunityPipeline(input); await pipeline.drain();
    assert.equal(calls, originalCalls); assert.equal(pipeline.progress().previouslyDelivered, 1); assert.equal(pipeline.progress().counts.pending, 0);
    assert.deepEqual((await pipeline.results()).selection, selection);
  } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('OFF delivery records every exported raw root including extras, rejects classified exports and omits earlier deliveries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-v2-off-export-'));
  const pipeline = await createOpportunityPipeline({ directory, runId: 'off-delivery', seedQueries: ['piano'],
    config: { enabled: true, prompt: '', brandContext: '', filterMode: 'OFF', totalTarget: 1, rawCap: 10, budgetUsd: 0, commentsEnabled: false },
    platforms: ['facebook'], gateway: unassessedGateway, collectConversation: async () => {} });
  try {
    await pipeline.ingestRows('facebook', ['1', '2', '3'].map(post_id => ({ post_id, text: 'Bài piano ' + post_id })), {}); await pipeline.drain();
    const raw = await pipeline.results(); assert.equal(raw.selection?.target.length, 1);
    assert.deepEqual(deliveredOpportunityRoots(selectOpportunityExport(raw)), ['facebook:1', 'facebook:2', 'facebook:3']);
    assert.throws(() => selectOpportunityExport(raw, 'SUITABLE'), /OFF_EXPORT_CLASSIFICATION_INVALID/);
    assert.deepEqual(deliveredOpportunityRoots(selectOpportunityExport(raw, undefined, ['facebook:1'])), ['facebook:2', 'facebook:3']);
  } finally { await pipeline.close(); rmSync(directory, { recursive: true, force: true }); }
});
