import assert from 'node:assert/strict';
import test from 'node:test';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { validateClassificationItem } from '../src/application/classification-service.js';
import { auditTentativeOpportunitiesV2, validateFocusedVerification, FOCUSED_VERIFIER_RECIPE,
  FOCUSED_VERIFIER_RECIPE_SHA256 } from '../src/application/opportunity-verifier-v2.js';
import { contentHash, evidenceSpans } from '../src/domain/conversation.js';
import type { ConversationEntity, ConversationSnapshot } from '../src/domain/conversation.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { GEMINI_FLASH_LITE_PRICE } from '../src/infrastructure/llm/gemini-gateway.js';

const campaign = literalCampaign({ prompt: 'Tìm cuộc thảo luận về cafe' });
function snapshot(id: string, text: string, comment?: string): ConversationSnapshot {
  const entity = (entity_id: string, text: string, parent_id: string | null): ConversationEntity => ({ entity_id,
    entity_type: parent_id ? 'COMMENT' : 'POST', root_post_id: id, parent_id, text, observed_at: '2026-10-30T00:00:00Z',
    published_at: '2026-08-01T00:00:00Z', permalink: null, author: { role: 'UNKNOWN' }, source: { kind: 'PAGE' }, media: [], content_hash: contentHash(text) });
  const post = entity(id, text, null), comments = comment ? [entity(id + '-c', comment, id)] : [];
  return { id: id + '-snapshot', root_post_id: id, platform: 'facebook', revision: 1, content_hash: contentHash([post, comments]),
    observed_at: post.observed_at, post, comments, coverage: { status: comment ? 'PARTIAL' : 'NOT_ATTEMPTED' }, spans: [post, ...comments].flatMap(e => evidenceSpans(e)) };
}
function proposal(s: ConversationSnapshot, context = campaign) { return validateClassificationItem({ snapshot_id: s.id, case_code: 'OPPORTUNITY_EXPERIENCE',
  evidence_ids: [s.spans[0]!.id], need_summary: 'DO_NOT_SEND_PRIMARY_REASON' }, context, s, 'primary'); }
