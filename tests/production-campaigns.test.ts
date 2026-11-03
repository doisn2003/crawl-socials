import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionService } from '../src/application/production-service.js';
import type { CollectorInput, ProductionHost } from '../src/application/production-service.js';
import { createOpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { prepareDraft, readDraft } from '../src/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import { contentHash } from '../src/domain/conversation.js';
import { campaignVersion } from '../src/domain/campaign-plan.js';
import { atomicJson } from '../src/infrastructure/config/user-config.js';
import type { OpportunityConfig, OpportunityProgress } from '../src/shared/production-api.js';
import type { CampaignDraftView } from '../src/shared/campaign-drafts.js';

const profileId = 'csd-00000000-0000-4000-8000-000000000002';
const profiles = [{ platform: 'threads' as const, profileId }];
const host: ProductionHost = {
  list: async () => [{ id: profileId, platform: 'threads', label: 'Fixture', createdAt: '2026-10-30T00:00:00Z',
    accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 }, open: false, persistenceError: null }],
  sessionStatus: async () => true, create: async () => { throw Error('NO_PROFILE_CREATE'); }, openLogin: async () => { throw Error('NO_LOGIN'); },
};
const config: OpportunityConfig = { enabled: true, prompt: 'Tìm khóa học tiếng Anh buổi tối cho người đi làm.', brandContext: '',
  totalTarget: 1000, threadsShare: .8, rawCap: 3000, budgetUsd: 3, commentsEnabled: false };
const plan = { topic: 'Khóa học tiếng Anh', audience: ['Người đi làm'], needs: ['buổi tối'], participation_intents: ['hỏi khóa học'],
  research_intents: ['nhu cầu học'], inclusions: ['người học'], exclusions: ['tuyển giáo viên'], assumptions: [],
  constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] },
  queries: [{ text: 'khóa học tiếng Anh', family: 'BROAD' }, { text: 'tiếng Anh buổi tối', family: 'USE_CASE' },
    { text: 'review khóa học', family: 'EXPERIENCE' }, { text: 'tìm khóa học', family: 'REQUEST' }] };
