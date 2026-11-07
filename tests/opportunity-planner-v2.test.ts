import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { originalRequestFacets, DISCOVERY_FAMILIES, OPPORTUNITY_PLANNER_POLICY } from '../src/domain/discovery-contract.js';
import { validateResult, modelRequest, FIELDS } from '../src/domain/opportunity-keywords.mjs';
import { semanticCampaign, compileSemanticTurn } from '../src/application/semantic-campaign.js';
import { initialDiscoveryQueries, createCoverageExpansion } from '../src/application/coverage-queries.js';
import { validateCampaignPlan } from '../src/domain/campaign-plan.js';
import type { IntentInput } from '../src/shared/semantic-intent.js';
import type { JsonModelRequest, ModelGateway } from '../src/application/ports/model-gateway.js';
import { prepareSemanticDraft, readDialogue, applyPreset, savePreset } from '../src/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import { createProductionService, type ProductionHost } from '../src/application/production-service.js';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';

const input = (prompt: string, context = ''): IntentInput => ({ stage: 'S2', prompt, context, seeds: [], revision: 1, answers: [], edits: [] });
function response(intent: IntentInput): any {
  const facets = originalRequestFacets(intent), search = facets.filter(f => f.kind === 'SEARCH');
  return { state: 'READY', intent_revision: intent.revision, understanding: 'Tìm các cơ hội theo các ý gốc', target_roles: [], constraints: [],
    intent: Object.keys(FIELDS).map(field => ({ field, value: 'Chưa đặt giới hạn', status: 'UNSPECIFIED', evidence: [] })),
    branches: search.map((f, index) => ({ id: 'b' + index, label: f.quote, anchor: f.literal_query ?? 'chủ đề', source: f.source, quote: f.quote, scope: 'CORE', reason: 'Ý được nêu trực tiếp', facet_ids: [f.id] })),
    queries: search.map((f, index) => ({ text: f.literal_query ?? 'chủ đề', branch_id: 'b' + index, kind: 'EXACT', anchor: f.literal_query ?? 'chủ đề', family_id: 'TOPIC', facet_ids: [f.id], rationale: 'Chủ đề gốc', risk: 'LOW' })),
    coverage: facets.map(f => ({ facet_id: f.id, disposition: f.kind, branch_ids: f.kind === 'SEARCH' ? ['b' + search.indexOf(f)] : [], reason: 'Giữ nguyên ý và loại nguồn', superseded_by: null })),
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], caveats: [], improvements: [] };
}
const campaign = (intent: IntentInput, raw: any) => semanticCampaign({ prompt: intent.prompt, brand_context: intent.context,
  planner_policy: OPPORTUNITY_PLANNER_POLICY, suitable_target: 5000, raw_cap: 50000, model_usd: 3 }, intent, validateResult(raw, 'B', intent, {}));

test('independent inventory retains cheap-price and every requested original clause before model generation', () => {
  const i = input('Tìm người mua đất nền. Mua đất làm nhà ở, đất nền để ở. đất đai đầy đủ pháp lý. Mua đất giá rẻ.', 'Tôi có 1000 lô đất');
  const before = originalRequestFacets(i), raw = response(i);
  assert.equal(before.filter(f => f.kind === 'SEARCH').length, 5);
  assert.equal(before.at(-1)!.kind, 'BUSINESS_CONTEXT');
  for (const f of before) assert.equal((f.source === 'PROMPT' ? i.prompt : i.context).slice(f.start, f.end), f.quote);
  raw.coverage.pop();
  assert.throws(() => validateResult(raw, 'B', i, {}), /thiếu ý gốc/);
  const missing = response(i), price = before.find(f => f.quote === 'Mua đất giá rẻ')!;
  missing.coverage.find((c: any) => c.facet_id === price.id).disposition = 'BUSINESS_CONTEXT';
  assert.throws(() => validateResult(missing, 'B', i, {}), /đổi loại ý gốc/);
  const valid = response(i); valid.queries.at(-1).text = 'đất';
  const result = campaign(i, valid);
  assert.ok(result.queries.some(q => q.text === 'Mua đất giá rẻ'));
  assert.ok(result.discovery_plan!.queries.some(q => q.origin === 'LITERAL_INPUT' && q.facet_ids.includes(price.id)));
});

