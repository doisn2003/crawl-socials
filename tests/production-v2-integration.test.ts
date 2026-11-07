import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy, unassessedGateway } from '../src/application/filter-policy.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';
import type { WebContents } from 'electron';
import ExcelJS from 'exceljs';
import { deliveredOpportunityRoots, exportOpportunityWorkbook, selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';

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


test('keyword comments follow final rejected roots, keep the best 20 and never reach post assessment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-keyword-comments-'));
  const campaign = withFilterPolicy(literalCampaign({ prompt: 'Tìm thảo luận và nhu cầu học piano',
    seed_queries: ['piano', 'học piano'], suitable_target: 2, raw_cap: 30, model_usd: 3 }), 'STANDARD');
  const modelInputs: string[] = [], captured: string[] = [];
  const gateway: ModelGateway = { ...unassessedGateway, async generateJson(request) {
    assert.equal(request.purpose, 'opportunity-post-evidence-v1');
    modelInputs.push(JSON.stringify(request.input));
    const posts = (request.input as { posts: { i: number; spans: { text: string }[] }[] }).posts;
    return { value: posts.map(post => {
      const accepted = post.spans.some(span => span.text.includes('HỢP_LỆ'));
      return { i: post.i, topic: accepted ? 'RELATED' : 'UNRELATED', promotion: 'NO', actor: 'CONSUMER',
        opportunities: accepted ? ['DISCUSSION'] : [], usefulness: 'CONCRETE', goal_fit: accepted ? 'EXACT' : 'NONE',
        hard: 'PASS', time: 'UNBOUNDED', ev: [0], why: 'Kết quả giả lập', flags: [] };
    }), invocation_id: 'mock', request_hash: 'mock', model: 'mock', model_version: null, usage: null,
    cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
    price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'mock', source: 'mock' } };
  } };
  let opened!: () => void, release!: () => void;
  const openedPromise = new Promise<void>(resolve => { opened = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  let pipeline: Awaited<ReturnType<typeof createOpportunityPipeline>> | undefined;
  const input: Parameters<typeof createOpportunityPipeline>[0] = {
    directory, runId: campaign.campaign_id, campaign, gateway,
    config: { enabled: true, prompt: campaign.prompt, brandContext: '', filterMode: 'STANDARD',
      totalTarget: 2, rawCap: 30, budgetUsd: 3, commentsEnabled: true },
    platforms: ['facebook'],
    async withKeywordCommentWindow(platform, shouldStop, work) {
      assert.equal(platform, 'facebook'); assert.equal(shouldStop(), false);
      await work({} as WebContents);
    },
    async collectConversation(request) {
      captured.push(request.root.id);
      await request.beforeNextPage?.();
      assert.equal(request.maxComments, 20);
      opened(); await hold;
      if (request.shouldStop()) return { coverage: { status: 'NOT_ATTEMPTED', stop_reason: 'USER_STOP' } };
      const comment = (i: number, text: string, like_count = i, root = '3') => ({
        platform: 'facebook' as const, entity_type: 'COMMENT' as const, entity_id: String(100 + i), root_post_id: root,
        parent_id: root, text, like_count, observed_at: new Date().toISOString(),
        provenance: { run_id: campaign.campaign_id, method: 'FIXTURE' },
      });
      await request.onObservations([
        ...Array.from({ length: 25 }, (_, i) => comment(i, 'Toi muon hoc piano. COMMENT_SENTINEL')),
        comment(24, 'Tôi muốn học piano. COMMENT_SENTINEL', 50),
        comment(30, 'Tôi muốn nói về pianola', 1000),
        comment(31, 'Tôi muốn học piano', 1000, '99'),
      ]);
      return { coverage: { status: 'PARTIAL', stop_reason: 'COMMENT_BUDGET' } };
    },
  };
  const post = (post_id: string, text: string, comments_count: number) =>
    ({ post_id, text, post_url: 'https://www.facebook.com/posts/' + post_id, comments_count });
  try {
    pipeline = await createOpportunityPipeline(input);
    await pipeline.ingestRows('facebook', [
      post('1', 'HỢP_LỆ Tôi muốn chia sẻ kinh nghiệm học piano', 12),
      post('2', 'Tôi muốn chia sẻ cách nấu cơm', 0),
      post('3', 'Tôi muốn chia sẻ cách nấu cháo', 24),
      post('4', '', 10),
    ], {});
    await pipeline.drain();
    assert.deepEqual((await pipeline.store.jobs()).filter(job => job.type === 'MATCH_COMMENTS').map(job => job.payload.root_post_id), ['3']);
    await openedPromise;
    await pipeline.ingestRows('facebook', [post('5', 'HỢP_LỆ Tôi đang tập piano và muốn chia sẻ kinh nghiệm', 8)], {});
    await pipeline.drain();
    assert.equal(pipeline.progress().counts.suitable, 2, 'post work continues with the comment browser still occupied');
    assert.equal(pipeline.progress().commentsPending, 1);
    const stopping = pipeline.stop(); release(); await stopping;
    assert.equal(pipeline.progress().commentsPending, 1);
    await pipeline.close(); pipeline = await createOpportunityPipeline(input);
    await pipeline.drain(); await pipeline.drainKeywordComments();
    assert.deepEqual(captured, ['3', '3'], 'only the interrupted capture is retried');
    assert.equal(pipeline.progress().counts.comments, 20);
    assert.equal(pipeline.progress().commentsPending, 0);
    assert.ok(modelInputs.every(value => !value.includes('COMMENT_SENTINEL')));
    const result = await pipeline.results(), comments = result.keyword_comments![0]!.comments;
    assert.equal(comments.length, 20);
    assert.equal(comments[0]!.comment_id, '124');
    assert.equal(comments[0]!.likes, 50);
    assert.equal(comments.at(-1)!.comment_id, '105');
    assert.ok(result.snapshots.every(snapshot => !snapshot.comments.length));
    assert.equal(result.conversations.find(item => item.snapshot.root_post_id === '3')?.decision.classification, 'NOT_SUITABLE');
    const selected = selectOpportunityExport(result, 'SUITABLE');
    assert.deepEqual(deliveredOpportunityRoots(selected).sort(), ['facebook:1', 'facebook:5']);
    assert.equal(selected.keyword_comments?.[0]?.root_post_id, '3');
    assert.equal(selectOpportunityExport(result, 'SUITABLE', ['facebook:3']).keyword_comments?.length, 0);
    const file = join(directory, 'comments.xlsx');
    await exportOpportunityWorkbook(file, selected);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
    assert.equal(workbook.getWorksheet('Matched Comments')!.rowCount, 21);
    assert.equal(workbook.getWorksheet('Matched Comments')!.getCell('B2').value, '3');
    const calls = modelInputs.length;
    await pipeline.close(); pipeline = await createOpportunityPipeline(input); await pipeline.drain(); await pipeline.drainKeywordComments();
    assert.deepEqual(captured, ['3', '3']);
    assert.equal(modelInputs.length, calls);
    assert.deepEqual((await pipeline.results()).keyword_comments, result.keyword_comments);
  } finally { release(); await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
});
