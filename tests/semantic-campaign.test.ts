import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSemanticDraft, continueSemanticDraft, readDialogue, readDraft, resolveDraftForStart, savePreset, applyPreset, markDraftStarted, CampaignDraftPreparationError } from '../src/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import { createProductionService } from '../src/application/production-service.js';
import { FIELDS, activeAnswers } from '../src/domain/semantic-keywords.mjs';
import { SEMANTIC_PLANNER_POLICY, INTENT_OPPORTUNITY_FILTER_VERSION } from '../src/domain/campaign-plan.js';
import { GOAL_FILTER_VERSION } from '../src/domain/goal-filter.js';
import type { CampaignDraftView } from '../src/shared/campaign-drafts.js';
import type { CampaignDialogueView } from '../src/shared/semantic-intent.js';
import type { OpportunityConfig } from '../src/shared/production-api.js';
import { semanticCampaign } from '../src/application/semantic-campaign.js';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';

const config: OpportunityConfig = { enabled: true, prompt: 'Tìm người quan tâm piano', brandContext: '', totalTarget: 10, threadsShare: .8, rawCap: 30, budgetUsd: 3, commentsEnabled: false };
const question = { id: 'who', target_field: 'target_roles', type: 'single_select', prompt: 'Bạn tìm ai?', required: true,
  options: [{ id: 'buyer', label: 'Người hỏi mua piano' }, { id: 'seller', label: 'Người rao bán piano' }], reason: 'Vai trò quyết định loại bài được nhận.' };
function plan(request: Record<string, any>) {
  const lawyer = request.PROMPT.includes('luật sư'), anchor = lawyer ? 'luật sư' : 'piano';
  const edit = request.ACTIVE_EDITS?.find((item: any) => item.field === 'target_roles'), answer = request.ACTIVE_ANSWERS?.find((item: any) => item.target_field === 'target_roles');
  const role = edit?.value ?? answer?.answer ?? (lawyer ? 'người muốn thuê luật sư' : 'Chưa rõ');
  const ready = lawyer || !!edit || !!answer;
  const evidence = edit ? { source: 'EDIT', quote: edit.value } : answer ? { source: 'ANSWER', quote: answer.answer } : { source: 'PROMPT', quote: role };
  return { state: ready ? 'READY' : 'NEEDS_CLARIFICATION', intent_revision: request.revision, understanding: role, target_roles: ready ? [role] : [],
    constraints: [], branches: [{ id: 'main', label: anchor, anchor, source: 'PROMPT', quote: anchor, scope: 'CORE', reason: 'Chủ đề gốc' }],
    questions: ready ? [] : [question], unresolved_fields: ready ? [] : ['target_roles'], unconfirmed_assumptions: [],
    intent: Object.keys(FIELDS).map(field => ({ field, value: field === 'target_roles' ? role : 'Chưa đặt giới hạn',
      status: field === 'target_roles' ? ready ? 'CONFIRMED' : 'UNRESOLVED' : 'UNSPECIFIED', evidence: field === 'target_roles' && ready ? [evidence] : [] })),
    queries: ready ? [{ text: lawyer ? 'cần luật sư' : role.includes('bán') ? 'bán đàn piano' : 'cần mua đàn piano', branch_id: 'main',
      kind: 'PARAPHRASE', anchor, rationale: 'Cách người cần tìm diễn đạt', risk: 'LOW' }] : [], caveats: [], improvements: [] };
}
function harness(directory: string) {
  const requests: Record<string, any>[] = []; let fail = false, invalid = 0, uncovered = false;
  const factory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ mockTransport: true, ...options, apiKey: 'synthetic-key',
    minRequestIntervalMs: 0, maxAttempts: 1, fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)), request = JSON.parse(body.contents[0].parts[0].text); requests.push(request);
      if (fail) throw Error('synthetic network failure');
      const value = plan(request);
      if (invalid-- > 0) value.branches[0]!.anchor = 'cần luật sư';
      if (uncovered) value.branches.push({ ...value.branches[0]!, id: 'missing' });
      return new Response(JSON.stringify({ modelVersion: 'fixture', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, totalTokenCount: 1300 } }), { status: 200 });
    } });
  return { directory, plannerPolicy: SEMANTIC_PLANNER_POLICY as typeof SEMANTIC_PLANNER_POLICY, gatewayFactory: factory, requests, fail: (v: boolean) => { fail = v; }, invalid: (n: number) => { invalid = n; }, uncovered: () => { uncovered = true; } };
}
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-semantic-'));
  try { await work(directory); } finally { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); }
}
const answer = (view: CampaignDialogueView, option = 'buyer') => ({ runId: view.runId, expectedRevision: view.revision,
  answers: [{ question_id: 'who', selected_option_ids: [option], raw_text: '' }] });
