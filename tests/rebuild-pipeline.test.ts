import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { unassessedGateway } from '../src/application/filter-policy.js';

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
