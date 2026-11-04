import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalIntentQuote, FIELDS, validateResult } from '../src/domain/semantic-keywords.mjs';
import { compileSemanticTurn } from '../src/application/semantic-campaign.js';
import type { IntentInput } from '../src/shared/semantic-intent.js';
import type { JsonModelResult } from '../src/application/ports/model-gateway.js';

const prompt = 'Tìm những người có nhu cầu học chơi đàn piano. Tìm người muốn học chơi đàn piano. Tìm bài viết hỏi địa điểm chơi piano, tìm quán cafe có piano. \nTìm người muốn mượn đàn piano, piano giá rẻ. Người đang tìm trung tâm piano.';
const topics = ['học chơi đàn piano', 'địa điểm chơi piano', 'quán cafe có piano', 'mượn đàn piano', 'piano giá rẻ', 'trung tâm piano'];
const input: IntentInput = { stage: 'S2', prompt, context: 'Tôi là chủ cửa hàng Cafe Piano.', revision: 1, answers: [], edits: [], seeds: [] };
function response() {
  return { state: 'READY', intent_revision: 1, understanding: prompt, target_roles: ['Người có nhu cầu học, chơi hoặc mượn đàn piano'], constraints: [],
    intent: Object.keys(FIELDS).map(field => ({ field, value: field === 'target_roles' ? 'Người đang tìm học, địa điểm chơi, quán cafe, mượn đàn hoặc trung tâm piano' : 'Chưa đặt giới hạn',
      status: field === 'target_roles' ? 'CONFIRMED' : 'UNSPECIFIED', evidence: field === 'target_roles' ? [{ source: 'PROMPT', quote: prompt.replace(/\s+/gu, ' ') }] : [] })),
    branches: topics.map((text, i) => ({ id: 'b' + i, label: text, anchor: text, quote: text, source: 'PROMPT', scope: 'CORE', reason: 'Nhu cầu nêu trực tiếp' })),
    queries: topics.map((text, i) => ({ text, branch_id: 'b' + i, anchor: text, kind: 'EXACT', rationale: 'Cách tìm theo nhu cầu gốc', risk: 'LOW' })),
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], caveats: [], improvements: [] };
}
test('format-only quote matching restores a contiguous original span across whitespace and NFC variants', () => {
  for (const separator of ['\n', '\r\n', '\t', '  ', '\u00a0']) {
    const source = 'cà phê' + separator + 'piano'; assert.equal(canonicalIntentQuote(source, 'cà phê piano'), source);
  }
  assert.equal(canonicalIntentQuote('cà phê\npiano', 'cà phê piano'), 'cà phê\npiano');
  assert.equal(canonicalIntentQuote('😀 cà phê\nđàn piano 🎹', 'cà phê đàn piano'), 'cà phê\nđàn piano');
});
test('formatting tolerance never accepts missing words, joined excerpts, altered punctuation or invented intent', () => {
  for (const quote of ['học piano giá rẻ, trung tâm piano', 'học piano; piano giá rẻ, trung tâm piano', 'Học piano, piano giá rẻ, trung tâm piano', 'tìm mua đàn piano', '']) {
    assert.equal(canonicalIntentQuote('học piano, piano giá rẻ, trung tâm piano', quote), null, quote);
  }
});
test('the reported multi-need prompt keeps confirmed seeker roles and all six queries without mutating the saved response', () => {
  const raw = response(), before = structuredClone(raw), plan = validateResult(raw, 'B', input, {});
  assert.equal(plan.state, 'READY'); assert.deepEqual(plan.queries.map(q => q.text), topics); assert.deepEqual(plan.uncovered, []);
  const role = plan.intent.find(field => field.field === 'target_roles')!;
  assert.equal(role.status, 'CONFIRMED'); assert.equal(role.evidence[0]!.quote, prompt);
  assert.deepEqual(raw, before); assert.ok(!raw.intent[0]!.evidence[0]!.quote.includes('\n'));
});
test('an earlier failed response can be validated locally without another paid request', async () => {
  let calls = 0; const audits: any[] = [];
  const result = { value: response(), model: 'gemini-3.1-flash-lite', invocation_id: 'recorded-invocation', request_hash: 'recorded-hash', cache_hit: false, elapsed_ms: 5000 } as JsonModelResult;
  const compiled = await compileSemanticTurn({ prompt, brand_context: input.context, suitable_target: 10, raw_cap: 30, model_usd: 3 }, input, {
    generateJson: async () => { calls++; throw Error('LIVE_MODEL_FORBIDDEN'); }, summary: () => { throw Error('not needed'); },
  }, { recordedAttempts: [{ result, requestInput: { PROMPT: prompt } }], onAttempt: value => { audits.push(value); } });
  assert.equal(calls, 0); assert.equal(compiled.recovery, 'RECORDED_VALIDATED_RESPONSE');
  assert.equal(compiled.campaign!.queries.length, 6); assert.equal(compiled.model_result.invocation_id, result.invocation_id);
  assert.equal(compiled.model_result.cache_hit, true); assert.equal(audits[0].recovery, 'RECORDED_VALIDATED_RESPONSE');
});
