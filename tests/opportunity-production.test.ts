import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProductionService as productionService, type ProductionHost } from '../src/application/production-service.js';
import { prepareDraft } from '../src/application/campaign-drafts.js';
import { createOpportunityPipeline, type OpportunityPipeline, type OpportunityPipelineInput } from '../src/application/opportunity-pipeline.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import { unassessedGateway, withFilterPolicy } from '../src/application/filter-policy.js';
import type { OpportunityProgress, RunState } from '../src/shared/production-api.js';
import { DEFAULT_STORAGE_LIMITS } from '../src/application/storage-backpressure.js';
import { evaluationContext } from '../src/application/evaluation-upgrade.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { selectOpportunityExport } from '../src/infrastructure/export/opportunity-workbook.js';

// Lifecycle tests start with a reviewed historical plan. Dialogue behavior is covered separately.
function createProductionService(input: Parameters<typeof productionService>[0]) {
  const service = productionService({ ...input, prepareCampaignDraft: options => prepareDraft({ ...options, gateway: {
    summary: () => ({ model: 'fixture', budget_usd: options.config.budgetUsd, measured_cost_usd: 0, unmetered_cost_upper_usd: 0,
      reserved_usd: 0, remaining_usd: options.config.budgetUsd, billable_attempts: 0, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    generateJson: async () => ({ value: { topic: 'Quán cafe', audience: [], needs: [], participation_intents: [], research_intents: [],
      inclusions: [], exclusions: [], assumptions: [], queries: [{ text: options.config.prompt.includes('piano') ? 'học piano' : options.config.prompt.includes('tiếng Anh') ? 'học tiếng Anh' : 'quán cafe', family: 'BROAD' }],
      constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] } },
      invocation_id: 'fixture', request_hash: 'fixture', model: 'fixture', model_version: null, usage: null, cost_usd: 0,
      unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
      price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'fixture', source: 'fixture' } }),
  } }) });
  return { ...service, start: async (value: unknown) => { await service.prepareCampaign(); return service.start(value); } };
}

