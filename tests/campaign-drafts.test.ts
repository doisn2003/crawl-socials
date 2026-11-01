import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { applyPreset, CampaignDraftPreparationError, listPresets, markDraftStarted, prepareDraft, readDraft, readDraftCost,
  resolveDraftForStart, savePreset, updateDraft } from '../src/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import { atomicJson } from '../src/infrastructure/config/user-config.js';
import { classifierRecipe } from '../src/application/classification-service.js';
import { contentHash } from '../src/domain/conversation.js';
import { campaignVersion, GROUNDED_CONSTRAINT_PLANNER_POLICY, OPPORTUNITY_FILTER_VERSION, TEMPORAL_OPPORTUNITY_FILTER_VERSION } from '../src/domain/campaign-plan.js';
import { plannerRecipe, plannerRecipeHash } from '../src/application/compile-campaign.js';
import type { OpportunityConfig } from '../src/shared/production-api.js';
import type { CampaignCriteriaPatch } from '../src/shared/campaign-drafts.js';

const config: OpportunityConfig = { enabled: true, prompt: 'Tìm tai nghe chống ồn để làm việc, hỏi pin và độ thoải mái.',
  brandContext: 'Tai nghe dành cho người làm việc', totalTarget: 1000, threadsShare: .8, rawCap: 3000, budgetUsd: 3, commentsEnabled: true };
const plan = { topic: 'Tai nghe chống ồn', audience: ['Người làm việc'], needs: ['pin', 'độ thoải mái'], participation_intents: ['hỏi trải nghiệm'],
  research_intents: ['so sánh sản phẩm'], inclusions: ['câu hỏi người dùng'], exclusions: ['tuyển dụng'], assumptions: [],
  queries: [{ text: 'tai nghe chống ồn', family: 'BROAD' }, { text: 'review tai nghe', family: 'EXPERIENCE' },
    { text: 'tai nghe pin', family: 'PROBLEM' }, { text: 'tìm tai nghe', family: 'REQUEST' }],
  constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] } };
const response = (value: unknown = plan) => new Response(JSON.stringify({ modelVersion: 'fixture-model', candidates: [{ finishReason: 'STOP',
  content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 } }), { status: 200 });
function harness(directory: string) {
  let calls = 0, fail = false, value: unknown = plan;
  const systems: string[] = [];
  const factory = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ ...options,
    apiKey: 'synthetic-key', minRequestIntervalMs: 0, maxAttempts: 1, fetch: async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body)) as { systemInstruction: { parts: Array<{ text: string }> } };
      systems.push(body.systemInstruction.parts[0]!.text); if (fail) throw Error('synthetic network failure'); return response(value);
    } });
  return { directory, factory, systems, calls: () => calls, fail: (v: boolean) => { fail = v; }, value: (v: unknown) => { value = v; } };
}
function temporary() { return mkdtempSync(join(tmpdir(), 'csd-campaign-drafts-')); }
function cleanup(directory: string) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-campaign-drafts-'));
  rmSync(directory, { recursive: true, force: true });
}
function digestTree(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) for (const [child, hash] of Object.entries(digestTree(file))) result[join(entry.name, child)] = hash;
    else result[entry.name] = contentHash(readFileSync(file, 'utf8'));
  }
  return result;
}

test('preview and collection reuse one directory, immutable plan and cumulative model ledger', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    assert.equal(h.calls(), 1); assert.ok(draft.cost.measuredUsd > 0); assert.equal(draft.status, 'DRAFT');
    const start = { directory, runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash };
    const resolved = resolveDraftForStart(start);
    assert.equal(resolved.outputDirectory, join(directory, 'collections', draft.runId));
    const gateway = h.factory({ directory: join(resolved.outputDirectory, 'opportunity'), budgetUsd: config.budgetUsd });
    assert.equal(gateway.summary().measured_cost_usd, draft.cost.measuredUsd);
    await gateway.generateJson({ purpose: 'synthetic-classifier', system: 'fixture', input: { post: 'fixture' }, schema: {}, max_output_tokens: 100 });
    assert.equal(h.calls(), 2); assert.ok(gateway.summary().measured_cost_usd > draft.cost.measuredUsd);
    atomicJson(join(resolved.outputDirectory, 'opportunity', 'campaign.json'), resolved.campaign);
    assert.equal(markDraftStarted(start).status, 'STARTED'); assert.equal(markDraftStarted(start).status, 'STARTED');
    assert.throws(() => updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: { needs: ['new'] } }), /ALREADY_STARTED/);
    assert.equal(readDraft({ directory, runId: draft.runId }).campaign.version, draft.campaign.version);
  } finally { cleanup(directory); }
});