function answer(s: ConversationSnapshot, verdict = 'KEEP', reason = 'PRESERVE_CONSUMER_OPENING') {
  return { snapshot_id: s.id, verdict, reason, evidence_ids: [s.spans[0]!.id], explanation: 'Bằng chứng được kiểm tra trong đúng ngữ cảnh.', expiry: null as unknown };
}
function fake(produce: (r: JsonModelRequest) => unknown): ModelGateway & { requests: JsonModelRequest[] } {
  const requests: JsonModelRequest[] = [];
  return { requests, summary: () => ({ model: 'fake', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0,
    reserved_usd: 0, remaining_usd: 3, billable_attempts: requests.length, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
  generateJson: async r => { requests.push(r); return { value: produce(r), invocation_id: 'fake-' + requests.length, request_hash: 'hash', model: 'fake',
    model_version: null, usage: null, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price: GEMINI_FLASH_LITE_PRICE }; } };
}

test('focused verifier preserves informative third-person guide and serializes native context without primary rationale', async () => {
  const s = snapshot('guide', 'Cafe A: phòng họp riêng trên tầng hai, bàn cao, wifi ổn, giá 45k. Cuối tuần đông nên học ngày thường.'), p = proposal(s);
  const gateway = fake(() => [answer(s)]), before = structuredClone(p);
  const result = await auditTentativeOpportunitiesV2(campaign, [s], [p], gateway);
  assert.equal(result.audits[0]!.verdict, 'KEEP'); assert.deepEqual(p, before);
  const input = JSON.stringify(gateway.requests[0]!.input);
  assert.ok(input.includes(s.observed_at)); assert.ok(input.includes(s.post!.published_at!)); assert.ok(input.includes('UNKNOWN'));
  assert.ok(!input.includes('DO_NOT_SEND_PRIMARY_REASON'));
  assert.equal(contentHash(FOCUSED_VERIFIER_RECIPE), FOCUSED_VERIFIER_RECIPE_SHA256);
});

test('expiry downgrade requires exact native date, observed quote and a bounded end before as_of', () => {
  const s = snapshot('expired', 'Sáng mai cần quán cafe để gặp nhóm.');
  const valid = { ...answer(s, 'DOWNGRADE_NOT_YET', 'EXPIRED_BOUNDED_REQUEST'), expiry: { entity_id: 'expired', evidence_id: s.spans[0]!.id,
    quote: 'Sáng mai', published_at: s.post!.published_at!, expires_at: '2026-08-02T23:59:59Z' } };
  assert.equal(validateFocusedVerification(valid, s, { model: 'fake', invocation_id: '1' }).verdict, 'DOWNGRADE_NOT_YET');
  for (const expiry of [null, { ...valid.expiry, published_at: s.observed_at }, { ...valid.expiry, quote: 'tuần tới' },
    { ...valid.expiry, expires_at: '2027-01-01T00:00:00Z' }, { ...valid.expiry, expires_at: '2026-07-01T00:00:00Z' }]) {
    assert.throws(() => validateFocusedVerification({ ...valid, expiry }, s, { model: 'fake', invocation_id: '1' }));
  }
  assert.throws(() => validateFocusedVerification(valid, { ...s, post: { ...s.post!, published_at: null } }, { model: 'fake', invocation_id: '1' }));
});

test('job address question retains parent context; a separate explicit consumer comment can keep the conversation', async () => {
  const job = snapshot('job', 'Quán cafe tuyển nhân viên phục vụ.', 'Địa chỉ ở đâu để em ứng tuyển?');
  const consumer = snapshot('consumer', 'Quán cafe tuyển nhân viên phục vụ.', 'Mình muốn đến học bài, quán có ổ cắm không?');
  const model = fake(() => [answer(job, 'DOWNGRADE_NOT_YET', 'EMPLOYMENT_CONTEXT'), { ...answer(consumer), evidence_ids: [consumer.spans[1]!.id] }]);
  const result = await auditTentativeOpportunitiesV2(campaign, [job, consumer], [proposal(job), proposal(consumer)], model);
  assert.deepEqual(result.audits.map(a => a.verdict), ['DOWNGRADE_NOT_YET', 'KEEP']);
  const input = model.requests[0]!.input as { conversations: Array<{ entities: Array<{ parent_id: string | null }> }> };
  assert.equal(input.conversations[0]!.entities[1]!.parent_id, 'job');
});

test('topic mismatch is UNRELATED audit and never silently becomes research', async () => {
  const s = snapshot('meal', 'Review set bò và bào ngư tại nhà hàng cho sinh nhật.');
  const model = fake(() => [answer(s, 'DOWNGRADE_UNRELATED', 'EXPLICIT_TOPIC_MISMATCH')]);
  const result = await auditTentativeOpportunitiesV2(campaign, [s], [proposal(s)], model);
  assert.equal(result.audits[0]!.verdict, 'DOWNGRADE_UNRELATED');
  assert.throws(() => validateFocusedVerification(answer(s, 'DOWNGRADE_NOT_YET', 'EXPLICIT_TOPIC_MISMATCH'), s, { model: 'fake', invocation_id: '1' }));
});

test('invalid evidence and duplicate response fail as unresolved without format retries', async () => {
  const a = snapshot('a', 'Xin cafe học bài.'), b = snapshot('b', 'Xin cafe có phòng riêng.');
  const model = fake(() => [{ ...answer(a), evidence_ids: ['invented'] }, answer(b), answer(b)]);
  const result = await auditTentativeOpportunitiesV2(campaign, [a, b], [proposal(a), proposal(b)], model);
  assert.equal(model.requests.length, 1); assert.ok(result.audits.every(audit => audit.verdict === 'UNRESOLVED' && audit.reason === 'TECHNICAL_FAILURE'));
});

test('budget failure halts following batches and rejected records incur no verification calls', async () => {
  const a = snapshot('a', 'Xin cafe học bài.'), b = snapshot('b', 'Xin cafe yên tĩnh.');
  const research = { ...proposal(b), classification: 'NOT_YET' as const };
  const noCall = fake(() => { throw Error('unexpected'); });
  assert.deepEqual((await auditTentativeOpportunitiesV2(campaign, [b], [research], noCall)).audits, []);
  const model = fake(() => { throw new ModelGatewayError('MODEL_BUDGET_ABLATION_EXHAUSTED'); });
  const result = await auditTentativeOpportunitiesV2(campaign, [a, b], [proposal(a), proposal(b)], model, { batchSize: 1 });
  assert.equal(model.requests.length, 1); assert.equal(result.audits.length, 2); assert.ok(result.audits.every(audit => audit.verdict === 'UNRESOLVED'));
});

// These are contract tests with a fake model, not claims of cross-topic classification accuracy.
const crossTopicCases = [
  { name: 'consumer-product', prompt: 'Tìm người cần tư vấn tai nghe chống ồn để làm việc trong văn phòng.',
    request: 'Tai nghe nào đeo cả ngày không đau tai và lọc được tiếng họp?', reply: 'Mình cần dùng với máy tính và điện thoại, có đổi kết nối nhanh được không?',
    expiry: 'Sáng mai cần tai nghe chống ồn cho chuyến công tác.' },
  { name: 'travel', prompt: 'Tìm gia đình trao đổi về chọn khách sạn yên tĩnh cho kỳ nghỉ cùng trẻ nhỏ.',
    request: 'Khách sạn nào có phòng gia đình và khu vui chơi cho bé?', reply: 'Nhà mình có trẻ hai tuổi, phòng có cách âm tốt không?',
    expiry: 'Sáng mai cần khách sạn cho gia đình ở một đêm.' },
  { name: 'education', prompt: 'Tìm người cần khóa học tiếng Anh buổi tối phù hợp người đang đi làm.',
    request: 'Có lớp tiếng Anh tối nào cho người mới bắt đầu mà ít học viên không?', reply: 'Mình làm ca xoay, có được học bù sang buổi khác không?',
    expiry: 'Sáng mai cần buổi học thử tiếng Anh trước khi đăng ký.' },
  { name: 'cafe', prompt: 'Tìm người hỏi địa điểm cafe yên tĩnh để học hoặc làm việc.',
    request: 'Quán nào có bàn cao và ổ điện để học cả chiều?', reply: 'Mình có buổi họp trực tuyến, có phòng riêng không?',
    expiry: 'Sáng mai cần quán cafe có phòng riêng để họp.' },
];

test('multi-topic contract routes each campaign intent and observed reply without a required cafe keyword', async () => {
  for (const fixture of crossTopicCases) {
    const scoped = literalCampaign({ prompt: fixture.prompt });
    const s = snapshot(fixture.name, fixture.request, fixture.reply), p = proposal(s, scoped);
    const model = fake(() => [{ ...answer(s), evidence_ids: [s.spans[1]!.id] }]);
    const result = await auditTentativeOpportunitiesV2(scoped, [s], [p], model);
    assert.equal(result.audits[0]!.verdict, 'KEEP', fixture.name);
    assert.deepEqual(result.audits[0]!.evidence_ids, [s.spans[1]!.id], fixture.name);
    const input = model.requests[0]!.input as { campaign: { prompt: string }; conversations: Array<{ entities: Array<{ parent_id: string | null }> }> };
    assert.equal(input.campaign.prompt, fixture.prompt, fixture.name);
    assert.equal(input.conversations[0]!.entities[1]!.parent_id, s.root_post_id, fixture.name);
    assert.ok(!JSON.stringify(input).includes('DO_NOT_SEND_PRIMARY_REASON'), fixture.name);
    if (fixture.name !== 'cafe') assert.ok(!/cafe|cà phê/iu.test(JSON.stringify(input)), fixture.name);
    const changed = { ...p, campaign_version: 'other-intent-version' }, noCall = fake(() => { throw Error('must not run'); });
    await assert.rejects(auditTentativeOpportunitiesV2(scoped, [s], [changed], noCall), /CONTEXT_MISMATCH/, fixture.name);
    assert.equal(noCall.requests.length, 0, fixture.name);
  }
});

test('temporal evidence and exact span contracts work identically for products travel education and cafes', () => {
  for (const fixture of crossTopicCases) {
    const s = snapshot(fixture.name, fixture.expiry);
    const item = { ...answer(s, 'DOWNGRADE_NOT_YET', 'EXPIRED_BOUNDED_REQUEST'), expiry: {
      entity_id: s.root_post_id, evidence_id: s.spans[0]!.id, quote: 'Sáng mai',
      published_at: s.post!.published_at!, expires_at: '2026-08-02T23:59:59Z' } };
    assert.equal(validateFocusedVerification(item, s, { model: 'fake', invocation_id: 'test' }).verdict, 'DOWNGRADE_NOT_YET', fixture.name);
    assert.throws(() => validateFocusedVerification({ ...item, evidence_ids: [s.root_post_id] }, s,
      { model: 'fake', invocation_id: 'test' }), /EVIDENCE_INVALID/, fixture.name);
    assert.throws(() => validateFocusedVerification({ ...item, expiry: { ...item.expiry, published_at: s.observed_at } }, s,
      { model: 'fake', invocation_id: 'test' }), /EXPIRY_INVALID/, fixture.name);
  }
});
