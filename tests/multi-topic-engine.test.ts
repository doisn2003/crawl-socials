import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { compileCampaign } from '../src/application/compile-campaign.js';
import { classifyConversations } from '../src/application/classification-service.js';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { createGeminiGateway } from '../src/infrastructure/llm/gemini-gateway.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationObservation, ConversationSnapshot } from '../src/domain/conversation.js';

// Model answers are supplied fixtures. These tests exercise the production planner/classifier,
// durable cache and streaming store, not the semantic accuracy of an external model.
const topics = [
  { topic: 'tai nghe chống ồn', prompt: 'Tìm tai nghe chống ồn để làm việc, hỏi pin và độ thoải mái.',
    needs: ['pin', 'độ thoải mái'], queries: ['tai nghe chống ồn', 'review tai nghe', 'tai nghe pin', 'tìm tai nghe'],
    post: 'Cửa hàng vừa giới thiệu tai nghe chống ồn mới.', comment: 'Mình cần tai nghe để họp trực tuyến.',
    reply: 'Pin dùng liên tục bao lâu và đeo cả ngày có đau tai không?' },
  { topic: 'khách sạn gia đình', prompt: 'Tìm khách sạn cho gia đình có trẻ nhỏ, hỏi phòng yên tĩnh và giờ nhận phòng.',
    needs: ['phòng yên tĩnh', 'giờ nhận phòng'], queries: ['tìm khách sạn', 'khách sạn gia đình', 'khách sạn trẻ nhỏ', 'review khách sạn'],
    post: 'Khách sạn giới thiệu phòng mới cho gia đình.', comment: 'Nhà mình đi cùng trẻ nhỏ.',
    reply: 'Phòng cách âm có tốt không, có thể nhận phòng sớm không?' },
  { topic: 'khóa học tiếng Anh', prompt: 'Tìm khóa học tiếng Anh buổi tối cho người đi làm, cần học bù.',
    needs: ['buổi tối', 'học bù'], queries: ['khóa học tiếng Anh', 'tiếng Anh buổi tối', 'hỏi học bù', 'review khóa học'],
    post: 'Trung tâm mở lớp tiếng Anh buổi tối.', comment: 'Mình đang tìm khóa học cho người đi làm.',
    reply: 'Nếu đổi ca làm thì có được học bù vào buổi khác không?' },
  { topic: 'quán cafe làm việc', prompt: 'Tìm quán cafe yên tĩnh để làm việc, hỏi ổ điện và wifi.',
    needs: ['yên tĩnh', 'ổ điện', 'wifi'], queries: ['tìm quán cafe', 'cafe yên tĩnh', 'cafe làm việc', 'hỏi wifi'],
    post: 'Quán giới thiệu không gian làm việc mới.', comment: 'Mình muốn đến làm việc với máy tính.',
    reply: 'Có ổ điện tại bàn và wifi đủ để họp trực tuyến không?' },
] as const;
type Topic = typeof topics[number];
type WireConversation = { snapshot_id: string; post: { entity_id: string }; comments: Array<{ entity_id: string; parent_id: string }>;
  spans: Array<{ id: string; entity_id: string; text: string }> };
type WireInput = { prompt?: string; campaign?: { prompt: string; topic: string; needs: string[]; required_geographies: string[] };
  conversations?: WireConversation[] };
const at = '2026-10-30T10:00:00Z';