test('criteria edits produce CAS revisions, retain original prompt and fail closed on changed runtime config', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    const updated = updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: {
      needs: ['pin dùng cả ngày'], required_geographies: ['Đà Nẵng'], preferred_geographies: ['Hội An'], languages: ['vi'], max_age_days: 30,
      brand_context: 'Bảo hành tại Đà Nẵng', source_priority: ['GROUP', 'PROFILE', 'PAGE', 'UNKNOWN'],
      queries: [{ text: 'tai nghe chống ồn Đà Nẵng', family: 'REQUEST', platforms: ['facebook'] }],
      watch: { enabled: true, revisit_hours: [4, 12], ttl_hours: 48, max_attempts: 2 } } });
    assert.notEqual(updated.revision, draft.revision); assert.notEqual(updated.campaign.version, draft.campaign.version);
    assert.equal(updated.campaign.prompt, config.prompt); assert.equal(updated.config.brandContext, 'Bảo hành tại Đà Nẵng');
    assert.equal(updated.config.budgetUsd, config.budgetUsd); assert.equal(updated.recipeHash, draft.recipeHash);
    assert.equal(updated.sourceHash, draft.sourceHash); assert.equal(updated.userOverrides[0]!.previousRevision, draft.revision);
    assert.equal(updated.cost.measuredUsd, draft.cost.measuredUsd); assert.equal(h.calls(), 1);
    assert.throws(() => updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: { topic: 'stale' } }), /REVISION_CONFLICT/);
    assert.throws(() => resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: updated.revision, expectedConfigHash: draft.configHash }), /CONFIG_MISMATCH/);
    assert.throws(() => updateDraft({ directory, runId: draft.runId, expectedRevision: updated.revision,
      criteriaPatch: { budget: { model_usd: 30 } } as unknown as CampaignCriteriaPatch }), /CRITERIA_INVALID/);
    assert.equal(resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: updated.revision, expectedConfigHash: updated.configHash }).campaign.max_age_days, 30);
  } finally { cleanup(directory); }
});

test('full presets preserve semantic policy and queries with new identities and no planner call or inherited costs', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    const edited = updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: { required_geographies: ['Huế'], max_age_days: 14 } });
    const preset = savePreset({ directory, name: 'Tai nghe người làm việc', source: { kind: 'DRAFT', runId: draft.runId, revision: edited.revision } });
    assert.deepEqual(listPresets({ directory }), [preset]); assert.equal(preset.supported, true);
    const applied = applyPreset({ directory, presetId: preset.presetId, presetVersion: preset.version,
      runtime: { totalTarget: 500, threadsShare: .7, rawCap: 1500, budgetUsd: 1.5, commentsEnabled: false } });
    assert.notEqual(applied.runId, draft.runId); assert.notEqual(applied.campaign.version, edited.campaign.version);
    assert.deepEqual(applied.criteria, edited.criteria); assert.equal(applied.config.prompt, config.prompt); assert.equal(applied.config.brandContext, config.brandContext);
    assert.equal(applied.campaign.suitable_target, 500); assert.equal(applied.campaign.desired_platform_weights.threads, .7);
    assert.equal(applied.campaign.budget.model_usd, 1.5); assert.equal(applied.recipeHash, edited.recipeHash);
    assert.equal(applied.cost.measuredUsd, 0); assert.equal(applied.cost.billableAttempts, 0); assert.equal(applied.source.presetVersion, preset.version);
    assert.equal(h.calls(), 1); assert.equal(existsSync(join(directory, 'collections', applied.runId, 'opportunity', 'model-routing.json')), false);
  } finally { cleanup(directory); }
});

