import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash, evidenceSpans, type ConversationEntity, type ConversationSnapshot } from '../src/domain/conversation.js';
import { postOnlyEvidenceView } from '../src/domain/post-only-evidence.js';
import { opportunityPolicy, type OpportunityEvidence } from '../src/domain/opportunity-evidence.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { withFilterPolicy, unassessedGateway } from '../src/application/filter-policy.js';
import { classifyConversations, classifierRecipe } from '../src/application/classification-service.js';
import { POST_EVIDENCE_VERSION, POST_EVIDENCE_SYSTEM } from '../src/application/opportunity-post-classifier.js';
import { FILTER_MODES, FILTER_VERSIONS, type FilterMode } from '../src/shared/filter-policy.js';
import type { JsonModelRequest, JsonModelResult, ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';

function snapshot(text: string, id = 'post'): ConversationSnapshot {
  const post: ConversationEntity = { entity_id: id, entity_type: 'POST', root_post_id: id, parent_id: null,
    text, observed_at: '2026-11-06T00:00:00Z', published_at: '2020-01-01T00:00:00Z', permalink: null,
    author: {}, source: { kind: 'PROFILE' }, media: [], content_hash: contentHash(text) };
  return { id: 'snapshot-' + id, platform: 'facebook', root_post_id: id, revision: 1,
    content_hash: post.content_hash, observed_at: post.observed_at, post, comments: [], coverage: { status: 'NOT_ATTEMPTED' }, spans: evidenceSpans(post) };
}
function withComment(source: ConversationSnapshot, text: string): ConversationSnapshot {
  const comment = { ...source.post!, entity_id: 'comment', entity_type: 'COMMENT' as const, parent_id: source.root_post_id, text, content_hash: contentHash(text) };
  return { ...source, id: source.id + '-comments', revision: 2, comments: [comment], coverage: { status: 'PARTIAL', observed_count: 1 }, spans: [...source.spans, ...evidenceSpans(comment)] };
}
const fact = (i: number, overrides: Partial<OpportunityEvidence> = {}): OpportunityEvidence => ({ i, topic: 'RELATED', promotion: 'NO', actor: 'CONSUMER',
  opportunities: ['DIRECT_NEED'], usefulness: 'CONCRETE', goal_fit: 'EXACT', hard: 'PASS', time: 'UNBOUNDED', ev: [0], why: 'Có bằng chứng trong bài gốc', flags: [], ...overrides });
const result = (value: unknown): JsonModelResult => ({ value, model: 'fixture', model_version: null, invocation_id: 'test', request_hash: 'test',
  usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
  price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: '', source: 'FIXTURE' } });
function model(reply: (request: JsonModelRequest, call: number) => unknown) {
  const requests: JsonModelRequest[] = [];
  const gateway: ModelGateway = { summary: () => ({ ...unassessedGateway.summary(), model: 'fixture' }), generateJson: async request => {
    requests.push(request); return result(reply(request, requests.length));
  } };
  return { gateway, requests };
}
const plan = (mode: FilterMode) => withFilterPolicy(literalCampaign({ prompt: 'Tìm người có nhu cầu đi spa, chăm sóc sắc đẹp', seed_queries: ['spa'] }), mode);

test('four named policies retain weak personal beauty wishes in Standard without inventing purchase intent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-policy-'));
  try {
    const snapshots = [snapshot('Tôi muốn tìm spa chăm sóc da', 'direct'), snapshot('Ước gì mình xinh đẹp hơn một chút', 'wish'),
      snapshot('Mình thích đọc những câu chuyện trong cộng đồng chăm da', 'interest'), snapshot('Spa nhà em ưu đãi hôm nay', 'ad'), snapshot('Hôm nay trời đẹp', 'other')];
    const facts = [fact(0), fact(1, { opportunities: ['PERSONAL_DESIRE'], usefulness: 'POSSIBLE', goal_fit: 'RELATED' }),
      fact(2, { opportunities: ['INTEREST'], usefulness: 'POSSIBLE', goal_fit: 'RELATED' }),
      fact(3, { promotion: 'YES', actor: 'PROVIDER', opportunities: [], usefulness: 'NONE', goal_fit: 'NONE' }),
      fact(4, { topic: 'UNRELATED', opportunities: [], usefulness: 'NONE', goal_fit: 'NONE' })];
    const mock = model(request => (request.input as { posts: { i: number; spans: { text: string }[] }[] }).posts.map(p => {
      const index = snapshots.findIndex(s => s.post!.text === p.spans[0]!.text);
      return { ...facts[index]!, i: p.i };
    })), options = { assessmentCacheDirectory: root, evaluatedAt: '2026-11-06T00:00:00Z' };
    for (const [mode, wanted] of [['CONSISTENT', [true, true, true, false, false]], ['STANDARD', [true, true, false, false, false]], ['QUALITY', [true, false, false, false, false]]] as const) {
      const response = await classifyConversations(plan(mode), snapshots, mock.gateway, options);
      assert.deepEqual(response.decisions.map(d => d.classification === 'SUITABLE'), wanted);
      assert.equal(response.decisions[1]!.intents?.includes('DIRECT_NEED'), false);
    }
    // Commercial raw-text cue triggers a single Quality review for the advertising post only.
    assert.equal(mock.requests[0]!.purpose, POST_EVIDENCE_VERSION);
    assert.equal(mock.requests.filter(r => r.purpose === POST_EVIDENCE_VERSION).length, 1);
    assert.deepEqual(FILTER_MODES, ['OFF', 'CONSISTENT', 'STANDARD', 'QUALITY']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Quality accepts explicitly requested discussion and one factual reading yields nested policies', async () => {
  const campaign = plan('QUALITY'); campaign.prompt = 'Tìm thảo luận và trải nghiệm chăm sóc da để nghiên cứu';
  const v = fact(0, { opportunities: ['DISCUSSION', 'EXPERIENCE'] });
  const mock = model(() => [v]);
  const out = await classifyConversations(campaign, [snapshot('Mình đã thử chăm da ở nhà và thấy da bớt khô')], mock.gateway);
  assert.equal(out.decisions[0]!.classification, 'SUITABLE');
  assert.deepEqual(out.decisions[0]!.intents, ['DISCUSSION', 'EXPERIENCE']);
  for (const topic of ['RELATED', 'ADJACENT', 'UNRELATED', 'UNKNOWN'] as const) for (const useful of ['CONCRETE', 'POSSIBLE', 'NONE', 'UNKNOWN'] as const) {
    const f = { ...v, topic, usefulness: useful };
    const values = ['CONSISTENT', 'STANDARD', 'QUALITY'].map(mode => opportunityPolicy(mode as FilterMode, f).classification === 'SUITABLE');
    assert.ok(!values[2] || values[1]); assert.ok(!values[1] || values[0]);
  }
});