test('production classifies during parallel collection and completes a TOTAL target with Threads preference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-production-'));
  const profiles = ['threads', 'facebook'].map((platform, i) => ({ id: 'csd-00000000-0000-4000-8000-00000000000' + (i + 1),
    platform: platform as 'threads' | 'facebook', label: platform, createdAt: '2026-10-30T00:00:00Z',
    accountBinding: { status: 'UNVERIFIED' as const, accountId: null, revision: 0 as const }, open: false, persistenceError: null }));
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let opened = 0;
  const price = { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'test', source: 'test' };
  const gateway: ModelGateway = {
    summary: () => ({ model: 'mock', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0, remaining_usd: 3, billable_attempts: 0, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    async generateJson(request) {
      const input = request.input as { conversations: { snapshot_id: string; root_post_id: string; spans: { id: string }[] }[] };
      return { value: input.conversations.map(s => ({ snapshot_id: s.snapshot_id, case_code: 'OPPORTUNITY_REQUEST', evidence_ids: [s.spans[0]!.id],
        action_entity_id: s.root_post_id, need_summary: 'Hỏi địa điểm phù hợp', intents: ['recommendation'], topic_fit: 'RELATED', observed_need: 'REQUEST',
        speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: 'OPEN', freshness: 'CURRENT' })),
      invocation_id: 'mock', request_hash: 'mock', model: 'mock', model_version: null, usage: null, cost_usd: 0,
      unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price };
    },
  };
  const service = createProductionService({ directory, version: 'test', host: {
    async list() { return profiles; }, async sessionStatus() { return true; },
    async create() { throw Error('NOT_EXPECTED'); }, async openLogin() { throw Error('NOT_EXPECTED'); },
  }, createOpportunity: options => createOpportunityPipeline({ ...options, gateway,
    campaign: options.campaign! }),
  async collectConversation() { throw Error('NOT_EXPECTED'); },
  async collect(input) {
    opened++;
    const count = input.platform === 'threads' ? 8 : 2;
    const rows = Array.from({ length: count }, (_, index) => ({ post_id: String((input.platform === 'threads' ? 1000 : 2000) + index),
      text: 'Có quán cafe nào yên tĩnh để làm việc không?', query: 'quán cafe', post_url: 'https://www.threads.com/@example/post/test', collected_at: '2026-10-30T01:00:00Z' }));
    writeFileSync(join(String(input.config.output), 'posts.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    await input.onRecords!(rows, { method: 'TEST', observed_at: '2026-10-30T01:00:00Z' });
    input.onProgress({ total: count });
    await hold;
    return { stop_reason: 'TARGET_REACHED', summary: { unique: count } };
  } });
  try {
    service.saveConfig({ keywords: [], minimumPosts: 777, schemaVersion: 2, opportunity: { enabled: true, prompt: 'Tìm quán cafe', brandContext: '',
      totalTarget: 10, threadsShare: 0.8, rawCap: 30, budgetUsd: 3, commentsEnabled: false } });
    await service.start({ profiles: profiles.map(p => ({ platform: p.platform, profileId: p.id })) });
    const deadline = Date.now() + 10000;
    while ((await service.getState()).run?.opportunity?.counts.suitable !== 10 && Date.now() < deadline) await sleep(25);
    const during = (await service.getState()).run!;
    assert.equal(opened, 2);
    assert.equal(during.state, 'RUNNING');
    assert.equal(during.opportunity?.counts.suitable, 10);
    assert.equal(during.opportunity?.byPlatform.threads.suitable, 8);
    assert.equal(during.opportunity?.byPlatform.facebook.suitable, 2);
    const liveExport = await service.snapshotResults();
    assert.equal(liveExport.run.state, 'RUNNING');
    const liveOpportunity = liveExport.opportunity as { conversations: unknown[]; watermark: { journal_sequence: number } };
    assert.equal(liveOpportunity.conversations.length, 10);
    assert.ok(liveOpportunity.watermark.journal_sequence > 0);
    release(); await service.settled();
    const result = service.results(); assert.equal(result.run.state, 'COMPLETED');
    assert.equal(result.run.minimumPosts, 777, 'legacy raw target is not silently reinterpreted');
    const exported = JSON.parse(readFileSync(join(result.run.outputDirectory, 'opportunity-results.json'), 'utf8'));
    assert.equal(exported.conversations.length, 10);
    assert.equal(exported.campaign.target_scope, 'TOTAL_ACROSS_PLATFORMS');
  } finally { release(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

const lifecycleProfile = { id: 'csd-00000000-0000-4000-8000-000000000009', platform: 'threads' as const, label: 'Synthetic Threads',
  createdAt: '2026-10-30T00:00:00Z', accountBinding: { status: 'UNVERIFIED' as const, accountId: null, revision: 0 as const }, open: false, persistenceError: null };
const lifecycleSelection = { profiles: [{ platform: 'threads', profileId: lifecycleProfile.id }] };
const lifecycleConfig = { keywords: [], minimumPosts: 1000, schemaVersion: 2, opportunity: { enabled: true, prompt: 'Tìm quán cafe', brandContext: '', totalTarget: 10, threadsShare: 0.8, rawCap: 30, budgetUsd: 3, commentsEnabled: true } };
function lifecycleHost(): ProductionHost {
  return { async list() { return [lifecycleProfile]; }, async sessionStatus() { return true; }, async create() { throw Error('NOT_EXPECTED'); }, async openLogin() {} };
}

test('reopening a saved Quality run closes prior completed reviews in the view and export without resuming work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-saved-quality-'));
  const id = 'crawl-00000000-0000-4000-8000-000000000051';
  const outputDirectory = join(directory, 'collections', id), opportunityDirectory = join(outputDirectory, 'opportunity');
  const campaign = withFilterPolicy(literalCampaign({ campaign_id: id, prompt: 'Tìm quán cafe' }), 'QUALITY');
  const context = evaluationContext(campaign), observedAt = '2026-11-07T12:00:00Z';
  const store = createConversationStore(join(opportunityDirectory, 'store'));
  let service: ReturnType<typeof productionService> | undefined;
  try {
    for (const [root, reason, reviewed] of [
      ['conflict', 'POST_REVIEW_FACT_CONFLICT', false], ['reviewed', 'POST_EVIDENCE_INCOMPLETE', true],
      ['language', 'CONTENT_LANGUAGE_UNVERIFIED', false], ['primary', 'POST_EVIDENCE_INCOMPLETE', false],
      ['queued', null, false],
    ] as const) {
      const { snapshot } = store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: root, root_post_id: root, parent_id: null,
        text: 'Có quán cafe yên tĩnh không?', observed_at: observedAt, provenance: { run_id: id, method: 'TEST' } }, context);
      if (!reason) continue;
      store.recordDecision({ ...context, snapshot_id: snapshot!.id, assessment_status: 'PENDING', classification: null,
        reason_code: reason, evidence_ids: [], model: 'fixture', ...(reviewed ? { attributes: { review_state: 'COMPLETE' } } : {}) });
      const job = store.claim('fixture', { context })!;
      assert.equal(job.payload.snapshot_id, snapshot!.id);
      store.complete(job.id, job.lease_token!);
    }
    const exported = store.exportSnapshot(context);
    const history = store.decisionHistory(context);
    const currentRejected = store.results(context, { classification: 'NOT_SUITABLE' });
    assert.equal(currentRejected.length, 2);
    assert.equal(history.filter(d => d.assessment_status === 'PENDING').length, 4);
    const pending = { raw: 5, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 5, failed: 0 };
    const progress: OpportunityProgress = { campaignId: id, totalTarget: 5, threadsShare: 0.5, filterMode: 'QUALITY', counts: pending,
      byPlatform: { threads: pending, facebook: { ...pending, raw: 0, pending: 0 } }, costUsd: 0.4, costUpperUsd: 0.4,
      usageUnknown: 0, budgetUsd: 3, phase: 'PARTIAL', lastError: null, preview: [] };
    const saved: RunState = { id, outputDirectory, minimumPosts: 1, keywords: ['cafe'], state: 'STOPPED', startedAt: observedAt,
      finishedAt: '2026-11-07T12:10:00Z', preview: [], opportunity: progress,
      platforms: [{ platform: 'threads', profileId: lifecycleProfile.id, count: 5, state: 'STOPPED', reason: 'RAW_BUDGET_REACHED' }] };
    const archive = JSON.stringify({ ...exported, campaign, progress, decisions: history, conversations: exported.conversations.map(row => ({ ...row,
      decision: history.find(d => d.snapshot_id === row.snapshot.id)! })) });
    writeFileSync(join(opportunityDirectory, 'campaign.json'), JSON.stringify(campaign));
    writeFileSync(join(outputDirectory, 'opportunity-results.json'), archive);
    writeFileSync(join(directory, 'latest-run.json'), JSON.stringify(saved));
    store.close();
    const originalJournal = readFileSync(store.journalPath);
    service = productionService({ directory, version: 'test', host: lifecycleHost(), async collect() { throw Error('UNEXPECTED_COLLECTION'); },
      async createOpportunity() { throw Error('UNEXPECTED_FILTER'); } });
    const restored = (await service.getState()).run!.opportunity!;
    assert.equal(restored.counts.notSuitable, 2); assert.equal(restored.counts.pending, 3);
    assert.equal(restored.costUsd, 0.4); assert.equal(restored.byPlatform.threads.pending, 3);
    assert.deepEqual(restored.assessmentDetails, { queued: 1, language: 1, incomplete: 1, conflict: 0, stale: 0, failed: 0, unrecorded: 0,
      qualityConflict: 1, qualityUnconfirmed: 1 });
    const result = (await service.snapshotResults()).opportunity;
    const rejected = selectOpportunityExport(result, 'NOT_SUITABLE');
    assert.equal(rejected.conversations.length, 2);
    assert.equal(rejected.decisions.length, 4);
    assert.deepEqual(rejected.progress, restored);
    assert.equal(readFileSync(join(outputDirectory, 'opportunity-results.json'), 'utf8'), archive);
    assert.deepEqual(readFileSync(store.journalPath), originalJournal);
  } finally { await service?.shutdown(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

function controlledPipeline(options: OpportunityPipelineInput, watch: 'off' | 'active' | 'throw' = 'off') {
  const plan = literalCampaign({ prompt: options.config.prompt, campaign_id: options.runId, suitable_target: 10, raw_cap: 30 });
  const empty = () => ({ raw: 0, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 0, failed: 0 });
  let progress: OpportunityProgress = { campaignId: plan.campaign_id, totalTarget: 10, threadsShare: 0.8, counts: empty(), byPlatform: { threads: empty(), facebook: empty() },
    costUsd: 0, costUpperUsd: 0, usageUnknown: 0, budgetUsd: 3, phase: 'COLLECTING', lastError: null, preview: [], watchActive: false };
  const trace = { closes: 0, stops: 0, watches: 0, drained: 0 };
  const emit = () => options.onProgress?.(structuredClone(progress)); emit();
  const pipeline = {
    campaign: plan, runtimeLimits: { effective_raw_cap: plan.budget.raw_cap }, queries: () => ['quán cafe'], progress: () => structuredClone(progress), discoveryStopReason: () => null,
    async ingestRows() {}, async enrich() {}, async backpressure() {},
    async drain() { trace.drained++; progress.phase = 'SETTLED'; emit(); },
    targetReached: () => false,
    async results() { return { campaign: plan, progress: structuredClone(progress), conversations: [], snapshots: [], decisions: [], watermark: { journal_sequence: 0 } }; },
    async startWatching() {
      trace.watches++;
      if (watch === 'off') return false;
      progress = { ...progress, watchActive: true, phase: 'WATCHING' }; emit();
      if (watch === 'throw') throw Error('WATCH_SETUP_FAILED');
      return true;
    },
    isWatching: () => progress.watchActive === true,
    async stop() { trace.stops++; progress = { ...progress, watchActive: false, phase: 'PAUSED' }; emit(); },
    async close() { trace.closes++; progress.watchActive = false; },
  } as unknown as OpportunityPipeline;
  return { pipeline, trace };
}

test('configured output mix does not impose a fixed raw-yield quota on either source', async () => {
  for (const threadsShare of [0.7, 0.8]) {
    const directory = mkdtempSync(join(tmpdir(), 'csd-global-raw-cap-'));
    const facebook = { ...lifecycleProfile, id: 'csd-00000000-0000-4000-8000-000000000008', platform: 'facebook' as const };
    const profiles = [lifecycleProfile, facebook], configurations = new Map<string, Record<string, unknown>>();
    const service = createProductionService({ directory, version: 'test', host: { ...lifecycleHost(), async list() { return profiles; } },
      async createOpportunity(options) {
        const created = controlledPipeline(options);
        created.pipeline.runtimeLimits.effective_raw_cap = 5000;
        return created.pipeline;
      }, async collectConversation() {},
      async collect(input) { configurations.set(input.platform, input.config); return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
    });
    try {
      service.saveConfig({ ...lifecycleConfig, opportunity: { ...lifecycleConfig.opportunity, threadsShare } });
      await service.start({ profiles: profiles.map(profile => ({ platform: profile.platform, profileId: profile.id })) }); await service.settled();
      assert.equal(configurations.get('facebook')?.targetNewRecords, 5000, 'Facebook can use the full effective global allowance even with a lower output share');
      assert.ok(Number(configurations.get('threads')?.targetTotal) >= 5000, 'Threads candidate ceiling cannot reduce the unique-root global allowance');
      assert.equal(configurations.get('threads')?.includeContextCandidates, true, 'reply discovery remains enabled');
    } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('failed first opportunity setup persists FAILED rather than a phantom RUNNING run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-lifecycle-')); let collects = 0;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity() { throw Error('PLANNER_FAILED'); }, async collectConversation() {}, async collect() { collects++; return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig);
    await assert.rejects(service.start(lifecycleSelection), /PLANNER_FAILED/);
    assert.equal(collects, 0); const state = await service.getState(); assert.equal(state.run!.state, 'FAILED'); assert.ok(state.run!.finishedAt);
    const saved = JSON.parse(readFileSync(join(directory, 'latest-run.json'), 'utf8'));
    assert.equal(saved.state, 'FAILED'); assert.equal(saved.platforms[0].reason, 'PLANNER_FAILED');
    assert.doesNotThrow(() => service.saveConfig(lifecycleConfig));
    const reopened = createProductionService({ directory, version: 'test', host: lifecycleHost(), async collect() { throw Error('NOT_EXPECTED'); } });
    assert.equal((await reopened.getState()).run!.state, 'FAILED'); await reopened.shutdown();
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('post-launch getState failure during resume does not close or roll back the running pipeline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-lifecycle-')), host = lifecycleHost();
  let failNextList = false, collectCalls = 0, release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  host.list = async () => { if (failNextList) { failNextList = false; throw Error('HOST_LIST_TEMPORARY'); } return [lifecycleProfile]; };
  const pipelines: ReturnType<typeof controlledPipeline>[] = [];
  const service = createProductionService({ directory, version: 'test', host,
    async createOpportunity(options) { const created = controlledPipeline(options); pipelines.push(created); return created.pipeline; }, async collectConversation() {},
    async collect(input) { collectCalls++; if (input.resume) await hold; return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled(); assert.equal(pipelines[0]!.trace.closes, 1);
    failNextList = true;
    await assert.rejects(service.resume(), /HOST_LIST_TEMPORARY/);
    assert.equal(pipelines.length, 2); assert.equal(pipelines[1]!.trace.closes, 0); assert.equal((await service.getState()).run!.state, 'RUNNING');
    assert.equal(collectCalls, 2); assert.throws(() => service.saveConfig(lifecycleConfig), /COLLECTION_BUSY/);
    release(); await service.settled(); assert.equal(pipelines[1]!.trace.closes, 1); assert.equal((await service.getState()).run!.state, 'STOPPED');
  } finally { release(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('resume after the retired call cap processes saved pending posts at the raw limit without restarting search or planning', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-resume-call-cap-'));
  let blocked = true, calls = 0, collections = 0;
  const gateway: ModelGateway = { ...unassessedGateway, async generateJson(request) {
    calls++;
    if (blocked) throw new ModelGatewayError('MODEL_CALL_LIMIT_REACHED');
    assert.equal(request.purpose, 'opportunity-post-evidence-v1');
    const rows = (request.input as { posts: { i: number }[] }).posts;
    return { value: rows.map(row => ({ i: row.i, topic: 'RELATED', promotion: 'NO', actor: 'CONSUMER', opportunities: ['DIRECT_NEED'], usefulness: 'CONCRETE', goal_fit: 'EXACT', hard: 'PASS', time: 'UNBOUNDED', ev: [0], why: 'Tìm lớp tiếng Anh', flags: [] })),
      invocation_id: 'fixture', request_hash: 'fixture', model: 'fixture', model_version: null, usage: null, cost_usd: 0,
      unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0,
      price: { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'fixture', source: 'fixture' } };
  } };
  const input = { directory, version: 'test', host: lifecycleHost(), watchAfterDiscovery: false,
    createOpportunity: (options: OpportunityPipelineInput) => createOpportunityPipeline({ ...options, gateway }),
    async collectConversation() { throw Error('NO_COMMENT_CAPTURE'); },
    async collect(value: Parameters<Parameters<typeof createProductionService>[0]['collect']>[0]) {
      collections++; assert.equal(collections, 1, 'resume must not start a new search');
      const posts = ['1', '2', '3'].map(post_id => ({ post_id, text: 'Mình cần tìm lớp học tiếng Anh ' + post_id, query: 'học tiếng Anh' }));
      writeFileSync(join(String(value.config.output), 'posts.jsonl'), posts.map(p => JSON.stringify(p)).join('\n') + '\n');
      await value.onRecords!(posts, { method: 'FIXTURE' });
      return { stop_reason: 'RAW_BUDGET_REACHED', summary: { unique: 3 } };
    },
  };
  let service = createProductionService(input);
  try {
    service.saveConfig({ keywords: [], minimumPosts: 3, schemaVersion: 2,
      opportunity: { enabled: true, prompt: 'Tìm người cần học tiếng Anh', brandContext: '', filterMode: 'STANDARD', totalTarget: 3, rawCap: 3, budgetUsd: 3, commentsEnabled: false } });
    const prepared = await service.prepareCampaign(); assert.equal(prepared.campaignDraftError, undefined, JSON.stringify(prepared.campaignDraftError));
    await service.start(lifecycleSelection); await service.settled();
    const first = service.results();
    assert.equal(first.run.opportunity!.counts.pending, 3);
    assert.equal(first.run.opportunity!.lastError, 'MODEL_CALL_LIMIT_REACHED');
    const rawFile = join(first.run.outputDirectory, 'threads', 'posts.jsonl'), original = readFileSync(rawFile, 'utf8');
    await service.shutdown(); blocked = false;
    service = createProductionService(input);
    await service.resume(); await service.settled();
    const resumed = service.results();
    assert.equal(resumed.run.id, first.run.id);
    assert.equal(resumed.run.opportunity!.counts.suitable, 3); assert.equal(resumed.run.opportunity!.counts.pending, 0);
    assert.equal(resumed.run.state, 'COMPLETED'); assert.equal(resumed.run.opportunity!.lastError, null);
    assert.equal(collections, 1); assert.equal(calls, 2); assert.equal(readFileSync(rawFile, 'utf8'), original);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('watch setup failure clears active flags and always closes its pipeline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-lifecycle-'));
  let created: ReturnType<typeof controlledPipeline> | undefined;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { created = controlledPipeline(options, 'throw'); return created.pipeline; }, async collectConversation() {},
    async withConversationWindow() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled();
    assert.equal(created!.trace.watches, 1); assert.equal(created!.trace.closes, 1);
    const state = await service.getState(); assert.equal(state.run!.opportunity!.watchActive, false); assert.match(state.run!.opportunity!.lastError!, /WATCH_SETUP_FAILED/);
    assert.doesNotThrow(() => service.saveConfig(lifecycleConfig));
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('settled discovery retains an active watcher, and shutdown stops and closes it once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-lifecycle-'));
  let created: ReturnType<typeof controlledPipeline> | undefined;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { created = controlledPipeline(options, 'active'); return created.pipeline; }, async collectConversation() {},
    async withConversationWindow() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled();
    assert.equal(created!.trace.closes, 0); assert.equal((await service.getState()).run!.opportunity!.watchActive, true);
    assert.throws(() => service.saveConfig(lifecycleConfig), /COLLECTION_BUSY/); await assert.rejects(service.start(lifecycleSelection), /COLLECTION_BUSY/);
    await service.shutdown(); assert.equal(created!.trace.stops, 1); assert.equal(created!.trace.closes, 1);
    assert.equal((await service.getState()).run!.opportunity!.watchActive, false);
    await service.shutdown(); assert.equal(created!.trace.closes, 1);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('startup clears persisted watching state without creating a pipeline or opening a collector', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-lifecycle-'));
  const first = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { return controlledPipeline(options, 'active').pipeline; }, async collectConversation() {},
    async withConversationWindow() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  first.saveConfig(lifecycleConfig); await first.start(lifecycleSelection); await first.settled();
  const crashedState = readFileSync(join(directory, 'latest-run.json'), 'utf8'); await first.shutdown();
  writeFileSync(join(directory, 'latest-run.json'), crashedState);
  let opened = 0;
  const restarted = createProductionService({ directory, version: 'test', host: lifecycleHost(), async createOpportunity() { opened++; throw Error('NOT_EXPECTED'); }, async collect() { opened++; throw Error('NOT_EXPECTED'); } });
  try {
    const state = await restarted.getState(); assert.equal(state.run!.state, 'INTERRUPTED'); assert.equal(state.run!.opportunity!.watchActive, false);
    assert.equal(state.run!.opportunity!.phase, 'PAUSED'); assert.equal(opened, 0);
  } finally { await restarted.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('live exports serialize with the final export and keep the pipeline open until all snapshots publish', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-export-race-'));
  let finishCollection!: () => void, finishExport!: () => void, resultCalls = 0;
  const collection = new Promise<void>(resolve => { finishCollection = resolve; }), heldExport = new Promise<void>(resolve => { finishExport = resolve; });
  let created!: ReturnType<typeof controlledPipeline>;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) {
      created = controlledPipeline(options); const original = created.pipeline.results;
      created.pipeline.results = async () => {
        const sequence = ++resultCalls;
        if (sequence === 1) await heldExport;
        assert.equal(created.trace.closes, 0, 'export must finish while store remains open');
        return { ...await original(), watermark: { journal_sequence: sequence, journal_event_id: `event-${sequence}`, captured_at: new Date().toISOString() } };
      };
      return created.pipeline;
    }, async collectConversation() {}, async collect() { await collection; return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection);
    const first = service.snapshotResults(), second = service.snapshotResults();
    await sleep(20); assert.equal(resultCalls, 1);
    finishCollection(); await sleep(30);
    assert.equal(created.trace.drained, 1); assert.equal(created.trace.closes, 0); assert.equal(resultCalls, 1);
    finishExport(); const [one, two] = await Promise.all([first, second]); await service.settled();
    assert.equal(one.run.state, 'RUNNING'); assert.equal(two.run.state, 'RUNNING');
    assert.equal((one.opportunity as { watermark: { journal_sequence: number } }).watermark.journal_sequence, 1);
    assert.equal((two.opportunity as { watermark: { journal_sequence: number } }).watermark.journal_sequence, 2);
    assert.equal(resultCalls, 3); assert.equal(created.trace.closes, 1);
    const final = JSON.parse(readFileSync(join(one.run.outputDirectory, 'opportunity-results.json'), 'utf8'));
    assert.equal(final.watermark.journal_sequence, 3, 'a late older export must not replace the final watermark');
  } finally { finishExport(); finishCollection(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('watcher shutdown detaches its pipeline and waits for an in-flight snapshot before closing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-export-race-'));
  let created!: ReturnType<typeof controlledPipeline>, finishExport!: () => void, exporting = false;
  const heldExport = new Promise<void>(resolve => { finishExport = resolve; });
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { created = controlledPipeline(options, 'active'); return created.pipeline; },
    async collectConversation() {}, async withConversationWindow() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled();
    const original = created.pipeline.results;
    created.pipeline.results = async () => {
      exporting = true; await heldExport; assert.equal(created.trace.closes, 0);
      return original();
    };
    const snapshot = service.snapshotResults(); await sleep(20); assert.equal(exporting, true);
    let shutdownFinished = false;
    const shuttingDown = service.shutdown().then(() => { shutdownFinished = true; });
    await sleep(30); assert.equal(shutdownFinished, false); assert.equal(created.trace.closes, 0);
    const detachedRead = await service.snapshotResults(); assert.ok(detachedRead.opportunity, 'retiring pipeline is replaced by its last complete persisted snapshot');
    finishExport(); await snapshot; await shuttingDown;
    assert.equal(created.trace.closes, 1); await service.shutdown(); assert.equal(created.trace.closes, 1);
  } finally { finishExport(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed live export releases the queue so final export and close still complete', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-export-race-'));
  let finishCollection!: () => void, created!: ReturnType<typeof controlledPipeline>, resultCalls = 0;
  const heldCollection = new Promise<void>(resolve => { finishCollection = resolve; });
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) {
      created = controlledPipeline(options); const original = created.pipeline.results;
      created.pipeline.results = async () => { resultCalls++; if (resultCalls === 1) throw Error('SYNTHETIC_EXPORT_FAILED'); return original(); };
      return created.pipeline;
    }, async collectConversation() {}, async collect() { await heldCollection; return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection);
    await assert.rejects(service.snapshotResults(), /SYNTHETIC_EXPORT_FAILED/);
    finishCollection(); await service.settled(); assert.equal(created.trace.closes, 1); assert.equal(resultCalls, 2);
    assert.equal(service.results().run.state, 'STOPPED');
  } finally { finishCollection(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('terminal run state cannot start or resume another collector until pipeline retirement finishes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-export-race-'));
  let finishClose!: () => void, closing = false, creates = 0;
  const heldClose = new Promise<void>(resolve => { finishClose = resolve; });
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) {
      creates++; const created = controlledPipeline(options), original = created.pipeline.close;
      created.pipeline.close = async () => { closing = true; await heldClose; await original(); };
      return created.pipeline;
    }, async collectConversation() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await sleep(20);
    assert.equal(closing, true); assert.equal((await service.getState()).run!.state, 'STOPPED');
    await assert.rejects(service.start(lifecycleSelection), /COLLECTION_BUSY/); await assert.rejects(service.resume(), /COLLECTION_BUSY/);
    assert.throws(() => service.saveConfig(lifecycleConfig), /COLLECTION_BUSY/); assert.equal(creates, 1);
    finishClose(); await service.settled(); assert.doesNotThrow(() => service.saveConfig(lifecycleConfig));
  } finally { finishClose(); await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('collector query handoff passes its query to the bounded enrichment scheduler', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-opportunity-query-handoff-')), calls: Array<Parameters<OpportunityPipeline['enrich']>> = [];
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { const created = controlledPipeline(options); created.pipeline.enrich = async (...args) => { calls.push(args); }; return created.pipeline; },
    async collectConversation() {}, async collect(input) {
      await input.onQueryEnd!({ window: {} as Parameters<OpportunityPipeline['enrich']>[1], platform: 'threads', query: 'generic consumer query', shouldStop: () => false });
      return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } };
    } });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled();
    assert.equal(calls.length, 1); assert.equal(calls[0]![0], 'threads'); assert.equal(calls[0]![3], 3); assert.equal(calls[0]![5], 'generic consumer query');
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('posts-only runs omit comment handoffs and final comment windows', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-posts-only-')); let handoffs = 0, windows = 0;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { const created = controlledPipeline(options); created.pipeline.enrich = async () => { handoffs++; }; return created.pipeline; },
    async collectConversation() { throw Error('COMMENTS_DISABLED'); }, async withConversationWindow() { windows++; },
    async collect(value) { assert.equal(value.onQueryEnd, undefined); return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
  });
  try {
    service.saveConfig({ ...lifecycleConfig, opportunity: { ...lifecycleConfig.opportunity, commentsEnabled: false } });
    await service.start(lifecycleSelection); await service.settled(); assert.equal(handoffs, 0); assert.equal(windows, 0);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('storage receipts and measurement failures preserve both raw sources, stop resumably and never reopen comments or watch', async () => {
  for (const reason of ['STORAGE_RUN_BYTES_REACHED', 'STORAGE_DISK_RESERVE_REACHED', 'STORAGE_MEASUREMENT_FAILED']) {
    const directory = mkdtempSync(join(tmpdir(), 'csd-production-storage-'));
    const facebook = { ...lifecycleProfile, id: 'csd-00000000-0000-4000-8000-000000000008', platform: 'facebook' as const };
    const profiles = [lifecycleProfile, facebook]; let windows = 0, enrichment = 0, created!: ReturnType<typeof controlledPipeline>;
    const service = createProductionService({ directory, version: 'test', host: { ...lifecycleHost(), async list() { return profiles; } },
      async createOpportunity(options) { created = controlledPipeline(options, 'active'); created.pipeline.enrich = async () => { enrichment++; }; return created.pipeline; },
      async collectConversation() { enrichment++; }, async withConversationWindow() { windows++; },
      async collect(input) {
        const row = { post_id: input.platform + '-stored', text: 'Captured before storage pause' };
        writeFileSync(join(String(input.config.output), 'posts.jsonl'), JSON.stringify(row) + '\n');
        await input.onRecords!([row], { method: 'TEST' });
        if (input.platform === 'threads' && reason === 'STORAGE_MEASUREMENT_FAILED') throw Error(reason);
        return { stop_reason: input.platform === 'threads' ? reason : 'SOURCE_EXHAUSTED', summary: { unique: 1 } };
      },
    });
    try {
      service.saveConfig(lifecycleConfig); await service.start({ profiles: profiles.map(profile => ({ platform: profile.platform, profileId: profile.id })) });
      await service.settled(); const results = service.results();
      assert.equal(results.run.state, 'STOPPED'); assert.deepEqual(results.run.platforms.map(item => item.state), ['STOPPED', 'STOPPED']);
      assert.equal(results.run.platforms.find(item => item.platform === 'threads')!.reason, reason);
      assert.equal(results.facebook.length, 1); assert.equal(results.threads.length, 1);
      assert.equal(windows, 0); assert.equal(enrichment, 0); assert.equal(created.trace.watches, 0);
      assert.equal(created.trace.drained, 1); assert.equal(created.trace.closes, 1);
    } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('production storage stop resumes against the same pinned limit and cumulative files without repeating paid work or admitting a new batch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-storage-resume-'));
  let modelCalls = 0, batches = 0, windows = 0, constructions = 0;
  const price = { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: 'test', source: 'test' };
  const gateway: ModelGateway = {
    summary: () => ({ model: 'mock', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0, remaining_usd: 3, billable_attempts: modelCalls, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
    async generateJson(request) {
      modelCalls++;
      const input = request.input as { conversations: { snapshot_id: string; root_post_id: string; spans: { id: string }[] }[] };
      return { value: input.conversations.map(item => ({ snapshot_id: item.snapshot_id, case_code: 'OPPORTUNITY_REQUEST', evidence_ids: [item.spans[0]!.id],
        action_entity_id: item.root_post_id, need_summary: 'Tìm chỗ học đàn', intents: ['recommendation'], topic_fit: 'RELATED', observed_need: 'REQUEST',
        speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: 'OPEN', freshness: 'CURRENT' })),
        invocation_id: 'mock', request_hash: 'mock', model: 'mock', model_version: null, usage: null, cost_usd: 0,
        unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price };
    },
  };
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    createOpportunity(options) {
      constructions++;
      return createOpportunityPipeline({ ...options, gateway,
        ...(options.campaign ? { campaign: options.campaign } : {}),
        storageLimits: constructions === 1 ? { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: 2 * 1024 * 1024, in_flight_reserve_bytes: 65536 } : { ...DEFAULT_STORAGE_LIMITS },
      });
    }, async collectConversation() { throw Error('UNEXPECTED_COMMENTS'); }, async withConversationWindow() { windows++; },
    async collect(input) {
      await input.beforeNextPage!(); const initial = input.collectionLimitReason!();
      if (initial) return { stop_reason: initial, summary: { unique: batches } };
      const row = { post_id: '123', text: 'Có chỗ học piano nào cho người mới không?', post_url: 'https://www.threads.com/@example/post/test',
        query: 'học piano', collected_at: '2026-10-31T00:00:00Z', raw_payload: 'x'.repeat(2 * 1024 * 1024) };
      batches++; writeFileSync(join(String(input.config.output), 'posts.jsonl'), JSON.stringify(row) + '\n');
      await input.onRecords!([row], { method: 'TEST' }); await input.beforeNextPage!();
      return { stop_reason: input.collectionLimitReason!() ?? 'SOURCE_EXHAUSTED', summary: { unique: batches } };
    },
  });
  try {
    service.saveConfig({ ...lifecycleConfig, opportunity: { ...lifecycleConfig.opportunity, prompt: 'Tìm chỗ học piano', commentsEnabled: false } });
    await service.start(lifecycleSelection); await service.settled(); const first = service.results();
    assert.equal(first.run.state, 'STOPPED'); assert.equal(first.run.platforms[0]!.reason, 'STORAGE_RUN_BYTES_REACHED');
    assert.equal(first.threads.length, 1); assert.equal(batches, 1); assert.equal(modelCalls, 1); assert.equal(windows, 0);
    const policyPath = join(first.run.outputDirectory, 'opportunity', 'storage-policy.json'), policyBytes = readFileSync(policyPath, 'utf8');
    const rawPath = join(first.run.outputDirectory, 'threads', 'posts.jsonl'), rawBytes = readFileSync(rawPath, 'utf8');
    await service.resume(); await service.settled(); const resumed = service.results();
    assert.equal(resumed.run.state, 'STOPPED'); assert.equal(resumed.run.platforms[0]!.reason, 'STORAGE_RUN_BYTES_REACHED');
    assert.equal(batches, 1); assert.equal(modelCalls, 1); assert.equal(windows, 0); assert.equal(constructions, 2);
    assert.equal(readFileSync(policyPath, 'utf8'), policyBytes); assert.equal(readFileSync(rawPath, 'utf8'), rawBytes);
    const output = JSON.parse(readFileSync(join(first.run.outputDirectory, 'opportunity-results.json'), 'utf8'));
    assert.equal(output.storage.stop_reason, 'STORAGE_RUN_BYTES_REACHED'); assert.equal(output.storage.policy.limits.max_run_bytes, 2 * 1024 * 1024);
    assert.ok(output.storage.usage.run_bytes >= 2 * 1024 * 1024);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test('storage measurement failure during final processing remains visible and cannot restart a watcher', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-storage-final-')); let created!: ReturnType<typeof controlledPipeline>;
  const service = createProductionService({ directory, version: 'test', host: lifecycleHost(),
    async createOpportunity(options) { created = controlledPipeline(options, 'active'); created.pipeline.drain = async () => { throw Error('STORAGE_MEASUREMENT_FAILED'); }; return created.pipeline; },
    async collectConversation() {}, async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
  });
  try {
    service.saveConfig(lifecycleConfig); await service.start(lifecycleSelection); await service.settled();
    const state = await service.getState(); assert.equal(state.run!.state, 'STOPPED'); assert.equal(state.run!.platforms[0]!.reason, 'STORAGE_MEASUREMENT_FAILED');
    assert.equal(created.trace.watches, 0); assert.equal(created.trace.closes, 1);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});