function deferred() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; }
function fixture(directory: string) {
  let modelCalls = 0, failPlanner = false, collectCalls = 0, failStartup = false;
  let preparationHold: ReturnType<typeof deferred> | null = null, collectionHold: ReturnType<typeof deferred> | null = null;
  let modelHold: ReturnType<typeof deferred> | null = null; const modelEntered = deferred();
  const collectorConfigs: Record<string, unknown>[] = [];
  const starts: { id: string; directory: string; version: string; cost: number; explicit: boolean }[] = [];
  const gateway = (options: { directory: string; budgetUsd: number }) => createCampaignModelGateway({ mockTransport: true, ...options, apiKey: 'synthetic-key',
    minRequestIntervalMs: 0, maxAttempts: 1, fetch: async () => {
      modelCalls++; modelEntered.release(); await modelHold?.promise; if (failPlanner) throw Error('synthetic network failure');
      return new Response(JSON.stringify({ modelVersion: 'fixture', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(plan) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 } }), { status: 200 });
    } });
  const serviceInput = { directory, version: 'test', host, watchAfterDiscovery: false,
    collect: async (input: CollectorInput) => { collectCalls++; collectorConfigs.push(input.config); await collectionHold?.promise; return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
    collectConversation: async () => { throw Error('NO_BROWSER'); },
    prepareCampaignDraft: async (input: Parameters<typeof prepareDraft>[0]) => { await preparationHold?.promise; return prepareDraft({ ...input, gatewayFactory: gateway }); },
    createOpportunity: async (input: Parameters<typeof createOpportunityPipeline>[0]) => {
      starts.push({ id: input.runId, directory: input.directory, version: input.campaign?.version ?? '', explicit: !!input.campaign,
        cost: gateway({ directory: join(input.directory, 'opportunity'), budgetUsd: input.config.budgetUsd }).summary().measured_cost_usd });
      if (failStartup) throw Error('SYNTHETIC_STARTUP_FAILURE');
      return createOpportunityPipeline({ ...input, gateway: gateway({ directory: join(input.directory, 'opportunity'), budgetUsd: input.config.budgetUsd }) });
    } };
  const service = createProductionService(serviceInput);
  service.saveConfig({ schemaVersion: 2, keywords: ['legacy keyword'], minimumPosts: 7, opportunity: config });
  return { service, serviceInput, starts, collectorConfigs, modelCalls: () => modelCalls, collectCalls: () => collectCalls,
    failPlanner: (v: boolean) => { failPlanner = v; }, failStartup: (v: boolean) => { failStartup = v; },
    holdPreparation: (v: ReturnType<typeof deferred> | null) => { preparationHold = v; }, holdCollection: (v: ReturnType<typeof deferred> | null) => { collectionHold = v; },
    holdModel: (v: ReturnType<typeof deferred> | null) => { modelHold = v; }, modelEntered: modelEntered.promise };
}
const reference = (draft: CampaignDraftView) => ({ runId: draft.runId, revision: draft.revision, configHash: draft.configHash });
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-campaigns-'));
  try { await work(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-production-campaigns-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('optional preview persists across service restart and Start consumes the same plan, run and planner cost', async () => temporary(async directory => {
  const h = fixture(directory), prepared = await h.service.prepareCampaign(), draft = prepared.campaignDraft!;
  assert.ok(draft); assert.equal(h.collectCalls(), 0); assert.equal(h.modelCalls(), 1); assert.equal(prepared.run, null);
  const restarted = createProductionService(h.serviceInput);
  assert.equal((await restarted.getState()).campaignDraft!.revision, draft.revision); assert.equal(h.modelCalls(), 1);
  await restarted.start({ profiles, draft: reference(draft) }); await restarted.settled();
  const state = await restarted.getState(); assert.equal(state.run!.id, draft.runId); assert.equal(state.campaignDraft, undefined);
  assert.equal(h.starts[0]!.explicit, true); assert.equal(h.starts[0]!.version, draft.campaign.version);
  assert.equal(h.starts[0]!.cost, draft.cost.measuredUsd); assert.equal(h.modelCalls(), 1);
  assert.equal(readDraft({ directory, runId: draft.runId }).status, 'STARTED');
  await restarted.shutdown();
}));

test('collector deadline inherits a valid prepared campaign duration instead of resetting to 240 minutes', async () => temporary(async directory => {
  const h = fixture(directory), original = (await h.service.prepareCampaign()).campaignDraft!;
  // Construct a valid archived prepared-plan fixture with a nondefault duration.
  // The public editor intentionally cannot edit budget fields. Both hashes are
  // recomputed so Start exercises the normal immutable-draft validation path.
  const opportunity = join(directory, 'collections', original.runId, 'opportunity');
  const record = JSON.parse(readFileSync(join(opportunity, 'draft-revisions', `${original.revision}.json`), 'utf8'));
  record.campaign.budget.max_run_minutes = 37;
  const { version: _version, created_at: _created, ...base } = record.campaign;
  record.campaign.version = campaignVersion(base); record.source.sourceCampaignVersion = record.campaign.version;
  const revision = contentHash(record);
  atomicJson(join(opportunity, 'draft-revisions', `${revision}.json`), record);
  atomicJson(join(opportunity, 'draft.json'), { schemaVersion: 1, runId: original.runId, revision, status: 'DRAFT' });
  const prepared = readDraft({ directory, runId: original.runId });
  assert.equal(prepared.campaign.budget.max_run_minutes, 37);
  try {
    await h.service.start({ profiles, draft: reference(prepared) }); await h.service.settled();
    assert.equal(h.collectorConfigs.length, 1); assert.equal(h.collectorConfigs[0]!.maxMinutes, 37);
    assert.equal(h.starts[0]!.version, prepared.campaign.version); assert.equal(h.modelCalls(), 1);
  } finally { await h.service.shutdown(); }
}));

test('editing and applying a full preset preserves legacy settings and restores semantic config without LLM', async () => temporary(async directory => {
  const h = fixture(directory), draft = (await h.service.prepareCampaign()).campaignDraft!;
  const edited = await h.service.updateCampaign({ runId: draft.runId, expectedRevision: draft.revision,
    criteriaPatch: { brand_context: 'Lớp tối có học bù', required_geographies: ['Đà Nẵng'], needs: ['học bù'] } });
  assert.equal(edited.config.opportunity!.brandContext, 'Lớp tối có học bù'); assert.deepEqual(edited.config.keywords, ['legacy keyword']);
  assert.equal(edited.config.minimumPosts, 7);
  const saved = await h.service.saveCampaignPreset({ name: 'Người học buổi tối', source: { kind: 'DRAFT', runId: draft.runId, revision: edited.campaignDraft!.revision } });
  const preset = saved.campaignPresets![0]!;
  const applied = await h.service.applyCampaignPreset({ presetId: preset.presetId, presetVersion: preset.version,
    runtime: { totalTarget: 500, threadsShare: .7, rawCap: 1500, budgetUsd: 1.5, commentsEnabled: true } });
  assert.equal(applied.config.opportunity!.prompt, config.prompt); assert.equal(applied.config.opportunity!.brandContext, 'Lớp tối có học bù');
  assert.equal(applied.config.opportunity!.threadsShare, .7); assert.equal(applied.config.minimumPosts, 7);
  assert.deepEqual(applied.campaignDraft!.criteria, edited.campaignDraft!.criteria); assert.equal(applied.campaignDraft!.cost.measuredUsd, 0);
  assert.equal(h.modelCalls(), 1); assert.equal(h.collectCalls(), 0);
  await h.service.start({ profiles }); await h.service.settled(); // Even without an explicit reference, matching prepared drafts retain edits.
  assert.equal(h.starts[0]!.id, applied.campaignDraft!.runId); assert.equal(h.starts[0]!.version, applied.campaignDraft!.campaign.version);
  await h.service.shutdown();
}));

test('failed preview is visible, blocks a fresh direct Start and retries its original allocation and charges', async () => temporary(async directory => {
  const h = fixture(directory); h.failPlanner(true);
  const failed = await h.service.prepareCampaign(); assert.ok(failed.campaignDraftError); assert.ok(failed.campaignDraftError.cost.unknownUpperUsd > 0);
  await assert.rejects(h.service.start({ profiles }), /DRAFT_PREPARATION_INCOMPLETE/);
  assert.equal(h.collectCalls(), 0); assert.equal(h.modelCalls(), 1); assert.equal(readdirSync(join(directory, 'collections')).length, 1);
  const restarted = createProductionService(h.serviceInput); assert.equal((await restarted.getState()).campaignDraftError!.runId, failed.campaignDraftError.runId);
  h.failPlanner(false); const retry = await restarted.prepareCampaign();
  assert.equal(retry.campaignDraft!.runId, failed.campaignDraftError.runId);
  assert.equal(retry.campaignDraft!.cost.unknownUpperUsd, failed.campaignDraftError.cost.unknownUpperUsd); assert.equal(retry.campaignDraftError, undefined);
  await restarted.start({ profiles }); await restarted.settled();
  assert.equal(h.starts[0]!.id, failed.campaignDraftError.runId); assert.equal(h.modelCalls(), 2);
  await restarted.shutdown();
}));

test('Start checks actual current config and cannot trust a caller-supplied matching hash', async () => temporary(async directory => {
  const h = fixture(directory), state = await h.service.prepareCampaign(), draft = state.campaignDraft!;
  const changed = { ...config, prompt: 'Tìm khách sạn gia đình' };
  h.service.saveConfig({ ...state.config, opportunity: changed });
  await assert.rejects(h.service.start({ profiles, draft: reference(draft) }), /CONFIG_MISMATCH/);
  await assert.rejects(h.service.start({ profiles, draft: { ...reference(draft), configHash: contentHash(changed) } }), /CONFIG_MISMATCH/);
  await assert.rejects(h.service.updateCampaign({ runId: draft.runId, expectedRevision: draft.revision, criteriaPatch: { topic: 'Other' } }), /CONFIG_MISMATCH/);
  assert.equal(h.collectCalls(), 0); assert.equal(h.starts.length, 0); assert.equal(readdirSync(join(directory, 'collections')).length, 1);
}));

test('failed startup keeps draft editable and next Start reuses the same identity without replanning', async () => temporary(async directory => {
  const h = fixture(directory), draft = (await h.service.prepareCampaign()).campaignDraft!;
  h.failStartup(true); await assert.rejects(h.service.start({ profiles, draft: reference(draft) }), /SYNTHETIC_STARTUP_FAILURE/);
  assert.equal((await h.service.getState()).campaignDraft!.status, 'DRAFT'); assert.equal(h.modelCalls(), 1);
  h.failStartup(false); await h.service.start({ profiles }); await h.service.settled();
  assert.deepEqual(h.starts.map(start => start.id), [draft.runId, draft.runId]); assert.equal(h.modelCalls(), 1);
  assert.equal(readDraft({ directory, runId: draft.runId }).status, 'STARTED'); await h.service.shutdown();
}));

test('planning and collection serialize edits, preset application and additional starts', async () => temporary(async directory => {
  const h = fixture(directory), planning = deferred(); h.holdPreparation(planning);
  const work = h.service.prepareCampaign();
  await assert.rejects(h.service.prepareCampaign(), /COLLECTION_BUSY/); await assert.rejects(h.service.start({ profiles }), /COLLECTION_BUSY/);
  await assert.rejects(h.service.applyCampaignPreset({}), /COLLECTION_BUSY/); await assert.rejects(h.service.updateCampaign({}), /COLLECTION_BUSY/);
  planning.release(); const draft = (await work).campaignDraft!, collecting = deferred(); h.holdCollection(collecting);
  try {
    await h.service.start({ profiles, draft: reference(draft) });
    await assert.rejects(h.service.prepareCampaign(), /COLLECTION_BUSY/); await assert.rejects(h.service.saveCampaignPreset({}), /COLLECTION_BUSY/);
    await assert.rejects(h.service.applyCampaignPreset({}), /COLLECTION_BUSY/); await assert.rejects(h.service.updateCampaign({}), /COLLECTION_BUSY/);
  } finally { collecting.release(); await h.service.settled(); await h.service.shutdown(); }
}));

test('assessment-only monitoring keeps the pipeline alive and blocks edits until explicit Stop', async () => temporary(async directory => {
  const h = fixture(directory), draft = (await h.service.prepareCampaign()).campaignDraft!;
  let monitoring = false, closed = false;
  const service = createProductionService({ ...h.serviceInput, watchAfterDiscovery: true,
    createOpportunity: async input => {
      const base = await h.serviceInput.createOpportunity({ ...input,
        onProgress: value => input.onProgress?.({ ...value, assessmentActive: monitoring }) });
      const progress = (): OpportunityProgress => ({ ...base.progress(), assessmentActive: monitoring, assessmentPending: monitoring ? 1 : 0 });
      return { ...base, progress, startWatching: async () => { monitoring = true; input.onProgress?.(progress()); return true; },
        stop: async () => { monitoring = false; await base.stop(); input.onProgress?.(progress()); },
        close: async () => { closed = true; await base.close(); },
        results: async () => ({ ...await base.results(), progress: progress() }) };
    } });
  try {
    await service.start({ profiles, draft: reference(draft) }); await service.settled();
    assert.equal(closed, false); assert.equal((await service.getState()).run!.opportunity!.assessmentActive, true);
    await assert.rejects(service.prepareCampaign(), /COLLECTION_BUSY/); await assert.rejects(service.start({ profiles }), /COLLECTION_BUSY/);
    const stopped = await service.stop(); assert.equal(stopped.run!.state, 'STOPPED'); assert.equal(stopped.run!.opportunity!.assessmentActive, false);
  } finally { await service.shutdown(); }
  assert.equal(closed, true);
}));

test('polling shows current model queue even before the next classification batch publishes results', async () => temporary(async directory => {
  const h = fixture(directory), draft = (await h.service.prepareCampaign()).campaignDraft!;
  const hold = deferred(); h.holdCollection(hold); let queued = 0;
  const service = createProductionService({ ...h.serviceInput, createOpportunity: async input => {
    const base = await h.serviceInput.createOpportunity(input);
    return { ...base, progress: (): OpportunityProgress => ({ ...base.progress(), modelScheduling: {
      active: 4, queued, concurrency: 8, configuredConcurrency: 8, requestsLastMinute: 10, inputTokensLastMinute: 1000, requestsToday: 10, cooldownUntil: null,
    } }) };
  } });
  try {
    await service.start({ profiles, draft: reference(draft) }); queued = 7;
    assert.equal((await service.getState()).run!.opportunity!.modelScheduling!.queued, 7);
    queued = 2; assert.equal((await service.getState()).run!.opportunity!.modelScheduling!.queued, 2);
  } finally { hold.release(); await service.settled(); await service.shutdown(); }
}));

test('allocation is durable before model response and interrupted publication recovers without another charge', async () => temporary(async directory => {
  const h = fixture(directory), hold = deferred(); h.holdModel(hold);
  const preparing = h.service.prepareCampaign(); await h.modelEntered;
  const pending = await h.service.getState(); assert.ok(pending.campaignDraftPreparing); assert.equal(pending.campaignDraftError, undefined);
  assert.equal(pending.campaignDraft, undefined); const runId = pending.campaignDraftPreparing.runId;
  hold.release(); const complete = await preparing; assert.equal(complete.campaignDraft!.runId, runId);
  // Simulate interruption after immutable backend completion but before the service READY pointer.
  atomicJson(join(directory, 'active-campaign-draft.json'), { schemaVersion: 1, state: 'PREPARING', runId, configHash: complete.campaignDraft!.configHash });
  const restarted = createProductionService(h.serviceInput), state = await restarted.getState();
  assert.equal(state.campaignDraftPreparing, undefined); assert.equal(state.campaignDraftError!.code, 'DRAFT_PREPARATION_INTERRUPTED');
  await assert.rejects(restarted.start({ profiles }), /PREPARATION_INCOMPLETE/);
  const recovered = await restarted.prepareCampaign(); assert.equal(recovered.campaignDraft!.runId, runId);
  assert.equal(recovered.campaignDraft!.cost.measuredUsd, complete.campaignDraft!.cost.measuredUsd); assert.equal(h.modelCalls(), 1);
  assert.equal(readdirSync(join(directory, 'collections')).length, 1);
}));

test('getState reads config after asynchronous account lookup to avoid a mixed old-config/new-draft snapshot', async () => temporary(async directory => {
  const h = fixture(directory), hold = deferred();
  const service = createProductionService({ ...h.serviceInput, host: { ...host, list: async () => { await hold.promise; return host.list(); } } });
  const pending = service.getState();
  const changed = { ...config, prompt: 'Tìm khách sạn gia đình' };
  service.saveConfig({ schemaVersion: 2, keywords: ['legacy keyword'], minimumPosts: 7, opportunity: changed });
  hold.release(); assert.equal((await pending).config.opportunity!.prompt, changed.prompt);
}));