test('synonyms and translated vocabulary are separate from exact source evidence', () => {
  const i = input('Mua đất làm nhà ở, đất nền để ở'), raw = response(i);
  raw.branches[0].anchor = 'đất để ở'; raw.queries[0].anchor = 'đất để ở'; raw.queries[0].text = 'an cư nhà đất';
  const parsed = validateResult(raw, 'B', i, {});
  assert.equal(parsed.queries[0]!.rejection, null); assert.equal(parsed.queries[0]!.kind, 'PARAPHRASE');
  raw.branches[0].quote = 'Mua đất để ở';
  assert.throws(() => validateResult(raw, 'B', i, {}), /trích dẫn/);
  const english = input('Find stroller discussions'), translated = response(english);
  translated.queries[0].text = 'xe đẩy em bé'; translated.queries[0].kind = 'EXACT';
  const value = validateResult(translated, 'B', english, {});
  assert.equal(value.queries[0]!.rejection, null); assert.equal(value.queries[0]!.kind, 'PARAPHRASE');
});

test('operator-side learner queries are rejected while a genuine teacher query survives', () => {
  const i = input('Tìm người muốn học piano'), raw = response(i);
  raw.queries[0].text = 'cần tìm người học piano';
  raw.queries.push({ ...raw.queries[0], text: 'tìm giáo viên piano', family_id: 'PROVIDER_SEARCH', kind: 'PARAPHRASE' });
  const value = validateResult(raw, 'B', i, {});
  assert.match(value.queries[0]!.rejection!, /đảo vai/);
  assert.equal(value.queries[1]!.rejection, null);
  assert.ok(value.queries.some(q => !q.rejection && q.text === 'học piano'));
});

test('geographic preference and seller context do not narrow post-only, unlimited-age defaults', () => {
  const i = input('Tìm người đi spa. Ưu tiên Hà Nội', 'Tôi có spa ở Hà Nội'), raw = response(i);
  const geography = raw.intent.find((f: any) => f.field === 'geography');
  Object.assign(geography, { value: 'Hà Nội', status: 'CONFIRMED', evidence: [{ source: 'PROMPT', quote: 'Ưu tiên Hà Nội' }] });
  raw.constraints = [{ text: 'Hà Nội', strength: 'REQUIRED', source: 'PROMPT', quote: 'Ưu tiên Hà Nội' }];
  const value = campaign(i, raw);
  assert.deepEqual(value.required_geographies, []); assert.deepEqual(value.preferred_geographies, ['Hà Nội']);
  assert.equal(value.max_age_days, null); assert.deepEqual(value.languages, ['vi']);
  assert.equal(value.budget.max_run_minutes, 720); assert.equal(value.budget.raw_cap, 50000); assert.equal(value.suitable_target, 5000);
  assert.equal(value.watch.enabled, false); assert.equal(value.budget.comments_per_capture, 0);
  assert.ok(value.inclusions.includes('Ưu tiên, không bắt buộc: Hà Nội'));
  const strict = input('Tìm người đi spa. Chỉ tại Hà Nội'), hard = response(strict);
  Object.assign(hard.intent.find((f: any) => f.field === 'geography'), { value: 'Hà Nội', status: 'CONFIRMED', evidence: [{ source: 'PROMPT', quote: 'Chỉ tại Hà Nội' }] });
  assert.deepEqual(campaign(strict, hard).required_geographies, ['Hà Nội']);
});

