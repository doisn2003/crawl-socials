import assert from 'node:assert/strict';
import test from 'node:test';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { classifierRecipe, classifyConversations, validateClassificationItem } from '../src/application/classification-service.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationSnapshot } from '../src/domain/conversation.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { GEMINI_FLASH_LITE_PRICE } from '../src/infrastructure/llm/gemini-gateway.js';

const campaign = literalCampaign({ prompt: 'Tìm cuộc thảo luận về quán cà phê' });
function snapshot(id = 'root', withQuestion = true): ConversationSnapshot {
  const make = (entity_id: string, text: string, parent_id: string | null): ConversationEntity => ({ entity_id, root_post_id: id,
    entity_type: parent_id ? 'COMMENT' : 'POST', parent_id, text, observed_at: '2026-10-30T00:00:00Z', published_at: null,
    permalink: null, author: { role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [], content_hash: contentHash(text) });
  const post = make(id, 'Check-in quán hoa', null), comments = withQuestion ? [make(id + '-c1', 'Quán này yên tĩnh để làm việc không bạn?', id)] : [];
  return { id: id + '-snapshot', platform: 'threads', root_post_id: id, revision: 1, content_hash: contentHash([post, comments]),
    observed_at: '2026-10-30T00:00:00Z', post, comments, coverage: { status: 'PARTIAL', has_more: true },
    spans: [post, ...comments].flatMap(e => evidenceSpans(e)) };
}
function item(s: ConversationSnapshot) {
  return { snapshot_id: s.id, case_code: 'OPPORTUNITY_REQUEST', evidence_ids: [s.spans.at(-1)!.id], action_entity_id: s.comments[0]!.entity_id,
    need_summary: 'Hỏi độ yên tĩnh để làm việc', intents: ['WORK_SPACE_REQUEST'], topic_fit: 'RELATED', observed_need: 'REQUEST',
    speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: 'OPEN', freshness: 'UNKNOWN' };
}
function fakeGateway(produce: (request: JsonModelRequest, call: number) => unknown): ModelGateway & { requests: JsonModelRequest[] } {
  const requests: JsonModelRequest[] = [];
  return { requests, summary: () => ({ model: 'test-model', budget_usd: 1, measured_cost_usd: 0, unmetered_cost_upper_usd: 0,
    reserved_usd: 0, remaining_usd: 1, billable_attempts: requests.length, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    generateJson: async request => { requests.push(request); return { value: produce(request, requests.length), invocation_id: String(requests.length),
      request_hash: 'hash', model: 'test-model', model_version: null, usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0,
      cache_hit: false, elapsed_ms: 0, price: GEMINI_FLASH_LITE_PRICE }; } };
}

test('question in a comment creates an evidenced target under a check-in', async () => {
  const s = snapshot(), gateway = fakeGateway(() => [item(s)]);
  const result = await classifyConversations(campaign, [s], gateway);
  assert.equal(result.decisions[0]!.classification, 'SUITABLE');
  assert.deepEqual(result.decisions[0]!.action_target, { entity_id: 'root-c1', type: 'COMMENT' });
  const input = gateway.requests[0]!.input as { conversations: Array<Record<string, unknown>> };
  assert.equal(input.conversations[0]!.as_of, s.observed_at);
  assert.equal(result.failures.length, 0);
});

test('frozen classifier recipe exactly reproduces the default prompt including examples and schema', async () => {
  const recipe = classifierRecipe(), s = snapshot(), gateway = fakeGateway(() => [item(s)]);
  await classifyConversations(campaign, [s], gateway);
  assert.equal(recipe.filter_version, campaign.filter_version);
  assert.equal(recipe.system, gateway.requests[0]!.system);
  assert.match(recipe.system, /Boundary examples are illustrative/);
  assert.equal(recipe.schema, gateway.requests[0]!.schema);
  assert.deepEqual(JSON.parse(JSON.stringify(recipe)), recipe);
  assert.equal(classifierRecipe(), recipe);
  const items = recipe.schema.items as Record<string, unknown>;
  assert.ok(Object.isFrozen(recipe) && Object.isFrozen(recipe.schema) && Object.isFrozen(items));
  assert.ok(Object.isFrozen(items.required));
  assert.throws(() => { items.additionalProperties = true; }, TypeError);
  assert.equal(classifierRecipe().schema, gateway.requests[0]!.schema);
});

test('minimal atomic output derives consistent topic and need without invented author or access certainty', () => {
  const s = snapshot();
  const decision = validateClassificationItem({ snapshot_id: s.id, case_code: 'OPPORTUNITY_REQUEST',
    evidence_ids: [s.spans.at(-1)!.id], need_summary: 'Hỏi độ yên tĩnh để làm việc' }, campaign, s, 'test');
  assert.equal(decision.classification, 'SUITABLE'); assert.equal(decision.attributes?.topic_fit, 'RELATED');
  assert.equal(decision.attributes?.observed_need, 'REQUEST'); assert.equal(decision.attributes?.speaker_role, 'UNKNOWN');
  assert.equal(decision.attributes?.participation_context, 'UNKNOWN'); assert.equal(decision.attributes?.brand_fit, 'TOPIC_ONLY');
  assert.deepEqual(decision.action_target, { entity_id: s.comments[0]!.entity_id, type: 'COMMENT' });
});

test('foreign evidence and missing target evidence cannot become suitable', () => {
  const s = snapshot();
  assert.throws(() => validateClassificationItem({ ...item(s), evidence_ids: ['other-post:span'] }, campaign, s, 'test'), /EVIDENCE/);
  assert.throws(() => validateClassificationItem({ ...item(s), evidence_ids: [s.spans[0]!.id] }, campaign, s, 'test'), /ACTION_EVIDENCE/);
  assert.throws(() => validateClassificationItem({ ...item(s), participation_context: 'CLOSED' }, campaign, s, 'test'), /CONTRADICTION/);
});

test('only invalid records receive one recovery; valid results are retained', async () => {
  const a = snapshot('a'), b = snapshot('b');
  const gateway = fakeGateway((_request, call) => call === 1 ? [item(a), { ...item(b), evidence_ids: ['bad'] }] : [item(b)]);
  const result = await classifyConversations(campaign, [a, b], gateway);
  assert.equal(gateway.requests.length, 2);
  assert.equal((gateway.requests[1]!.input as { conversations: unknown[] }).conversations.length, 1);
  assert.equal(result.decisions.filter(d => d.classification === 'SUITABLE').length, 2);
});

test('two malformed outputs produce technical failure, never unrelated', async () => {
  const s = snapshot(), gateway = fakeGateway(() => [{ ...item(s), evidence_ids: ['bad'] }]);
  const result = await classifyConversations(campaign, [s], gateway);
  assert.equal(gateway.requests.length, 2); assert.equal(result.decisions[0]!.classification, null);
  assert.equal(result.decisions[0]!.assessment_status, 'FAILED');
});

test('quota failure and context overflow remain pending without false exclusion', async () => {
  const s = snapshot(), gateway = fakeGateway(() => { throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED'); });
  let result = await classifyConversations(campaign, [s], gateway);
  assert.equal(result.decisions[0]!.classification, null); assert.equal(result.decisions[0]!.assessment_status, 'PENDING');
  const noCalls = fakeGateway(() => { throw Error('unexpected'); });
  result = await classifyConversations(campaign, [s], noCalls, { maxSnapshotCharacters: 1 });
  assert.equal(noCalls.requests.length, 0); assert.equal(result.decisions[0]!.reason_code, 'CONTEXT_REQUIRES_WINDOWING');
});

test('related commercial content stays research; sparse check-in stays not-yet', () => {
  const s = snapshot('a', false);
  for (const code of ['RELATED_PROMOTION', 'RELATED_CHECKIN']) {
    const value = { ...item(snapshot()), snapshot_id: s.id, case_code: code, evidence_ids: [s.spans[0]!.id],
      action_entity_id: '', observed_need: 'NONE', need_summary: 'Có liên quan, chưa thấy nhu cầu' };
    const decision = validateClassificationItem(value, campaign, s, 'test');
    assert.equal(decision.classification, 'NOT_YET'); assert.equal(decision.action_target, null);
  }
});

test('optional escalation is bounded and only replaces a difficult result with valid evidence', async () => {
  const s = snapshot(), primary = fakeGateway(() => [{ ...item(s), evidence_ids: ['bad'] }]);
  const stronger = fakeGateway(() => [item(s)]);
  const result = await classifyConversations(campaign, [s], primary, { escalationGateway: stronger });
  assert.equal(primary.requests.length, 2); assert.equal(stronger.requests.length, 1);
  assert.equal(result.decisions[0]!.classification, 'SUITABLE'); assert.equal(result.decisions[0]!.attributes?.escalated, true);
  assert.equal(result.failures.length, 0);
});