function plannerValue(topic: Topic) {
  return { topic: topic.topic, audience: ['người dùng dịch vụ hoặc sản phẩm'], needs: [...topic.needs],
    participation_intents: ['trả lời câu hỏi sử dụng'], research_intents: ['tìm hiểu tiêu chí lựa chọn'],
    inclusions: ['câu hỏi người dùng', 'trải nghiệm sử dụng'], exclusions: ['ngoài chủ đề'], assumptions: [],
    queries: [...topic.queries.map(text => ({ text, family: 'REQUEST' })), { text: 'du thuyền SaoBắc', family: 'BROAD' }] };
}
function classificationValue(row: WireConversation, caseCode = 'OPPORTUNITY_REQUEST') {
  const target = row.comments.at(-1)?.entity_id ?? row.post.entity_id;
  const first = row.spans.find(s => s.entity_id === target)!;
  return { snapshot_id: row.snapshot_id, case_code: caseCode, evidence_ids: [first.id], need_summary: 'Kết quả fixture được xác định độc lập với phần mềm.' };
}
function harness(directory: string, classify: (input: WireInput, row: WireConversation) => ReturnType<typeof classificationValue>) {
  const seen: WireInput[] = [];
  const gateway = createGeminiGateway({ directory, budgetUsd: 3, apiKey: 'synthetic-not-a-real-key', minRequestIntervalMs: 0, maxAttempts: 1,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const input = JSON.parse(body.contents[0]!.parts[0]!.text) as WireInput; seen.push(input);
      const value = input.conversations ? input.conversations.map(row => classify(input, row)) : plannerValue(topics.find(t => t.prompt === input.prompt)!);
      return new Response(JSON.stringify({ modelVersion: 'synthetic-fixture', candidates: [{ finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 } }), { status: 200 });
    } });
  return { gateway, seen };
}
function snapshot(topic: Topic): ConversationSnapshot {
  const entity = (id: string, text: string, parent: string | null): ConversationEntity => ({ entity_id: id,
    entity_type: parent ? 'COMMENT' : 'POST', root_post_id: 'root-common', parent_id: parent, text,
    observed_at: at, published_at: null, permalink: null, author: { role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [], content_hash: contentHash(text) });
  const post = entity('root-common', topic.post, null), comments = [entity('comment-parent', topic.comment, post.entity_id),
    entity('comment-target', topic.reply, 'comment-parent')];
  return { id: 'snapshot-' + contentHash([post, comments]), platform: 'threads', root_post_id: post.entity_id,
    revision: 1, observed_at: at, content_hash: contentHash([post, comments]), post, comments,
    coverage: { status: 'PARTIAL', observed_count: 2, has_more: true }, spans: [post, ...comments].flatMap(e => evidenceSpans(e)) };
}
function cleanup(directory: string) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-multitopic-'));
  rmSync(directory, { recursive: true, force: true });
}

test('primary planner-to-classifier flow preserves four topic intents and nested comment targets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-multitopic-'));
  try {
    const transport = harness(directory, (_input, row) => classificationValue(row));
    for (const topic of topics) {
      const { campaign } = await compileCampaign({ prompt: topic.prompt }, transport.gateway);
      assert.equal(campaign.topic, topic.topic); assert.deepEqual(campaign.needs, [...topic.needs]);
      assert.deepEqual(campaign.queries.map(q => q.text), [...topic.queries]); // Unsupported invented anchor removed, actual topic retained.
      assert.equal(campaign.target_scope, 'TOTAL_ACROSS_PLATFORMS'); assert.equal(campaign.suitable_target, 1000);
      const s = snapshot(topic), result = await classifyConversations(campaign, [s], transport.gateway);
      const decision = result.decisions[0]!;
      assert.equal(decision.classification, 'SUITABLE'); assert.equal(decision.campaign_version, campaign.version);
      assert.deepEqual(decision.action_target, { entity_id: 'comment-target', type: 'COMMENT' });
      const sent = transport.seen.at(-1)!;
      assert.equal(sent.campaign!.prompt, topic.prompt); assert.deepEqual(sent.campaign!.needs, [...topic.needs]);
      assert.deepEqual(sent.campaign!.required_geographies, []);
      assert.equal(sent.conversations![0]!.comments[1]!.parent_id, 'comment-parent');
      assert.equal(sent.conversations![0]!.comments[0]!.parent_id, 'root-common');
      assert.ok(decision.evidence_ids.every(id => s.spans.some(span => span.id === id && span.entity_id === 'comment-target')));
      if (topic !== topics[3]) assert.ok(!/cafe|cà phê/iu.test(JSON.stringify(sent)), topic.topic);
    }
    assert.equal(transport.seen.length, 8); // Real gateway transport boundary, no external network.
  } finally { cleanup(directory); }
});

test('durable semantic cache separates different prompts and rebinds cached output to the requesting campaign', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-multitopic-'));
  try {
    const transport = harness(directory, (input, row) => classificationValue(row,
      input.campaign!.prompt === topics[0].prompt ? 'OPPORTUNITY_REQUEST' : 'UNRELATED_TOPIC'));
    const a = (await compileCampaign({ campaign_id: 'campaign-a', prompt: topics[0].prompt }, transport.gateway)).campaign;
    const b = (await compileCampaign({ campaign_id: 'campaign-a', prompt: topics[1].prompt }, transport.gateway)).campaign;
    const s = snapshot(topics[0]);
    const first = await classifyConversations(a, [s], transport.gateway), different = await classifyConversations(b, [s], transport.gateway);
    assert.equal(first.decisions[0]!.classification, 'SUITABLE'); assert.equal(different.decisions[0]!.classification, 'UNRELATED');
    assert.notEqual(a.version, b.version); assert.notEqual(first.model_results[0]!.request_hash, different.model_results[0]!.request_hash);
    const sameIntentOtherCampaign = (await compileCampaign({ campaign_id: 'campaign-b', prompt: topics[0].prompt }, transport.gateway)).campaign;
    const restarted = createGeminiGateway({ directory, budgetUsd: 3, apiKey: 'synthetic-unused', fetch: async () => { throw Error('CACHE_MUST_PREVENT_NETWORK'); } });
    const reused = await classifyConversations(sameIntentOtherCampaign, [s], restarted);
    assert.equal(reused.model_results[0]!.cache_hit, true); assert.equal(reused.decisions[0]!.campaign_id, 'campaign-b');
    assert.equal(reused.decisions[0]!.campaign_version, sameIntentOtherCampaign.version);
    assert.notEqual(reused.decisions[0]!.campaign_version, first.decisions[0]!.campaign_version);
    assert.equal(transport.seen.length, 4); // Planner and classifier caches reuse semantics, never stored decision identity.
  } finally { cleanup(directory); }
});