test('consumer timing and not-only geography never become unintended collection restrictions', () => {
  const i = input('Tìm người muốn đi spa trong 7 ngày tới. Không chỉ tại Hà Nội'), raw = response(i);
  Object.assign(raw.intent.find((f: any) => f.field === 'time'), { value: 'Có dự định đi spa trong tuần tới', status: 'CONFIRMED',
    evidence: [{ source: 'PROMPT', quote: 'Tìm người muốn đi spa trong 7 ngày tới' }] });
  Object.assign(raw.intent.find((f: any) => f.field === 'geography'), { value: 'Hà Nội và nơi khác', status: 'CONFIRMED',
    evidence: [{ source: 'PROMPT', quote: 'Không chỉ tại Hà Nội' }] });
  const value = campaign(i, raw);
  assert.equal(value.max_age_days, null); assert.deepEqual(value.required_geographies, []);
  assert.ok(!value.inclusions.includes('Hà Nội và nơi khác'));
  for (const [prompt, quote, days] of [
    ['Tìm bài viết trong 7 ngày qua về spa', 'bài viết trong 7 ngày qua', 7],
    ['Find spa posts from the last 2 weeks', 'posts from the last 2 weeks', 14],
  ] as const) {
    const explicit = input(prompt), answer = response(explicit);
    Object.assign(answer.intent.find((f: any) => f.field === 'time'), { value: quote, status: 'CONFIRMED', evidence: [{ source: 'PROMPT', quote }] });
    assert.equal(campaign(explicit, answer).max_age_days, days);
  }
});

