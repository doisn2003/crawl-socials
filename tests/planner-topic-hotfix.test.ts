import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FIELDS, validateResult } from '../src/domain/semantic-keywords.mjs';
import { literalTopicPlan } from '../src/application/literal-topic-plan.js';
import { compileSemanticTurn } from '../src/application/semantic-campaign.js';
import { prepareSemanticDraft, CampaignDraftPreparationError, resolveDraftForStart } from '../src/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import type { IntentInput } from '../src/shared/semantic-intent.js';
import type { OpportunityConfig } from '../src/shared/production-api.js';

// User prompt and the two failing target_roles fields reported from the other PC.
const prompt = 'Tìm các bài viết có liên quan tới từ khóa piano coffee, piano giá rẻ, coffee piano, cà phê piano, cà phê có piano, piano live, học piano, học piano giá rẻ, piano giá rẻ, trung tâm piano, dạy piano, cho mượn piano...';
const topics = ['piano coffee', 'piano giá rẻ', 'coffee piano', 'cà phê piano', 'cà phê có piano', 'piano live', 'học piano', 'học piano giá rẻ', 'trung tâm piano', 'dạy piano', 'cho mượn piano'];
const splicedQuote = 'học piano, học piano giá rẻ, trung tâm piano, dạy piano, cho mượn piano';
const roles = ['Người dùng tìm kiếm địa điểm cà phê, dịch vụ học/dạy piano và mua bán đàn piano',
  'Người tìm kiếm dịch vụ piano, địa điểm cà phê có piano, trung tâm dạy piano'];
const intent: IntentInput = { stage: 'S2', prompt, context: '', seeds: [], revision: 1, answers: [], edits: [] };
const config: OpportunityConfig = { enabled: true, filterMode: 'STANDARD', languageScope: 'VIETNAMESE', prompt,
  brandContext: '', totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false };
function response(role = roles[0]!) {
  return { state: 'READY', intent_revision: 1, understanding: prompt, target_roles: [role], constraints: [],
    intent: Object.keys(FIELDS).map(field => ({ field,
      value: field === 'target_roles' ? role : field === 'topics' ? topics.join(', ') : 'Chưa đặt giới hạn',
      status: field === 'target_roles' || field === 'topics' ? 'CONFIRMED' : 'UNSPECIFIED',
      evidence: field === 'target_roles' ? [{ source: 'PROMPT', quote: splicedQuote }]
        : field === 'topics' ? [{ source: 'PROMPT', quote: prompt }] : [] })),
    branches: topics.map((text, i) => ({ id: 'b' + i, label: text, anchor: text, quote: text, source: 'PROMPT', scope: 'CORE', reason: 'Chủ đề gốc' })),
    queries: topics.map((text, i) => ({ text, branch_id: 'b' + i, anchor: text, kind: 'EXACT', rationale: 'Từ khóa gốc', risk: 'LOW' })),
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], caveats: [], improvements: [] };
}
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-topic-hotfix-'));
  try { await work(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true });
  }
}

test('both reported spliced role quotes stay invalid and expose actionable diagnostics', () => {
  assert.equal(prompt.includes(splicedQuote), false);
  for (const role of roles) assert.throws(() => validateResult(response(role), 'B', intent, {}), (error: any) => {
    assert.match(error.message, /bằng chứng thật: target_roles/);
    assert.equal(error.details.code, 'INTENT_FIELD_EVIDENCE');
    assert.deepEqual(error.details.fields[0].problems, ['QUOTE_NOT_IN_SOURCE']);
    assert.equal(error.details.fields[0].invalid_evidence[0].quote, splicedQuote); return true;
  });
});

test('explicit topic recovery keeps every unique supplied term with no invented author, country or price restriction', () => {
  const plan = literalTopicPlan(intent)!;
  assert.equal(plan.state, 'READY'); assert.deepEqual(plan.queries.map(q => q.text), topics);
  assert.deepEqual(plan.uncovered, []); assert.deepEqual(plan.target_roles, []); assert.deepEqual(plan.constraints, []);
  assert.equal(plan.intent.find(f => f.field === 'target_roles')!.status, 'UNSPECIFIED');
  assert.deepEqual(plan.intent.find(f => f.field === 'target_roles')!.evidence, []);
  for (const branch of plan.branches) assert.ok(prompt.includes(branch.quote));
});