test('cost and draft getters are pure reads while exposing a timestamp for stale preview receipts', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory }), before = digestTree(directory);
    for (let i = 0; i < 3; i++) {
      assert.equal(readDraft({ directory, runId: draft.runId }).cost.capturedAt, draft.cost.capturedAt);
      assert.equal(readDraftCost({ directory, runId: draft.runId }).measuredUsd, draft.cost.measuredUsd);
      resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash });
    }
    assert.deepEqual(digestTree(directory), before); assert.equal(h.calls(), 1);
  } finally { cleanup(directory); }
});

test('failed preview retries retain the same allocation, unknown usage and budget; successful retry does not recompile', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    h.fail(true); let failed: CampaignDraftPreparationError | null = null;
    try { await prepareDraft({ directory, config, gatewayFactory: h.factory }); }
    catch (error) { assert.ok(error instanceof CampaignDraftPreparationError); failed = error; }
    assert.ok(failed); assert.ok(failed.cost.unknownUpperUsd > 0); assert.equal(h.calls(), 1);
    assert.equal(readDraftCost({ directory, runId: failed.runId }).unknownUpperUsd, failed.cost.unknownUpperUsd);
    await assert.rejects(prepareDraft({ directory, resumeRunId: failed.runId, config: { ...config, budgetUsd: 30 }, gatewayFactory: h.factory }), /CONFIG_MISMATCH/);
    assert.equal(h.calls(), 1); h.fail(false);
    const retried = await prepareDraft({ directory, resumeRunId: failed.runId, config, gatewayFactory: h.factory });
    assert.equal(retried.runId, failed.runId); assert.equal(retried.cost.unknownUpperUsd, failed.cost.unknownUpperUsd);
    assert.ok(retried.cost.measuredUsd > 0); assert.equal(retried.cost.billableAttempts, 2);
    assert.equal(readdirSync(join(directory, 'collections')).length, 1);
    const again = await prepareDraft({ directory, resumeRunId: failed.runId, config, gatewayFactory: () => { throw Error('MUST_NOT_CONSTRUCT_GATEWAY'); } });
    assert.equal(again.revision, retried.revision); assert.equal(h.calls(), 2);
  } finally { cleanup(directory); }
});

test('completed-run preset preserves exact recipe and rejects accidental experimental baseline reuse', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    const output = join(directory, 'collections', draft.runId), opportunity = join(output, 'opportunity');
    atomicJson(join(output, 'opportunity-config.json'), config); atomicJson(join(opportunity, 'campaign.json'), draft.campaign);
    const recipe = classifierRecipe(draft.campaign.filter_version);
    atomicJson(join(opportunity, 'filter-recipe.json'), { recipe, recipe_sha256: contentHash(recipe) });
    const preset = savePreset({ directory, name: 'Saved run', source: { kind: 'RUN', runId: draft.runId } });
    assert.equal(preset.recipeHash, draft.recipeHash); assert.deepEqual(preset.criteria, draft.criteria);
    atomicJson(join(opportunity, 'active-evaluation.json'), { state: 'READY_FOR_VERIFICATION' });
    assert.throws(() => savePreset({ directory, name: 'Must not save baseline', source: { kind: 'RUN', runId: draft.runId } }), /EXPERIMENTAL_FILTER_UNSUPPORTED/);
  } finally { cleanup(directory); }
});

test('unsafe IDs, unbounded edits, altered immutable records and config injection are rejected', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    assert.throws(() => readDraft({ directory, runId: '../elsewhere' }), /ID_INVALID/);
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    for (const patch of [{ prompt: 'new topic' }, { needs: ['x'.repeat(601)] }, { queries: [] }, { source_priority: ['PROFILE', 'PROFILE'] },
      { watch: { enabled: true, revisit_hours: [24, 2], ttl_hours: 72, max_attempts: 3 } }]) {
      assert.throws(() => updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: patch as CampaignCriteriaPatch }), /CRITERIA_INVALID/);
    }
    const preset = savePreset({ directory, name: 'Valid', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
    assert.throws(() => applyPreset({ directory, presetId: preset.presetId, presetVersion: preset.version,
      runtime: { totalTarget: 1000, threadsShare: .8, rawCap: 3000, budgetUsd: 3, commentsEnabled: true, prompt: 'injected' } as never }), /RUNTIME_INVALID/);
    const file = join(directory, 'collections', draft.runId, 'opportunity', 'draft-revisions', `${draft.revision}.json`);
    const record = JSON.parse(readFileSync(file, 'utf8')); record.campaign.topic = 'tampered'; atomicJson(file, record);
    assert.throws(() => readDraft({ directory, runId: draft.runId }), /REVISION_INVALID/);
  } finally { cleanup(directory); }
});