test('new desktop drafts pin v2 and reuse complete post-only plans and presets without another request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-draft-')), i = input('piano cafe, mượn đàn piano');
  let calls = 0;
  const config = { enabled: true, filterMode: 'CONSISTENT' as const, languageScope: 'VIETNAMESE' as const,
    prompt: i.prompt, brandContext: '', totalTarget: 5000, rawCap: 50000, budgetUsd: 3, commentsEnabled: false };
  const gatewayFactory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ ...options, mockTransport: true,
    apiKey: 'synthetic', maxAttempts: 1, minRequestIntervalMs: 0, fetch: async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body)), request = JSON.parse(body.contents[0].parts[0].text);
      assert.equal(request.ORIGINAL_FACETS.length, 2);
      return new Response(JSON.stringify({ modelVersion: 'fixture', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(response(i)) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 } }), { status: 200 });
    } });
  try {
    const draft = await prepareSemanticDraft({ directory, config, gatewayFactory }); assert.ok('campaign' in draft);
    assert.equal(draft.campaign.planner_policy, OPPORTUNITY_PLANNER_POLICY); assert.ok(draft.campaign.discovery_plan);
    assert.equal(draft.criteriaCapabilities.extendedClassificationCriteria, true);
    assert.deepEqual((await prepareSemanticDraft({ directory, config, gatewayFactory, resumeRunId: draft.runId })).revision, draft.revision);
    assert.equal(readDialogue({ directory, runId: draft.runId })!.plan.original_facets!.length, 2);
    const saved = savePreset({ directory, name: 'Discovery v2', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
    const preset = applyPreset({ directory, presetId: saved.presetId, presetVersion: saved.version,
      runtime: { filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE', totalTarget: 5000, rawCap: 50000, budgetUsd: 3, commentsEnabled: false } });
    assert.deepEqual(preset.campaign.discovery_plan, draft.campaign.discovery_plan); assert.equal(calls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('all 24 families have distinct IDs and a 216-query portfolio survives serialization, reserve and restart with zero calls', async () => {
  assert.equal(DISCOVERY_FAMILIES.length, 24); assert.equal(new Set(DISCOVERY_FAMILIES.map(f => f[0])).size, 24);
  const i = input('piano'), raw = response(i), base = raw.queries[0];
  raw.queries = DISCOVERY_FAMILIES.flatMap(([family_id], family) => Array.from({ length: 9 }, (_, variant) => ({ ...base,
    text: `piano nhóm ${family} cách ${variant}`, family_id, kind: 'PARAPHRASE' })));
  const value = campaign(i, raw); assert.equal(value.queries.length, 217);
  validateCampaignPlan(JSON.parse(JSON.stringify(value)));
  const initial = initialDiscoveryQueries(value, 'facebook'); assert.equal(initial.length, 48);
  assert.equal(new Set(value.discovery_plan!.queries.filter(q => q.wave === 0).map(q => q.family_id)).size, 24);
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-v2-'));
  let calls = 0;
  const gateway = { generateJson: () => { calls++; throw Error('NO_PAID_CALLS'); }, summary: () => { throw Error('NO_PAID_CALLS'); } } as unknown as ModelGateway;
  try {
    const expand = createCoverageExpansion(directory, value, gateway, new AbortController().signal);
    const reserve = await expand(); assert.equal(reserve.length, value.queries.length - initial.length);
    assert.deepEqual(await expand(), reserve);
    assert.deepEqual(await createCoverageExpansion(directory, value, gateway, new AbortController().signal)(), reserve);
    assert.equal(calls, 0); assert.equal(new Set([...initial, ...reserve]).size, value.queries.length);
    const persisted = JSON.parse(readFileSync(join(directory, 'coverage-query-expansion.json'), 'utf8'));
    assert.equal(persisted.state, 'FROZEN_RESERVE'); assert.ok(persisted.waves.at(-1).wave > 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('OFF reuses a saved v2 portfolio including every frozen reserve query without model calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-off-')), i = input('piano'), raw = response(i);
  const base = raw.queries[0];
  raw.queries = DISCOVERY_FAMILIES.flatMap(([family_id], family) => Array.from({ length: 3 }, (_, variant) => ({ ...base,
    text: `piano nhóm ${family} cách ${variant}`, family_id, kind: 'PARAPHRASE' })));
  let planningCalls = 0, unexpectedCalls = 0;
  const config = { enabled: true, filterMode: 'CONSISTENT' as const, languageScope: 'VIETNAMESE' as const,
    prompt: i.prompt, brandContext: '', totalTarget: 5000, rawCap: 50000, budgetUsd: 3, commentsEnabled: false };
  const gatewayFactory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ ...options, mockTransport: true,
    apiKey: 'synthetic', maxAttempts: 1, minRequestIntervalMs: 0, fetch: async () => {
      planningCalls++; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 } }), { status: 200 });
    } });
  let pipeline: Awaited<ReturnType<typeof createOpportunityPipeline>> | undefined;
  try {
    const draft = await prepareSemanticDraft({ directory, config, gatewayFactory }); assert.ok('campaign' in draft);
    const saved = savePreset({ directory, name: 'Broad saved plan', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
    const reused = applyPreset({ directory, presetId: saved.presetId, presetVersion: saved.version,
      runtime: { filterMode: 'OFF', languageScope: 'VIETNAMESE', totalTarget: 5000, rawCap: 50000, budgetUsd: 0, commentsEnabled: false } });
    const args = { directory: join(directory, 'runs', reused.runId), runId: reused.runId, campaign: reused.campaign,
      config: reused.config, platforms: ['facebook', 'threads'] as ('facebook' | 'threads')[],
      gateway: { generateJson: () => { unexpectedCalls++; throw Error('NO_MODEL_IN_OFF'); }, summary: () => { throw Error('NO_MODEL_IN_OFF'); } } as unknown as ModelGateway,
      collectConversation: async () => { throw Error('NO_COMMENTS'); } };
    pipeline = await createOpportunityPipeline(args);
    const initial = pipeline.queries('facebook'), reserve = await pipeline.expandQueries();
    assert.ok(initial.length <= 48); assert.ok(reserve.length > 24);
    assert.equal(new Set([...initial, ...reserve]).size, 73);
    assert.deepEqual([...initial, ...reserve], reused.campaign.queries.map(q => q.text));
    await pipeline.close(); pipeline = await createOpportunityPipeline(args);
    assert.deepEqual(await pipeline.expandQueries(), reserve);
    assert.equal(planningCalls, 1); assert.equal(unexpectedCalls, 0);
    assert.equal(pipeline.gateway.summary().billable_attempts, 0);
  } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('seeds retain explicit lineage and the model receives original facets and the full family catalog', () => {
  const i = input('piano'); i.seeds = ['piano cafe', 'piano sinh viên'];
  const request = modelRequest('B', i, {}), value = campaign(i, response(i));
  assert.equal((request.input.ORIGINAL_FACETS as any[]).length, 3);
  assert.equal((request.input.FAMILY_CATALOG as any[]).length, 24);
  assert.ok(value.queries.some(q => q.text === 'piano cafe'));
  assert.ok(value.discovery_plan!.facets.some(f => f.source === 'SEED' && f.quote === 'piano sinh viên'));
});

test('a coverage failure receives bounded repair using the same original inventory, not a new user intent', async () => {
  const i = input('piano cafe, mượn đàn piano'), requests: JsonModelRequest[] = [];
  const gateway = { generateJson: async (request: JsonModelRequest) => {
    requests.push(request); const value = response(i); if (requests.length === 1) value.coverage.pop();
    return { value, invocation_id: 'fixture-' + requests.length, request_hash: 'a'.repeat(64), model: 'fixture', cache_hit: false };
  }, summary: () => ({}) } as unknown as ModelGateway;
  const result = await compileSemanticTurn({ prompt: i.prompt, planner_policy: OPPORTUNITY_PLANNER_POLICY }, i, gateway);
  assert.equal(requests.length, 2); assert.ok(result.campaign?.discovery_plan);
  assert.deepEqual((requests[0]!.input as any).ORIGINAL_FACETS, (requests[1]!.input as any).ORIGINAL_FACETS);
  assert.equal((requests[1]!.input as any).VALIDATION_REPAIR.details.code, 'ORIGINAL_FACET_COVERAGE');
});

test('policy-as-user evidence is rejected and repair preserves explicitly requested travelers without fabricating context', async () => {
  const i = input('Tìm người đang muốn đi du lịch Hà Giang'), requests: JsonModelRequest[] = [];
  const valid = response(i);
  valid.target_roles = ['Người muốn đi du lịch Hà Giang'];
  Object.assign(valid.intent.find((f: any) => f.field === 'target_roles'), { value: valid.target_roles[0], status: 'CONFIRMED',
    evidence: [{ source: 'PROMPT', quote: i.prompt }] });
  const invalid = structuredClone(valid);
  Object.assign(invalid.intent.find((f: any) => f.field === 'purpose'), { value: 'Market research', status: 'CONFIRMED',
    evidence: [{ source: 'CONTEXT', quote: 'broad Vietnamese social-post discovery portfolio for market research and helpful business participation' }] });
  Object.assign(invalid.intent.find((f: any) => f.field === 'exclude'), { value: 'Supplier advertisements', status: 'CONFIRMED',
    evidence: [{ source: 'CONTEXT', quote: 'Exclude supplier advertisements' }] });
  assert.throws(() => validateResult(invalid, 'B', i, {}), (e: any) => e.details?.code === 'INTENT_FIELD_EVIDENCE');
  const gateway = { generateJson: async (request: JsonModelRequest) => {
    requests.push(request);
    return { value: requests.length === 1 ? invalid : valid, invocation_id: 'fixture-' + requests.length,
      request_hash: 'a'.repeat(64), model: 'fixture', cache_hit: false };
  }, summary: () => ({}) } as unknown as ModelGateway;
  const result = await compileSemanticTurn({ prompt: i.prompt, planner_policy: OPPORTUNITY_PLANNER_POLICY }, i, gateway);
  assert.equal(requests.length, 2); assert.ok(result.campaign);
  const repair = (requests[1]!.input as any).VALIDATION_REPAIR;
  assert.equal(repair.details.code, 'INTENT_FIELD_EVIDENCE');
  assert.match(repair.instruction, /NO evidence may cite CONTEXT/);
  assert.match(repair.instruction, /Do not erase a role the user explicitly requested/);
  assert.equal((requests[1]!.input as any).CONTEXT, null);
  assert.equal((requests[1]!.input as any).PROMPT, i.prompt);
  assert.deepEqual(result.campaign.audience, valid.target_roles);
  assert.deepEqual(result.campaign.exclusions, []);
});

test('default v2 desktop plan starts through the real pipeline with frozen queries, 720 minutes and no comment jobs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-start-')), i = input('piano cafe, mượn đàn piano');
  const profileId = 'csd-00000000-0000-4000-8000-000000000002';
  const host: ProductionHost = { list: async () => [{ id: profileId, platform: 'threads', label: 'Fixture', createdAt: '2026-11-06T00:00:00Z',
    accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 }, open: false, persistenceError: null }],
    sessionStatus: async () => true, create: async () => { throw Error('NO_PROFILE_CREATE'); }, openLogin: async () => { throw Error('NO_LOGIN'); } };
  let calls = 0, comments = 0, collected = 0;
  const gatewayFactory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ ...options, mockTransport: true,
    apiKey: 'synthetic', maxAttempts: 1, minRequestIntervalMs: 0, fetch: async () => {
      calls++; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(response(i)) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 } }), { status: 200 });
    } });
  const service = createProductionService({ directory, version: 'test', host, watchAfterDiscovery: false,
    prepareCampaignDraft: args => prepareSemanticDraft({ ...args, gatewayFactory }),
    createOpportunity: args => createOpportunityPipeline({ ...args, gateway: gatewayFactory({ directory: join(args.directory, 'opportunity'), budgetUsd: args.config.budgetUsd }) }),
    collectConversation: async () => { comments++; throw Error('NO_COMMENTS'); },
    collect: async args => { collected++; assert.equal(args.config.maxMinutes, 720); assert.deepEqual(args.config.queries, ['piano cafe', 'mượn đàn piano']);
      return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 }, session_flush: 'OK' }; } });
  try {
    service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 5000, opportunity: { enabled: true, filterMode: 'CONSISTENT', languageScope: 'VIETNAMESE',
      prompt: i.prompt, brandContext: '', totalTarget: 5000, rawCap: 50000, budgetUsd: 3, commentsEnabled: false } });
    const draft = (await service.prepareCampaign()).campaignDraft!; assert.equal(draft.campaign.planner_policy, OPPORTUNITY_PLANNER_POLICY);
    await service.start({ profiles: [{ platform: 'threads', profileId }] }); await service.settled();
    const state = await service.getState(); assert.equal(state.run!.id, draft.runId);
    assert.equal(calls, 1); assert.equal(comments, 0); assert.equal(collected, 1);
    assert.equal(state.run!.opportunity!.watchActive, false);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});