test('post-only model input and cache exclude old comments, metadata and source delivery count', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-cache-'));
  try {
    const source = snapshot('Mình muốn tìm spa chăm sóc da'), enriched = withComment(source, 'SECRET_COMMENT_TEXT');
    const mock = model(request => { assert.ok(!JSON.stringify(request).includes('SECRET_COMMENT_TEXT')); return [fact(0)]; });
    const first = plan('STANDARD'), options = { assessmentCacheDirectory: root, evaluatedAt: '2026-11-06T00:00:00Z' };
    await classifyConversations(first, [source], mock.gateway, options);
    const changed = { ...plan('CONSISTENT'), suitable_target: 5000, budget: { ...first.budget, raw_cap: 50000 } };
    const second = await classifyConversations(changed, [enriched], mock.gateway, { ...options, evaluatedAt: '2026-11-08T00:00:00Z' });
    assert.equal(mock.requests.length, 1); assert.equal(second.decisions[0]!.snapshot_id, enriched.id);
    assert.deepEqual(second.decisions[0]!.action_target, { entity_id: 'post', type: 'POST' });
    assert.deepEqual(second.decisions[0]!.evidence_ids, [source.spans[0]!.id]);
    assert.equal(postOnlyEvidenceView(source).content_hash, postOnlyEvidenceView(enriched).content_hash);
    assert.equal(enriched.comments.length, 1, 'raw stored comments remain untouched');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Vietnamese comments cannot rescue a foreign post and comment-only roots never reach the model', async () => {
  const foreign = withComment(snapshot('I am looking for a good skincare clinic in this neighborhood.'), 'Mình đang cần tìm nơi chăm sóc da tốt');
  const campaign = plan('CONSISTENT'); campaign.languages = ['vi'];
  const mock = model(() => { throw Error('model must not be called'); });
  const a = await classifyConversations(campaign, [foreign], mock.gateway);
  assert.notEqual(a.decisions[0]!.classification, 'SUITABLE'); assert.equal(mock.requests.length, 0);
  const b = await classifyConversations(plan('STANDARD'), [{ ...foreign, post: null }], mock.gateway);
  assert.equal(b.decisions[0]!.reason_code, 'POST_NO_TEXT_EVIDENCE'); assert.equal(mock.requests.length, 0);
});

test('advertising post is not rescued by stored consumer comment; hard unknown remains pending', async () => {
  const mock = model(() => [fact(0, { promotion: 'YES', opportunities: [] }), fact(1, { hard: 'UNKNOWN' }), fact(2, { hard: 'FAIL' })]);
  const out = await classifyConversations(plan('STANDARD'), [withComment(snapshot('Spa ưu đãi đăng ký ngay'), 'Tôi muốn chăm sóc da'),
    snapshot('Mình muốn tìm spa', 'unknown'), snapshot('Mình cần spa ở nơi khác', 'fail')], mock.gateway);
  assert.deepEqual(out.decisions.map(d => d.classification), ['NOT_SUITABLE', null, 'NOT_SUITABLE']);
});