test('an archived unsupported recipe is readable but cannot silently run with the current classifier', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    const opportunity = join(directory, 'collections', draft.runId, 'opportunity');
    const record = JSON.parse(readFileSync(join(opportunity, 'draft-revisions', `${draft.revision}.json`), 'utf8'));
    record.campaign.filter_version = 'archived-policy-not-installed'; record.recipe.filter_version = record.campaign.filter_version;
    record.recipeHash = contentHash(record.recipe);
    const { version: _version, created_at: _created, ...base } = record.campaign; record.campaign.version = campaignVersion(base);
    const revision = contentHash(record);
    atomicJson(join(opportunity, 'draft-revisions', `${revision}.json`), record);
    atomicJson(join(opportunity, 'draft.json'), { schemaVersion: 1, runId: draft.runId, revision, status: 'DRAFT' });
    const visible = readDraft({ directory, runId: draft.runId }); assert.equal(visible.supported, false);
    assert.throws(() => resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: revision, expectedConfigHash: draft.configHash }), /RECIPE_UNSUPPORTED/);
    assert.equal(h.calls(), 1);
  } finally { cleanup(directory); }
});

test('a consumed draft remains a valid preset source and unpublished preset folders are ignored', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    let allocationPublished = false;
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory, onAllocated: value => {
      assert.equal(h.calls(), 0); assert.equal(readDraftCost({ directory, runId: value.runId }).measuredUsd, 0); allocationPublished = true;
    } });
    assert.equal(allocationPublished, true);
    markDraftStarted({ directory, runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash });
    const preset = savePreset({ directory, name: 'After Start', source: { kind: 'DRAFT', runId: draft.runId, revision: draft.revision } });
    assert.equal(preset.sourceCampaignVersion, draft.campaign.version); assert.equal(preset.recipeHash, draft.recipeHash);
    mkdirSync(join(directory, 'filter-presets', 'preset-00000000-0000-4000-8000-000000000003'), { recursive: true });
    assert.deepEqual(listPresets({ directory }), [preset]);
  } finally { cleanup(directory); }
});

test('a baseline committed before startup failure cannot be stranded by a later draft edit', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    atomicJson(join(directory, 'collections', draft.runId, 'opportunity', 'campaign.json'), draft.campaign);
    assert.throws(() => updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: { needs: ['changed'] } }), /PLAN_COMMITTED/);
    assert.equal(readDraft({ directory, runId: draft.runId }).revision, draft.revision);
    assert.equal(resolveDraftForStart({ directory, runId: draft.runId, expectedRevision: draft.revision, expectedConfigHash: draft.configHash }).campaign.version, draft.campaign.version);
  } finally { cleanup(directory); }
});