const reference = (draft: CampaignDraftView) => ({ runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash });

test('explicit Vietnamese collection setting survives semantic planning and presets without inventing a country', async () => temporary(async directory => {
  const h = harness(directory);
  const draft = await prepareSemanticDraft({ ...h, config: { enabled: true, filterMode: 'STANDARD', languageScope: 'VIETNAMESE',
    prompt: 'tìm người muốn thuê luật sư', brandContext: '', totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false } });
  assert.ok('campaign' in draft); assert.deepEqual(draft.campaign.languages, ['vi']);
  assert.deepEqual(draft.campaign.required_geographies, []); assert.equal(draft.config.languageScope, 'VIETNAMESE');
  const saved = savePreset({ directory, name: 'Vietnamese scope', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
  const applied = applyPreset({ directory, presetId: saved.presetId, presetVersion: saved.version,
    runtime: { filterMode: 'STANDARD', languageScope: 'VIETNAMESE', totalTarget: 10, rawCap: 30, budgetUsd: 3, commentsEnabled: false } });
  assert.deepEqual(applied.campaign.languages, ['vi']); assert.equal(h.requests.length, 1);
}));

test('lawyer regression repairs a literal anchor without losing paraphrases, intent revision or paid attempts', async () => temporary(async directory => {
  const h = harness(directory); h.invalid(1);
  const draft = await prepareSemanticDraft({ ...h, config: { ...config, prompt: 'tìm người muốn thuê luật sư' } });
  assert.ok('campaign' in draft); assert.equal(draft.campaign.planner_policy, SEMANTIC_PLANNER_POLICY);
  assert.equal(draft.campaign.filter_version, GOAL_FILTER_VERSION);
  assert.deepEqual(draft.criteria.queries.map(q => q.text), ['cần luật sư']);
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1]!.revision, 1);
  assert.equal(h.requests[1]!.VALIDATION_REPAIR.details.code, 'BRANCH_EVIDENCE');
  assert.equal(draft.cost.billableAttempts, 2);
  assert.equal(readdirSync(join(directory, 'collections', draft.runId, 'opportunity', 'intent-attempts')).length, 2);
  assert.equal(resolveDraftForStart({ directory, ...reference(draft) }).campaign.version, draft.campaign.version);
}));
test('material ambiguity stays durable without queries; answers and revised answers update one campaign and preserve history', async () => temporary(async directory => {
  const h = harness(directory), initial = await prepareSemanticDraft({ ...h, config }); assert.ok('plan' in initial);
  assert.equal(initial.plan.state, 'NEEDS_CLARIFICATION'); assert.deepEqual(initial.plan.queries, []);
  assert.throws(() => resolveDraftForStart({ directory, runId: initial.runId, expectedRevision: initial.revision, expectedConfigHash: initial.configHash }), /INTENT_UNRESOLVED/);
  const reopened = await prepareSemanticDraft({ ...h, config, resumeRunId: initial.runId }); assert.deepEqual(reopened, initial); assert.equal(h.requests.length, 1);
  await assert.rejects(continueSemanticDraft({ ...h, request: { ...answer(initial), answers: [] } }), /ANSWER_INVALID/);
  const ready = await continueSemanticDraft({ ...h, request: answer(initial) }); assert.ok('campaign' in ready);
  assert.deepEqual(ready.criteria.audience, ['Người hỏi mua piano']); assert.equal(ready.runId, initial.runId);
  const current = readDialogue({ directory, runId: initial.runId })!;
  const revised = await continueSemanticDraft({ ...h, request: { ...answer(current, 'seller'), editAnswerId: current.input.answers[0]!.answer_id } });
  assert.ok('campaign' in revised); assert.deepEqual(revised.criteria.audience, ['Người rao bán piano']);
  const latest = readDialogue({ directory, runId: initial.runId })!;
  assert.equal(latest.input.answers.length, 2); assert.equal(activeAnswers(latest.input).length, 1);
  assert.equal(h.requests.at(-1)!.PREVIOUS_CANDIDATE.state, 'READY');
  await assert.rejects(continueSemanticDraft({ ...h, request: answer(initial) }), /REVISION_CONFLICT/);
  markDraftStarted({ directory, ...reference(revised) });
  await assert.rejects(continueSemanticDraft({ ...h, request: answer(latest) }), /ALREADY_STARTED/);
}));
test('failed answer submission remains pending, blocks old ready plan, resumes exact input and shares ledger', async () => temporary(async directory => {
  const h = harness(directory), initial = await prepareSemanticDraft({ ...h, config }); assert.ok('plan' in initial);
  const ready = await continueSemanticDraft({ ...h, request: answer(initial) }); assert.ok('campaign' in ready);
  const current = readDialogue({ directory, runId: ready.runId })!; h.fail(true);
  await assert.rejects(continueSemanticDraft({ ...h, request: { runId: ready.runId, expectedRevision: current.revision,
    edits: [{ field: 'target_roles', value: 'Chỉ người bán piano' }] } }));
  assert.throws(() => resolveDraftForStart({ directory, ...reference(ready) }), /INTENT_UNRESOLVED/);
  const failedRequest = h.requests.at(-1); h.fail(false);
  const resumed = await prepareSemanticDraft({ ...h, config, resumeRunId: ready.runId }); assert.ok('campaign' in resumed);
  assert.deepEqual(h.requests.at(-1), failedRequest); assert.deepEqual(resumed.criteria.audience, ['Chỉ người bán piano']);
  assert.ok(resumed.cost.unknownUpperUsd > 0); assert.ok(resumed.cost.measuredUsd >= ready.cost.measuredUsd);
  assert.equal(readDraft({ directory, runId: ready.runId }).revision, resumed.revision);
}));
test('uncovered core branches cannot produce a runnable campaign even after bounded repair', async () => temporary(async directory => {
  const h = harness(directory); h.uncovered();
  await assert.rejects(prepareSemanticDraft({ ...h, config: { ...config, prompt: 'tìm người muốn thuê luật sư' } }), /SEMANTIC_VALIDATION_FAILED/);
  assert.equal(h.requests.length, 2);
}));
test('explicit retry after two invalid model responses uses a fresh generation instead of replaying invalid cache forever', async () => temporary(async directory => {
  const h = harness(directory), lawyer = { ...config, prompt: 'tìm người muốn thuê luật sư' }; h.invalid(2);
  let runId = '';
  try { await prepareSemanticDraft({ ...h, config: lawyer }); assert.fail('Expected invalid anchor'); }
  catch (error) { assert.ok(error instanceof CampaignDraftPreparationError); runId = error.runId; }
  assert.equal(h.requests.length, 2);
  const retried = await prepareSemanticDraft({ ...h, config: lawyer, resumeRunId: runId });
  assert.ok('campaign' in retried); assert.equal(retried.runId, runId); assert.equal(h.requests.length, 3);
  assert.equal(retried.cost.billableAttempts, 3);
}));
test('saved semantic presets keep the confirmed objective and exact query set without another model request', async () => temporary(async directory => {
  const h = harness(directory), draft = await prepareSemanticDraft({ ...h, config: { ...config, prompt: 'tìm người muốn thuê luật sư' } }); assert.ok('campaign' in draft);
  const preset = savePreset({ directory, name: 'Tìm khách thuê luật sư', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
  const { totalTarget, threadsShare, rawCap, budgetUsd, commentsEnabled } = config;
  const applied = applyPreset({ directory, presetId: preset.presetId, presetVersion: preset.version, runtime: { totalTarget, threadsShare: threadsShare!, rawCap, budgetUsd, commentsEnabled } });
  assert.deepEqual(applied.campaign.intent_resolution, draft.campaign.intent_resolution); assert.deepEqual(applied.criteria, draft.criteria);
  assert.equal(h.requests.length, 1); assert.equal(applied.cost.billableAttempts, 0);
}));
test('semantic ready draft commits unchanged to collection and resumes without calling the planner again', async () => temporary(async directory => {
  const h = harness(directory), draft = await prepareSemanticDraft({ ...h, config: { ...config, prompt: 'tìm người muốn thuê luật sư' } }); assert.ok('campaign' in draft);
  const options = { directory: join(directory, 'collections', draft.runId), runId: draft.runId, config: draft.config,
    platforms: ['threads' as const], gateway: h.gatewayFactory({ directory: join(directory, 'collections', draft.runId, 'opportunity'), budgetUsd: draft.config.budgetUsd }),
    collectConversation: async () => { throw Error('NO_BROWSER'); } };
  const first = await createOpportunityPipeline({ ...options, campaign: draft.campaign });
  try { assert.deepEqual(first.queries('threads'), ['cần luật sư']); assert.deepEqual(first.campaign, draft.campaign); }
  finally { await first.close(); }
  markDraftStarted({ directory, ...reference(draft) });
  const resumed = await createOpportunityPipeline(options);
  try { assert.deepEqual(resumed.campaign, draft.campaign); assert.equal(h.requests.length, 1); }
  finally { await resumed.close(); }
}));
test('semantic projection keeps a preferred geography soft instead of creating a hard inclusion', async () => {
  const raw = plan({ PROMPT: 'tìm người muốn thuê luật sư', revision: 1 });
  raw.constraints = [{ text: 'Đà Nẵng', strength: 'PREFERRED', source: 'PROMPT', quote: 'Ưu tiên Đà Nẵng' }] as any;
  raw.intent = raw.intent.map(item => item.field === 'geography' ? { ...item, value: 'Đà Nẵng', status: 'CONFIRMED', evidence: [{ source: 'PROMPT', quote: 'Ưu tiên Đà Nẵng' }] } : item);
  const intent = { stage: 'S2' as const, prompt: 'tìm người muốn thuê luật sư. Ưu tiên Đà Nẵng', context: '', seeds: [], revision: 1, answers: [], edits: [] };
  const { validateResult } = await import('../src/domain/semantic-keywords.mjs');
  const campaign = semanticCampaign({ prompt: intent.prompt }, intent, validateResult(raw, 'B', intent, {}));
  assert.equal(campaign.inclusions.includes('Đà Nẵng'), false);
  assert.ok(campaign.inclusions.includes('Ưu tiên, không bắt buộc: Đà Nẵng')); assert.deepEqual(campaign.required_geographies, []);
});
test('desktop service exposes clarification after restart and blocks collection until a ready reviewed draft exists', async () => temporary(async directory => {
  const h = harness(directory); let collected = 0;
  const options = { directory, version: 'test', host: { list: async () => [], sessionStatus: async () => false,
    create: async () => { throw Error('NO_CREATE'); }, openLogin: async () => {} },
    collect: async () => { collected++; throw Error('NO_COLLECT'); },
    prepareCampaignDraft: (v: Parameters<typeof prepareSemanticDraft>[0]) => prepareSemanticDraft({ ...v, plannerPolicy: SEMANTIC_PLANNER_POLICY, gatewayFactory: h.gatewayFactory }),
    continueCampaignDraft: (v: Parameters<typeof continueSemanticDraft>[0]) => continueSemanticDraft({ ...v, gatewayFactory: h.gatewayFactory }) };
  const service = createProductionService(options);
  service.saveConfig({ schemaVersion: 2, keywords: [], minimumPosts: 10, opportunity: config });
  await assert.rejects(service.start({ profiles: [] }), /DRAFT_REQUIRED/);
  const state = await service.prepareCampaign(); assert.ok(state.campaignDialogue); assert.equal(state.campaignDraft, undefined);
  const restarted = createProductionService(options); assert.equal((await restarted.getState()).campaignDialogue!.revision, state.campaignDialogue.revision);
  await assert.rejects(restarted.start({ profiles: [] }), /INTENT_UNRESOLVED/);
  const ready = await restarted.continueCampaign(answer(state.campaignDialogue)); assert.ok(ready.campaignDraft);
  assert.equal(ready.campaignDialogue!.plan.state, 'READY'); assert.equal(collected, 0);
  const pointer = JSON.parse(readFileSync(join(directory, 'active-campaign-draft.json'), 'utf8')); assert.equal(pointer.state, 'READY');
}));