test('streaming primary flow revises comment evidence while keeping same-root decisions isolated by campaign', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-multitopic-'));
  const transport = harness(join(directory, 'model'), (input, row) => classificationValue(row,
    input.campaign!.prompt === topics[1].prompt ? 'UNRELATED_TOPIC' : row.comments.length ? 'OPPORTUNITY_REQUEST' : 'RELATED_PROMOTION'));
  const product = (await compileCampaign({ campaign_id: 'shared-campaign-id', prompt: topics[0].prompt }, transport.gateway)).campaign;
  const travel = (await compileCampaign({ campaign_id: 'shared-campaign-id', prompt: topics[1].prompt }, transport.gateway)).campaign;
  const context = (plan: typeof product) => ({ campaign_id: plan.campaign_id, campaign_version: plan.version, filter_version: plan.filter_version });
  const pipeline = await createOpportunityPipeline({ directory: join(directory, 'pipeline'), runId: 'stream-test', campaign: product,
    config: { enabled: true, prompt: product.prompt, brandContext: '', totalTarget: 1000, threadsShare: .8, rawCap: 3000, budgetUsd: 3, commentsEnabled: false },
    platforms: ['threads'], gateway: transport.gateway, collectConversation: async () => { throw Error('NO_BROWSER_IN_TEST'); } });
  const root: ConversationObservation = { platform: 'threads', entity_type: 'POST', entity_id: 'root-stream', root_post_id: 'root-stream', parent_id: null,
    text: topics[0].post, observed_at: at, provenance: { run_id: 'stream-test', method: 'SYNTHETIC_OBSERVATION' } };
  try {
    await pipeline.ingest([root]); await pipeline.drain();
    const firstSnapshot = (await pipeline.store.snapshot('threads', 'root-stream'))!;
    assert.equal((await pipeline.store.results(context(product)))[0]!.decision.classification, 'NOT_YET');
    const otherInitial = await classifyConversations(travel, [firstSnapshot], transport.gateway);
    await pipeline.store.recordDecision(otherInitial.decisions[0]!);
    await pipeline.ingest([{ ...root, entity_type: 'COMMENT', entity_id: 'comment-stream', parent_id: 'root-stream', text: topics[0].reply,
      observed_at: '2026-10-30T10:01:00Z' }]); await pipeline.drain();
    const updated = (await pipeline.store.snapshot('threads', 'root-stream'))!;
    assert.ok(updated.revision > firstSnapshot.revision); assert.equal(updated.post!.text, firstSnapshot.post!.text);
    assert.equal((await pipeline.store.results(context(travel))).length, 0); // Old unrelated decision is stale until evaluated on new evidence.
    const otherUpdated = await classifyConversations(travel, [updated], transport.gateway);
    await pipeline.store.recordDecision(otherUpdated.decisions[0]!);
    const [productRows, travelRows] = await Promise.all([pipeline.store.results(context(product)), pipeline.store.results(context(travel))]);
    assert.equal(productRows[0]!.decision.classification, 'SUITABLE'); assert.equal(travelRows[0]!.decision.classification, 'UNRELATED');
    assert.equal(productRows[0]!.snapshot.id, travelRows[0]!.snapshot.id);
    assert.deepEqual(productRows[0]!.decision.action_target, { entity_id: 'comment-stream', type: 'COMMENT' });
    assert.ok(productRows[0]!.decision.evidence_ids.every(id => updated.spans.some(span => span.id === id && span.entity_id === 'comment-stream')));
    const history = await pipeline.store.decisionHistory(context(product));
    assert.ok(history.some(d => d.classification === 'NOT_YET' && d.snapshot_id === firstSnapshot.id));
    assert.ok(history.some(d => d.classification === 'SUITABLE' && d.snapshot_id === updated.id));
    const output = await pipeline.results(); assert.equal(output.progress.counts.raw, 1); assert.equal(output.progress.counts.suitable, 1);
    assert.equal(output.conversations.every(row => row.decision.campaign_version === product.version), true);
  } finally { await pipeline.close(); cleanup(directory); }
});