test('local recovery refuses inferred keywords, conditional scope, context, large lists and revised decisions', () => {
  for (const change of [
    { prompt: 'Tìm người muốn thuê luật sư' },
    { prompt: prompt + ', chỉ lấy người đang cần học' },
    { prompt: prompt + ', không lấy bài quảng cáo' },
    { prompt: prompt + ', https://example.test' },
    { prompt: 'Tìm các bài viết có liên quan tới từ khóa ' + Array.from({ length: 17 }, (_, i) => 'topic ' + i).join(', ') },
    { prompt: 'Tìm các bài viết có liên quan tới từ khóa piano, ' },
    { context: 'Chỉ tìm người mua đàn' }, { revision: 2 }, { seeds: ['tìm lớp piano'] },
  ]) assert.equal(literalTopicPlan({ ...intent, ...change }), null, JSON.stringify(change));
});

test('invalid evidence outside an explicit topic-only request still gets at most one guided repair', async () => {
  let calls = 0; const requests: any[] = [];
  const other = { ...intent, context: 'Chỉ tìm người mua đàn' };
  await assert.rejects(compileSemanticTurn({ prompt, brand_context: other.context }, other, {
    summary: () => { throw Error('not used'); }, generateJson: async request => {
      calls++; requests.push(request); return { value: response() } as any;
    },
  }), /CAMPAIGN_SEMANTIC_VALIDATION_FAILED/);
  assert.equal(calls, 2);
  assert.equal(requests[1].input.VALIDATION_REPAIR.details.fields[0].field, 'target_roles');
  assert.match(requests[1].input.VALIDATION_REPAIR.instruction, /never omit intervening/);
});

test('retrying a failed draft preserves recipe pins and all charged attempts, then recovers the reported list', async () => temporary(async directory => {
  let invalidTopics = true, calls = 0;
  const factory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ ...options,
    mockTransport: true, apiKey: 'synthetic-key', minRequestIntervalMs: 0, maxAttempts: 1,
    fetch: async () => {
      calls++; const value = response(roles[calls % 2]);
      if (invalidTopics) value.intent.find(f => f.field === 'topics')!.evidence = [{ source: 'PROMPT', quote: 'not in user prompt' }];
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, totalTokenCount: 1300 } }), { status: 200 });
    } });
  let runId = '';
  try { await prepareSemanticDraft({ directory, config, gatewayFactory: factory }); assert.fail('Expected invalid topics'); }
  catch (error) { assert.ok(error instanceof CampaignDraftPreparationError); runId = error.runId; }
  assert.equal(calls, 2);
  const opportunity = join(directory, 'collections', runId, 'opportunity');
  const pin = readFileSync(join(opportunity, 'planner-recipe.json'), 'utf8');
  const oldCost = JSON.parse(readFileSync(join(opportunity, 'draft-cost.json'), 'utf8'));
  invalidTopics = false;
  const result = await prepareSemanticDraft({ directory, config, gatewayFactory: factory, resumeRunId: runId });
  assert.ok('campaign' in result); assert.equal(result.runId, runId); assert.equal(calls, 3);
  assert.equal(result.cost.billableAttempts, 3); assert.ok(result.cost.measuredUsd > oldCost.measuredUsd);
  assert.equal(readFileSync(join(opportunity, 'planner-recipe.json'), 'utf8'), pin);
  assert.equal(result.source.plannerRecovery, 'EXPLICIT_USER_TOPIC_LIST');
  assert.deepEqual(result.criteria.queries.map(q => q.text), topics); assert.deepEqual(result.criteria.audience, []);
  assert.deepEqual(result.campaign.languages, ['vi']); assert.deepEqual(result.campaign.required_geographies, []);
  const attempts = readdirSync(join(opportunity, 'intent-attempts')).map(file => JSON.parse(readFileSync(join(opportunity, 'intent-attempts', file), 'utf8')));
  assert.equal(attempts.length, 3); assert.equal(attempts.filter(a => a.recovery === 'EXPLICIT_USER_TOPIC_LIST').length, 1);
  assert.ok(attempts.every(a => a.validationDetails.code === 'INTENT_FIELD_EVIDENCE'));
  const restarted = await prepareSemanticDraft({ directory, config, gatewayFactory: factory, resumeRunId: runId });
  assert.equal(restarted.runId, runId); assert.equal(calls, 3);
  const started = resolveDraftForStart({ directory, runId, expectedRevision: result.revision, expectedConfigHash: result.configHash });
  assert.deepEqual(started.campaign.queries.map(q => q.text), topics);
}));