test('extended criteria capability requires the exact supported temporal recipe and does not mutate persisted drafts', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const legacy = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    assert.equal(legacy.criteriaCapabilities.extendedClassificationCriteria, false);
    const opportunity = join(directory, 'collections', legacy.runId, 'opportunity');
    const record = JSON.parse(readFileSync(join(opportunity, 'draft-revisions', `${legacy.revision}.json`), 'utf8'));
    record.campaign.filter_version = TEMPORAL_OPPORTUNITY_FILTER_VERSION;
    record.recipe = structuredClone(classifierRecipe(TEMPORAL_OPPORTUNITY_FILTER_VERSION)); record.recipeHash = contentHash(record.recipe);
    const { version: _version, created_at: _created, ...base } = record.campaign; record.campaign.version = campaignVersion(base);
    const persist = () => {
      const revision = contentHash(record);
      atomicJson(join(opportunity, 'draft-revisions', `${revision}.json`), record);
      atomicJson(join(opportunity, 'draft.json'), { schemaVersion: 1, runId: legacy.runId, revision, status: 'DRAFT' });
      return revision;
    };
    const revision = persist(), before = digestTree(directory), temporal = readDraft({ directory, runId: legacy.runId });
    assert.equal(temporal.supported, true); assert.equal(temporal.criteriaCapabilities.extendedClassificationCriteria, true);
    assert.equal(temporal.revision, revision); assert.deepEqual(digestTree(directory), before);
    assert.equal('criteriaCapabilities' in record, false); assert.equal('criteriaCapabilities' in record.campaign, false);
    record.recipe.system += '\nUnsupported mutation'; record.recipeHash = contentHash(record.recipe); persist();
    const unsupported = readDraft({ directory, runId: legacy.runId });
    assert.equal(unsupported.supported, false); assert.equal(unsupported.criteriaCapabilities.extendedClassificationCriteria, false);
    assert.equal(h.calls(), 1);
  } finally { cleanup(directory); }
});

test('new draft allocations pin grounded planner policy and hash before the first model request', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory, onAllocated: ({ runId }) => {
      const opportunity = join(directory, 'collections', runId, 'opportunity');
      const allocation = JSON.parse(readFileSync(join(opportunity, 'draft-allocation.json'), 'utf8'));
      const pin = JSON.parse(readFileSync(join(opportunity, 'planner-recipe.json'), 'utf8'));
      assert.equal(h.calls(), 0); assert.equal(allocation.plannerPolicy, GROUNDED_CONSTRAINT_PLANNER_POLICY);
      assert.equal(allocation.plannerRecipeHash, plannerRecipeHash(GROUNDED_CONSTRAINT_PLANNER_POLICY));
      assert.equal(pin.recipe_sha256, allocation.plannerRecipeHash); assert.equal(pin.planner_policy, allocation.plannerPolicy);
    } });
    assert.equal(draft.campaign.planner_policy, GROUNDED_CONSTRAINT_PLANNER_POLICY);
    assert.equal(draft.source.plannerRecipeHash, plannerRecipeHash(GROUNDED_CONSTRAINT_PLANNER_POLICY));
    assert.equal(draft.campaign.filter_version, OPPORTUNITY_FILTER_VERSION);
    assert.match(h.systems[0]!, /Grounded constraint policy/);
  } finally { cleanup(directory); }
});

test('an interrupted unversioned allocation retries legacy without changing its allocation or losing old charges', async () => {
  const directory = temporary(), h = harness(directory), runId = `crawl-${randomUUID()}`;
  try {
    const opportunity = join(directory, 'collections', runId, 'opportunity'), allocationFile = join(opportunity, 'draft-allocation.json');
    atomicJson(allocationFile, { schemaVersion: 1, runId, config, configHash: contentHash(config), createdAt: '2026-10-30T00:00:00Z' });
    const allocationBefore = readFileSync(allocationFile, 'utf8'), oldGateway = h.factory({ directory: opportunity, budgetUsd: 3 }); h.fail(true);
    const recipe = plannerRecipe('legacy-short-v1');
    await assert.rejects(oldGateway.generateJson({ purpose: recipe.version, system: recipe.system, schema: recipe.schema, input: { prompt: config.prompt }, max_output_tokens: 6000 }));
    const unknown = oldGateway.summary().unmetered_cost_upper_usd; assert.ok(unknown > 0); h.fail(false);
    const draft = await prepareDraft({ directory, resumeRunId: runId, config, gatewayFactory: h.factory });
    assert.equal(draft.campaign.planner_policy, undefined); assert.equal(draft.campaign.constraint_provenance, undefined);
    assert.equal(draft.source.plannerPolicy, 'legacy-short-v1'); assert.equal(draft.source.plannerRecipeHash, plannerRecipeHash('legacy-short-v1'));
    assert.equal(draft.cost.unknownUpperUsd, unknown); assert.equal(draft.cost.billableAttempts, 2);
    assert.equal(h.systems[1], recipe.system); assert.equal(readFileSync(allocationFile, 'utf8'), allocationBefore);
    const before = digestTree(directory), again = await prepareDraft({ directory, resumeRunId: runId, config, gatewayFactory: () => { throw Error('NO_MODEL_RETRY'); } });
    assert.equal(again.revision, draft.revision); assert.deepEqual(digestTree(directory), before);
  } finally { cleanup(directory); }
});