test('one missing and one fabricated item preserve valid siblings, and cached failure never triggers automatic repeat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-partial-'));
  try {
    const sources = [snapshot('Tôi muốn chăm da', 'a'), snapshot('Tôi muốn đẹp hơn', 'b'), snapshot('Mình muốn tìm spa', 'c')];
    const mock = model(() => [fact(0), fact(2, { ev: [100] })]), options = { assessmentCacheDirectory: root };
    const out = await classifyConversations(plan('STANDARD'), sources, mock.gateway, options);
    assert.deepEqual(out.decisions.map(d => d.classification), ['SUITABLE', null, null]);
    assert.equal(out.failures.length, 2);
    await classifyConversations(plan('STANDARD'), sources, mock.gateway, options); assert.equal(mock.requests.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Quality review is blind, corrects policy interpretation, and shares final evidence across modes without a third call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-review-'));
  try {
    const source = snapshot('Mình chia sẻ trải nghiệm chăm da, giá 200k có hợp lý không?');
    const mock = model((request, call) => {
      if (call > 1) { assert.ok(!JSON.stringify(request.input).includes('first_assessment')); assert.ok(!JSON.stringify(request.input).includes('flags')); }
      return [fact(0, { opportunities: ['EXPERIENCE', 'DISCUSSION'], goal_fit: call === 1 ? 'RELATED' : 'EXACT', flags: call === 1 ? ['CONTEXT'] : [] })];
    });
    const campaign = plan('QUALITY'); campaign.prompt = 'Tìm trải nghiệm và thảo luận chăm sóc da';
    const options = { assessmentCacheDirectory: root };
    const out = await classifyConversations(campaign, [source], mock.gateway, options);
    assert.equal(out.decisions[0]!.classification, 'SUITABLE'); assert.equal(out.decisions[0]!.attributes?.review_state, 'COMPLETE');
    await classifyConversations(campaign, [source], mock.gateway, options);
    const standard = withFilterPolicy(campaign, 'STANDARD');
    const revised = await classifyConversations(standard, [source], mock.gateway, options);
    assert.equal(revised.decisions[0]!.attributes?.goal_fit, 'EXACT'); assert.equal(mock.requests.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('contradictory advertising facts keep Quality and subsequent mode views pending with no paid vote', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-conflict-'));
  try {
    const mock = model((_r, call) => [fact(0, { promotion: call === 1 ? 'NO' : 'YES', flags: ['PROMOTION'] })]);
    const source = snapshot('Chia sẻ cảm nhận về cơ sở chăm sóc da'), options = { assessmentCacheDirectory: root };
    const quality = await classifyConversations(plan('QUALITY'), [source], mock.gateway, options);
    assert.equal(quality.decisions[0]!.reason_code, 'POST_REVIEW_FACT_CONFLICT');
    const standard = await classifyConversations(plan('STANDARD'), [source], mock.gateway, options);
    assert.equal(standard.decisions[0]!.classification, null); assert.equal(mock.requests.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new recipes and historical recipes are independently pinned; OFF never invokes the classifier', async () => {
  assert.equal(classifierRecipe(FILTER_VERSIONS.STANDARD).system, POST_EVIDENCE_SYSTEM);
  assert.notEqual(classifierRecipe('coverage-standard-v1').system, POST_EVIDENCE_SYSTEM);
  const mock = model(() => { throw Error('must not call'); });
  const out = await classifyConversations(plan('OFF'), [snapshot('Spa khuyến mãi')], mock.gateway);
  assert.equal(mock.requests.length, 0); assert.equal(out.decisions[0]?.classification, null);
  await assert.rejects(classifyConversations(plan('STANDARD'), [snapshot('Mình cần spa')], mock.gateway, { maxBatchSize: 0 }), /POST_BATCH_INVALID/);
});

test('a billed incomplete review stays pending across restart instead of silently buying another review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-review-failed-'));
  try {
    const mock = model((_request, call) => {
      if (call === 2) throw new ModelGatewayError('MODEL_INCOMPLETE_RESPONSE', false, 'billed-attempt');
      return [fact(0, { flags: ['CONTEXT'] })];
    });
    const sources = [snapshot('Mình muốn tìm spa chăm sóc da')], options = { assessmentCacheDirectory: root };
    const first = await classifyConversations(plan('QUALITY'), sources, mock.gateway, options);
    assert.equal(first.decisions[0]!.classification, null);
    assert.equal(first.decisions[0]!.reason_code, 'MODEL_INCOMPLETE_RESPONSE');
    const second = await classifyConversations(plan('QUALITY'), sources, mock.gateway, options);
    assert.equal(second.decisions[0]!.reason_code, 'POST_REVIEW_UNRESOLVED'); assert.equal(mock.requests.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a budget stop before transport does not poison cache and can resume after user budget changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-post-budget-'));
  try {
    const mock = model((_request, call) => {
      if (call === 1) throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED', false, null);
      return [fact(0)];
    });
    const sources = [snapshot('Mình cần tìm spa chăm sóc da')], options = { assessmentCacheDirectory: root };
    const first = await classifyConversations(plan('STANDARD'), sources, mock.gateway, options);
    assert.equal(first.decisions[0]!.classification, null);
    const second = await classifyConversations(plan('STANDARD'), sources, mock.gateway, options);
    assert.equal(second.decisions[0]!.classification, 'SUITABLE'); assert.equal(mock.requests.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
