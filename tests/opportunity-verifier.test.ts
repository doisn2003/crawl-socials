import assert from 'node:assert/strict';
import test from 'node:test';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { validateClassificationItem } from '../src/application/classification-service.js';
import { verifyTentativeOpportunities, OPPORTUNITY_VERIFIER_VERSION } from '../src/application/opportunity-verifier.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationSnapshot } from '../src/domain/conversation.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { GEMINI_FLASH_LITE_PRICE } from '../src/infrastructure/llm/gemini-gateway.js';

const campaign = literalCampaign({ prompt: 'Tìm cuộc thảo luận về cafe' });
function snapshot(id: string, comment = false): ConversationSnapshot {
  const entity = (entity_id: string, text: string, parent_id: string | null): ConversationEntity => ({ entity_id, root_post_id: id,
    entity_type: parent_id ? 'COMMENT' : 'POST', parent_id, text, observed_at: '2026-10-30T00:00:00Z', published_at: null,
    permalink: null, author: { role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [], content_hash: contentHash(text) });
  const post = entity(id, 'Mình thử cafe X: bàn rộng, wifi nhanh, nước 45k nhưng hơi ồn.', null);
  const comments = comment ? [entity(id + '-c1', 'Có phòng yên tĩnh để họp không bạn?', id)] : [];
  return { id: id + '-snapshot', platform: 'threads', root_post_id: id, revision: 1, content_hash: contentHash([post, comments]),
    observed_at: post.observed_at, post, comments, coverage: { status: 'PARTIAL' }, spans: [post, ...comments].flatMap(e => evidenceSpans(e)) };
}
function proposal(s: ConversationSnapshot) {
  return validateClassificationItem({ snapshot_id: s.id, case_code: 'OPPORTUNITY_EXPERIENCE', evidence_ids: [s.spans[0]!.id],
    need_summary: 'FIRST_PASS_REASON_MUST_NOT_BIAS_VERIFIER' }, campaign, s, 'primary-model');
}
function response(s: ConversationSnapshot, verdict = 'CONFIRM_EXPERIENCE', index = 0) {
  return { snapshot_id: s.id, verdict, evidence_ids: [s.spans[index]!.id], explanation: 'Có trải nghiệm hoặc trao đổi cụ thể trong bằng chứng.' };
}
function gateway(produce: (request: JsonModelRequest, call: number) => unknown): ModelGateway & { requests: JsonModelRequest[] } {
  const requests: JsonModelRequest[] = [];
  return { requests, summary: () => ({ model: 'verifier-model', budget_usd: 1, measured_cost_usd: 0, unmetered_cost_upper_usd: 0,
    reserved_usd: 0, remaining_usd: 1, billable_attempts: requests.length, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    generateJson: async request => { requests.push(request); return { value: produce(request, requests.length), invocation_id: String(requests.length),
      request_hash: 'hash', model: 'verifier-model', model_version: null, usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0,
      cache_hit: false, elapsed_ms: 0, price: GEMINI_FLASH_LITE_PRICE }; } };
}

test('verifier confirms genuine review and keeps independent evidence/provenance without first-pass rationale', async () => {
  const s = snapshot('review'), p = proposal(s), model = gateway(() => [response(s)]);
  const result = await verifyTentativeOpportunities(campaign, [s], [p], model);
  assert.equal(result.reviews[0]!.outcome, 'CONFIRMED');
  assert.equal(result.decisions[0]!.attributes?.verifier_version, OPPORTUNITY_VERIFIER_VERSION);
  assert.equal(result.decisions[0]!.attributes?.primary_model, 'primary-model');
  assert.equal(result.decisions[0]!.model, 'verifier-model');
  assert.equal(result.reviews[0]!.proposed, p);
  assert.equal(JSON.stringify(model.requests[0]!.input).includes('FIRST_PASS_REASON'), false);
  assert.equal(JSON.stringify(model.requests[0]!.input).includes(s.observed_at), true);
});

test('related promotion is downgraded to research and an observed comment can become the verified action target', async () => {
  const ad = snapshot('ad'), question = snapshot('comment', true);
  const model = gateway(() => [response(ad, 'RESEARCH_PROMOTION'), response(question, 'CONFIRM_REQUEST', 1)]);
  const result = await verifyTentativeOpportunities(campaign, [ad, question], [proposal(ad), proposal(question)], model);
  assert.equal(result.decisions[0]!.classification, 'NOT_YET'); assert.equal(result.decisions[0]!.action_target, null);
  assert.equal(result.reviews[0]!.outcome, 'DOWNGRADED');
  assert.deepEqual(result.decisions[1]!.action_target, { entity_id: question.comments[0]!.entity_id, type: 'COMMENT' });
});

test('verifier never spends money on or promotes initially rejected/pending records', async () => {
  const s = snapshot('research'), research = validateClassificationItem({ snapshot_id: s.id, case_code: 'RELATED_CHECKIN',
    evidence_ids: [s.spans[0]!.id], need_summary: 'Chưa thấy trao đổi' }, campaign, s, 'primary-model');
  const model = gateway(() => { throw Error('unexpected'); });
  const result = await verifyTentativeOpportunities(campaign, [s], [research], model);
  assert.equal(model.requests.length, 0); assert.equal(result.decisions[0], research); assert.equal(result.reviews.length, 0);
});

test('invalid verifier evidence fails closed while only its record receives bounded recovery', async () => {
  const a = snapshot('a'), b = snapshot('b'), model = gateway((_request, call) => call === 1
    ? [response(a), { ...response(b), evidence_ids: ['foreign'] }] : [{ ...response(b), evidence_ids: ['foreign'] }]);
  const result = await verifyTentativeOpportunities(campaign, [a, b], [proposal(a), proposal(b)], model);
  assert.equal(result.decisions[0]!.classification, 'SUITABLE');
  assert.equal(result.decisions[1]!.classification, null); assert.equal(result.decisions[1]!.assessment_status, 'PENDING');
  assert.equal(model.requests.length, 2);
  assert.equal((model.requests[1]!.input as { conversations: unknown[] }).conversations.length, 1);
  assert.equal(result.failures.length, 1);
});

test('budget exhaustion halts the remaining batches and does not deliver unverified proposals', async () => {
  const a = snapshot('a'), b = snapshot('b'), model = gateway(() => { throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED'); });
  const result = await verifyTentativeOpportunities(campaign, [a, b], [proposal(a), proposal(b)], model, { maxBatchSize: 1 });
  assert.equal(model.requests.length, 1);
  assert.ok(result.decisions.every(d => d.classification === null && d.assessment_status === 'PENDING'));
  assert.ok(result.reviews.every(r => r.outcome === 'PENDING'));
});

test('missing snapshot, changed campaign and oversized context remain pending without model calls', async () => {
  const a = snapshot('a'), b = snapshot('b'), c = snapshot('c'), model = gateway(() => { throw Error('unexpected'); });
  const changed = { ...proposal(b), campaign_version: 'other-version' };
  const result = await verifyTentativeOpportunities(campaign, [b, c], [proposal(a), changed, proposal(c)], model, { maxSnapshotCharacters: 1 });
  assert.equal(model.requests.length, 0);
  assert.deepEqual(result.decisions.map(d => d.reason_code), ['VERIFIER_SNAPSHOT_MISSING', 'VERIFIER_CAMPAIGN_MISMATCH', 'VERIFIER_CONTEXT_REQUIRES_ENRICHMENT']);
  assert.ok(result.decisions.every(d => d.classification === null));
});
