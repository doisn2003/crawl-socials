import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { classifierRecipe, classifyConversations, validateClassificationItem } from '../src/application/classification-service.js';
import { campaignVersion, OPPORTUNITY_FILTER_VERSION, TEMPORAL_OPPORTUNITY_FILTER_VERSION } from '../src/domain/campaign-plan.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationSnapshot } from '../src/domain/conversation.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { createGeminiGateway, GEMINI_FLASH_LITE_PRICE } from '../src/infrastructure/llm/gemini-gateway.js';

// Verified against the saved baseline recipe on 2026-10-30. Only this digest is
// retained here; tests never open private campaigns or depend on machine paths.
const LEGACY_RECIPE_SHA256 = 'dd2d7bcab903a72e7a3c75d95faefb58a1929099567f7420a81e35ccccb5cee5';
const AS_OF = '2026-10-30T10:00:00Z';
const FUTURE = '2026-11-02T23:59:59+07:00';
function campaign() {
  const { version: _version, created_at, ...base } = literalCampaign({ prompt: 'Tìm người có nhu cầu học hoặc thuê đàn piano' });
  const plan = { ...base, filter_version: TEMPORAL_OPPORTUNITY_FILTER_VERSION, audience: ['người mới học đàn'], languages: ['vi'], research_intents: ['nhu cầu học đàn'] };
  return { ...plan, version: campaignVersion(plan), created_at };
}
function snapshot(id = 'root'): ConversationSnapshot {
  const entity = (entity_id: string, text: string, published_at: string, parent_id: string | null): ConversationEntity => ({
    entity_id, root_post_id: id, entity_type: parent_id ? 'COMMENT' : 'POST', parent_id, text, published_at,
    observed_at: AS_OF, author: { role: 'UNKNOWN' }, source: { kind: 'PROFILE' }, media: [], permalink: null, content_hash: contentHash(text),
  });
  const post = entity(id, 'Chỉ nhận thuê đàn đến 2026-10-02.', '2026-10-01T10:00:00Z', null);
  const comment = entity(id + '-comment', 'Tôi cần thuê đàn đến 2026-11-02.', '2026-10-30T01:00:00Z', id);
  return { id: id + '-snapshot', platform: 'threads', root_post_id: id, revision: 1, content_hash: contentHash([post, comment]),
    post, comments: [comment], observed_at: AS_OF, coverage: { status: 'PARTIAL', has_more: true }, spans: [post, comment].flatMap(entity => evidenceSpans(entity)) };
}
function item(s: ConversationSnapshot) {
  return { snapshot_id: s.id, case_code: 'OPPORTUNITY_REQUEST', evidence_ids: [s.spans[1]!.id], need_summary: 'Người dùng cần thuê đàn',
    speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: 'UNKNOWN', freshness: 'CURRENT',
    temporal_status: 'NO_BOUNDED_REQUEST', valid_until: null as string | null,
    temporal_evidence: [] as Array<{ entity_id: string; evidence_id: string; quote: string; published_at: string; expires_at: string }> };
}
function proof(s: ConversationSnapshot, target: 'POST' | 'COMMENT' = 'COMMENT') {
  const entity = target === 'POST' ? s.post! : s.comments[0]!;
  return { entity_id: entity.entity_id, evidence_id: s.spans.find(span => span.entity_id === entity.entity_id)!.id,
    quote: target === 'POST' ? 'đến 2026-10-02' : 'đến 2026-11-02', published_at: entity.published_at!,
    expires_at: target === 'POST' ? '2026-10-02T23:59:59+07:00' : FUTURE };
}
function currentItem(s: ConversationSnapshot) {
  return { ...item(s), temporal_status: 'CURRENT_WINDOW', valid_until: FUTURE, temporal_evidence: [proof(s)] };
}
function fakeGateway(produce: (request: JsonModelRequest, call: number) => unknown): ModelGateway & { requests: JsonModelRequest[] } {
  const requests: JsonModelRequest[] = [];
  return { requests, summary: () => ({ model: 'synthetic', budget_usd: 1, measured_cost_usd: 0, unmetered_cost_upper_usd: 0,
    reserved_usd: 0, remaining_usd: 1, billable_attempts: requests.length, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    async generateJson(request) {
      requests.push(request); return { value: produce(request, requests.length), invocation_id: String(requests.length), request_hash: contentHash(request),
        model: 'synthetic', model_version: null, usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price: GEMINI_FLASH_LITE_PRICE };
    } };
}

test('temporal policy is opt-in and the exact saved legacy recipe remains immutable', () => {
  assert.equal(contentHash(classifierRecipe()), LEGACY_RECIPE_SHA256);
  assert.equal(classifierRecipe().filter_version, OPPORTUNITY_FILTER_VERSION);
  const temporal = classifierRecipe(TEMPORAL_OPPORTUNITY_FILTER_VERSION);
  assert.notEqual(contentHash(temporal), LEGACY_RECIPE_SHA256);
  assert.ok(Object.isFrozen(temporal) && Object.isFrozen(temporal.schema));
  assert.throws(() => classifierRecipe('unsupported'), /CLASSIFIER_POLICY_UNSUPPORTED/);
});

test('exact native publication, quote and future deadline support the selected comment opportunity', () => {
  const s = snapshot(), decision = validateClassificationItem(currentItem(s), campaign(), s, 'synthetic', AS_OF);
  assert.equal(decision.classification, 'SUITABLE'); assert.equal(decision.evaluated_at, AS_OF); assert.equal(decision.valid_until, FUTURE);
  assert.deepEqual(decision.action_target, { entity_id: s.comments[0]!.entity_id, type: 'COMMENT' });
  assert.deepEqual(decision.temporal_evidence, [proof(s)]);
});

test('temporal proof rejects invented publication, altered quote, foreign span and inconsistent deadline', () => {
  const s = snapshot(), original = currentItem(s);
  for (const temporal_evidence of [[{ ...proof(s), published_at: s.observed_at }], [{ ...proof(s), quote: 'not present' }],
    [{ ...proof(s), evidence_id: s.spans[0]!.id }], [{ ...proof(s), published_at: '2026-10-30' }]]) {
    assert.throws(() => validateClassificationItem({ ...original, temporal_evidence }, campaign(), s, 'synthetic', AS_OF), /TEMPORAL|DEADLINE/);
  }
  for (const valid_until of [null, AS_OF, '2026-11-03T23:59:59+07:00']) {
    assert.throws(() => validateClassificationItem({ ...original, valid_until }, campaign(), s, 'synthetic', AS_OF), /VALIDITY/);
  }
});

test('native expiry becomes NOT_YET even when the model returns an opportunity case', () => {
  const s = snapshot(), evaluatedAt = '2026-11-03T00:00:00Z';
  for (const case_code of ['OPPORTUNITY_REQUEST', 'RELATED_EXPIRED']) {
    const decision = validateClassificationItem({ ...currentItem(s), case_code, temporal_status: 'EXPIRED_WINDOW', valid_until: null }, campaign(), s, 'synthetic', evaluatedAt);
    assert.equal(decision.classification, 'NOT_YET'); assert.equal(decision.reason_code, 'RELATED_EXPIRED');
    assert.equal(decision.action_target, null); assert.equal(decision.evaluated_at, evaluatedAt);
  }
});

test('an unknown bounded request remains pending instead of publishing an opportunity', () => {
  const s = snapshot(), decision = validateClassificationItem({ ...item(s), temporal_status: 'UNKNOWN' }, campaign(), s, 'synthetic', AS_OF);
  assert.equal(decision.classification, null); assert.equal(decision.assessment_status, 'PENDING');
  assert.equal(decision.reason_code, 'INSUFFICIENT_CONTEXT'); assert.equal(decision.action_target, null);
});

test('expiry evidence from the root cannot close an opportunity selected in a different consumer comment', () => {
  const s = snapshot();
  for (const case_code of ['OPPORTUNITY_REQUEST', 'RELATED_EXPIRED']) {
    assert.throws(() => validateClassificationItem({ ...item(s), case_code, evidence_ids: [s.spans[1]!.id, s.spans[0]!.id],
      temporal_status: 'EXPIRED_WINDOW', temporal_evidence: [proof(s, 'POST')] }, campaign(), s, 'synthetic', AS_OF), /DEADLINE_TARGET_MISMATCH/);
    assert.throws(() => validateClassificationItem({ ...item(s), case_code, action_entity_id: s.comments[0]!.entity_id,
      evidence_ids: [s.spans[0]!.id, s.spans[1]!.id], temporal_status: 'EXPIRED_WINDOW', temporal_evidence: [proof(s, 'POST')] },
    campaign(), s, 'synthetic', AS_OF), /DEADLINE_TARGET_MISMATCH/);
  }
});

test('current-window deadline evidence also must belong to the selected opportunity entity', () => {
  const s = snapshot();
  assert.throws(() => validateClassificationItem({ ...currentItem(s), evidence_ids: [s.spans[0]!.id, s.spans[1]!.id] }, campaign(), s, 'synthetic', AS_OF), /DEADLINE_TARGET_MISMATCH/);
});

test('substantive historical reviews remain opportunities without a generic maximum-age cutoff', () => {
  const s = snapshot(); s.post!.text = 'Đàn có phím chắc, âm trong, chơi lâu không mỏi tay.'; s.post!.published_at = '2005-01-01T00:00:00Z';
  s.spans = [s.post!, ...s.comments].flatMap(entity => evidenceSpans(entity));
  const decision = validateClassificationItem({ ...item(s), case_code: 'OPPORTUNITY_EXPERIENCE', evidence_ids: [s.spans[0]!.id],
    need_summary: 'Trải nghiệm độ nặng phím và âm thanh', freshness: 'OLD' }, campaign(), s, 'synthetic', AS_OF);
  assert.equal(campaign().max_age_days, null); assert.equal(decision.classification, 'SUITABLE'); assert.equal(decision.valid_until, null);
});

test('audience, languages and research context reach the model and evidence-based attributes survive validation', async () => {
  const s = snapshot(), c = campaign(), gateway = fakeGateway(() => [item(s)]);
  const result = await classifyConversations(c, [s], gateway, { evaluatedAt: AS_OF });
  const input = gateway.requests[0]!.input as { campaign: Record<string, unknown>; conversations: Array<Record<string, unknown>> };
  assert.deepEqual(input.campaign.audience, c.audience); assert.deepEqual(input.campaign.languages, c.languages); assert.deepEqual(input.campaign.research_intents, c.research_intents);
  assert.equal(input.conversations[0]!.as_of, AS_OF); assert.equal(result.decisions[0]!.attributes?.speaker_role, 'CONSUMER');
  assert.equal(result.decisions[0]!.attributes?.brand_fit, 'TOPIC_ONLY'); assert.equal(result.decisions[0]!.attributes?.participation_context, 'UNKNOWN');
});

test('missing temporal attributes receive only one format recovery, with a stable as-of and no false negative', async () => {
  const good = snapshot('good'), bad = snapshot('bad');
  const incomplete = { ...item(bad) } as Record<string, unknown>; delete incomplete.speaker_role;
  const gateway = fakeGateway((_request, call) => call === 1 ? [item(good), incomplete] : [incomplete]);
  const result = await classifyConversations(campaign(), [good, bad], gateway, { evaluatedAt: AS_OF });
  assert.equal(gateway.requests.length, 2); assert.equal(result.decisions[0]!.classification, 'SUITABLE');
  assert.equal(result.decisions[1]!.classification, null); assert.equal(result.decisions[1]!.assessment_status, 'FAILED');
  assert.equal(result.failures[0]!.code, 'CLASSIFIER_ATTRIBUTE_REQUIRED');
  const retried = gateway.requests[1]!.input as { conversations: Array<{ snapshot_id: string; as_of: string }> };
  assert.deepEqual(retried.conversations.map(value => [value.snapshot_id, value.as_of]), [[bad.id, AS_OF]]);
});

test('missing deadline fields cannot escape bounded recovery or become unrelated', async () => {
  const s = snapshot();
  for (const field of ['temporal_status', 'temporal_evidence', 'valid_until']) {
    const incomplete = { ...item(s) } as Record<string, unknown>; delete incomplete[field];
    const gateway = fakeGateway(() => [incomplete]);
    const result = await classifyConversations(campaign(), [s], gateway, { evaluatedAt: AS_OF });
    assert.equal(gateway.requests.length, 2); assert.equal(result.decisions[0]!.classification, null);
    assert.equal(result.decisions[0]!.assessment_status, 'FAILED');
  }
  const gateway = fakeGateway(() => [{ ...item(s), temporal_evidence: undefined }]);
  const result = await classifyConversations(campaign(), [s], gateway, { evaluatedAt: AS_OF, recoverFormat: false });
  assert.equal(gateway.requests.length, 1); assert.equal(result.decisions[0]!.classification, null);
});

test('default temporal evaluation uses invocation time, and retries retain that same time', async () => {
  const s = snapshot(); s.observed_at = '2001-01-01T00:00:00Z';
  const gateway = fakeGateway((_request, call) => call === 1 ? [{ ...item(s), temporal_evidence: undefined }] : [item(s)]);
  const before = Date.now(), result = await classifyConversations(campaign(), [s], gateway), after = Date.now();
  const times = gateway.requests.map(request => (request.input as { conversations: Array<{ as_of: string }> }).conversations[0]!.as_of);
  assert.equal(times.length, 2); assert.equal(times[0], times[1]); assert.notEqual(times[0], s.observed_at);
  assert.ok(Date.parse(times[0]!) >= before && Date.parse(times[0]!) <= after);
  assert.equal(result.decisions[0]!.evaluated_at, times[0]); assert.equal(result.decisions[0]!.classification, 'SUITABLE');
});

test('real gateway cache separates as-of times for the same snapshot while identical time reuses the response', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-temporal-cache-')), s = snapshot(); let calls = 0;
  const gateway = createGeminiGateway({ mockTransport: true, directory, budgetUsd: 1, apiKey: 'synthetic-only', minRequestIntervalMs: 0, maxAttempts: 1,
    fetch: async () => { calls++; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify([item(s)]) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 } }), { status: 200 }); } });
  try {
    const first = await classifyConversations(campaign(), [s], gateway, { evaluatedAt: AS_OF });
    const cached = await classifyConversations(campaign(), [s], gateway, { evaluatedAt: AS_OF });
    const laterAt = '2026-10-31T10:00:00Z', later = await classifyConversations(campaign(), [s], gateway, { evaluatedAt: laterAt });
    assert.equal(calls, 2); assert.equal(cached.model_results[0]!.cache_hit, true);
    assert.equal(first.model_results[0]!.request_hash, cached.model_results[0]!.request_hash);
    assert.notEqual(first.model_results[0]!.request_hash, later.model_results[0]!.request_hash);
    assert.equal(later.decisions[0]!.evaluated_at, laterAt); assert.equal(s.id, later.decisions[0]!.snapshot_id);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