test('corrupt or unsupported allocated planner pins fail before gateway construction', async () => {
  const directory = temporary(); let calls = 0;
  try {
    for (const [fields, error] of [
      [{ plannerPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY }, /ALLOCATION_INVALID/],
      [{ plannerPolicy: 'unsupported-planner', plannerRecipeHash: 'a'.repeat(64) }, /POLICY_UNSUPPORTED/],
      [{ plannerPolicy: GROUNDED_CONSTRAINT_PLANNER_POLICY, plannerRecipeHash: 'b'.repeat(64) }, /RECIPE_MISMATCH/],
    ] as const) {
      const runId = `crawl-${randomUUID()}`, file = join(directory, 'collections', runId, 'opportunity', 'draft-allocation.json');
      atomicJson(file, { schemaVersion: 1, runId, config, configHash: contentHash(config), createdAt: '2026-10-31T00:00:00Z', ...fields });
      const before = readFileSync(file, 'utf8');
      await assert.rejects(prepareDraft({ directory, resumeRunId: runId, config, gatewayFactory: () => { calls++; throw Error('NO_REQUEST_ALLOWED'); } }), error);
      assert.equal(readFileSync(file, 'utf8'), before);
    }
    assert.equal(calls, 0);
  } finally { cleanup(directory); }
});

test('editing a grounded draft keeps exact historical constraint provenance and records user authority separately', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const scopedConfig = { ...config, prompt: `${config.prompt} Chỉ Hà Nội. Ưu tiên Huế.` };
    h.value({ ...plan, constraints: { ...plan.constraints, geographies: [
      { source: 'PROMPT', quote: 'Chỉ Hà Nội', value: 'Hà Nội', strength: 'REQUIRED' },
      { source: 'PROMPT', quote: 'Ưu tiên Huế', value: 'Huế', strength: 'PREFERRED' },
    ] } });
    const draft = await prepareDraft({ directory, config: scopedConfig, gatewayFactory: h.factory });
    assert.deepEqual(draft.campaign.required_geographies, ['Hà Nội']); assert.deepEqual(draft.campaign.preferred_geographies, ['Huế']);
    const provenance = structuredClone(draft.campaign.constraint_provenance);
    const changed = updateDraft({ directory, runId: draft.runId, expectedRevision: draft.revision,
      criteriaPatch: { required_geographies: [], preferred_geographies: ['Đà Nẵng'], brand_context: 'Phạm vi phục vụ mới' } });
    assert.deepEqual(changed.campaign.constraint_provenance, provenance); assert.deepEqual(changed.campaign.required_geographies, []);
    assert.deepEqual(changed.userOverrides[0]!.patch.required_geographies, []); assert.notEqual(changed.campaign.version, draft.campaign.version);
    assert.equal(changed.source.plannerRecipeHash, draft.source.plannerRecipeHash); assert.equal(changed.recipeHash, draft.recipeHash);
  } finally { cleanup(directory); }
});

test('a completed draft stays reusable after its historical planner is no longer installed', async () => {
  const directory = temporary(), h = harness(directory);
  try {
    const draft = await prepareDraft({ directory, config, gatewayFactory: h.factory });
    const allocationFile = join(directory, 'collections', draft.runId, 'opportunity', 'draft-allocation.json');
    const allocation = JSON.parse(readFileSync(allocationFile, 'utf8'));
    allocation.plannerPolicy = 'historical-planner-no-longer-installed'; allocation.plannerRecipeHash = 'a'.repeat(64); atomicJson(allocationFile, allocation);
    const before = digestTree(directory);
    const existing = await prepareDraft({ directory, resumeRunId: draft.runId, config, gatewayFactory: () => { throw Error('NO_RECOMPILATION'); } });
    assert.equal(existing.revision, draft.revision); assert.deepEqual(digestTree(directory), before); assert.equal(h.calls(), 1);
  } finally { cleanup(directory); }
});
