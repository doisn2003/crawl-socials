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
    assert.equal(pipeline.targetReached(), true); assert.equal(pipeline.discoveryStopReason('threads'), 'INTENT_TARGET_REACHED');
    const exported = await pipeline.results(); assert.equal(exported.snapshots.length, 5); assert.equal(exported.decisions.length, 0);
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