test('natural geography preference and exclusion lists never become required search queries', () => {
  const facets = originalRequestFacets(input('Tìm quán cafe chill. Không giới hạn tuổi bài; địa bàn chỉ là ưu tiên, vẫn nhận bài ngoài khu vực. Loại bài chào bán, quảng cáo quán/dịch vụ và bài chỉ trùng từ nhưng lạc đề. Tìm bạn trò chuyện.'));
  assert.equal(facets.find(f => f.quote === 'địa bàn chỉ là ưu tiên')!.kind, 'CONSTRAINT');
  assert.equal(facets.find(f => f.quote.startsWith('quảng cáo quán'))!.kind, 'EXCLUSION');
  assert.equal(facets.find(f => f.quote === 'Tìm bạn trò chuyện')!.kind, 'SEARCH');
  const i = input('Tìm quán cafe chill');
  assert.deepEqual((modelRequest('B', i, {}) as any).input.INTENT_FIELD_CATALOG, Object.keys(FIELDS));
});


test('a narrowed cafe plan retains unqualified source-backed cafe chill anchors', () => {
  const i = input('Tìm quán cafe chill'); const value = response(i);
  value.branches[0].anchor = 'quán cafe chill'; value.queries[0].text = 'quán cafe chill yên tĩnh';
  value.queries[0].kind = 'PARAPHRASE';
  const plan = validateResult(value, 'B', i, {});
  assert.ok(plan.queries.some(q => !q.rejection && q.text === 'quán cafe chill'));
  assert.ok(plan.queries.some(q => !q.rejection && q.text === 'cafe chill'));
  assert.ok(!plan.queries.some(q => q.origin === 'BARE_ANCHOR' && /yên tĩnh/u.test(q.text)));
});
