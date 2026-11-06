import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createOpportunityPipeline, type OpportunityPipeline, type OpportunityPipelineInput } from '../src/application/opportunity-pipeline.js';
import { campaignFromModel } from '../src/application/compile-campaign.js';
import { classifierRecipe } from '../src/application/classification-service.js';
import { prepareCombinedEvaluationUpgrade } from '../src/application/evaluation-upgrade.js';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { recordRawCapExtension } from '../src/application/runtime-limits.js';
import { DEFAULT_STORAGE_LIMITS, type StorageLimits } from '../src/application/storage-backpressure.js';
import { ModelGatewayError, type JsonModelRequest, type JsonModelResult, type ModelGateway } from '../src/application/ports/model-gateway.js';
import { contentHash, type ConversationObservation } from '../src/domain/conversation.js';
import type { OpportunityProgress } from '../src/shared/production-api.js';
import type { CampaignPlan } from '../src/domain/campaign-plan.js';
import type { WebContents } from 'electron';

type ModelConversation = { snapshot_id: string; post: { entity_id: string } | null; comments: Array<{ entity_id: string }>; spans: Array<{ id: string; entity_id: string; text: string }> };
const price = { input_per_million: 0.25, output_per_million: 1.5, cached_input_per_million: 0.025, observed_at: '2026-10-30T00:00:00Z', source: 'SYNTHETIC_TEST' };
function modelResult(request: JsonModelRequest): JsonModelResult {
  const conversations = (request.input as { conversations: ModelConversation[] }).conversations;
  const value = conversations.map(conversation => {
    const comment = conversation.spans.find(span => conversation.comments.some(entity => entity.entity_id === span.entity_id));
    const span = comment ?? conversation.spans[0]!;
    const rootText = conversation.spans.filter(item => item.entity_id === conversation.post?.entity_id).map(item => item.text).join(' ');
    const isResolved = rootText.includes('RESOLVED'), isCheckin = !comment && rootText.includes('CHECKIN'), isPromotion = !comment && rootText.includes('PROMOTION');
    const related = isResolved || isCheckin || isPromotion;
    return { snapshot_id: conversation.snapshot_id, case_code: isResolved ? 'RELATED_RESOLVED' : isPromotion ? 'RELATED_PROMOTION' : isCheckin ? 'RELATED_CHECKIN' : 'OPPORTUNITY_REQUEST',
      evidence_ids: [span.id], action_entity_id: related ? '' : span.entity_id, need_summary: related ? 'Chưa có nhu cầu đang mở' : 'Người dùng hỏi quán phù hợp', intents: ['find_place'],
      topic_fit: 'RELATED', observed_need: isResolved ? 'RESOLVED' : isCheckin ? 'NONE' : 'REQUEST', speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: 'OPEN', freshness: 'CURRENT' };
  });
  return { value, invocation_id: 'synthetic-invocation', request_hash: 'synthetic-hash', model: 'synthetic-model', model_version: null,
    usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, thinking_tokens: 0 }, cost_usd: 0.001, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 1, price };
}
function gateway(handler?: (request: JsonModelRequest, call: number) => Promise<JsonModelResult>): ModelGateway & { calls(): number } {
  let calls = 0;
  return { calls: () => calls, async generateJson(request) { calls++; return handler ? handler(request, calls) : modelResult(request); },
    summary: () => ({ model: 'synthetic-model', budget_usd: 3, measured_cost_usd: calls * 0.001, unmetered_cost_upper_usd: 0, reserved_usd: 0,
      remaining_usd: 3 - calls * 0.001, billable_attempts: calls, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }) };
}
function campaign(target = 1000, rawCap = 3000, threadsShare = 0.8) {
  return campaignFromModel({ campaign_id: 'synthetic-pipeline', prompt: 'Tìm quán cafe', seed_queries: ['quán cafe yên tĩnh'], suitable_target: target, raw_cap: rawCap, model_usd: 3,
    desired_platform_weights: { threads: threadsShare, facebook: 1 - threadsShare } },
    { topic: 'quán cafe', audience: ['người tìm quán'], needs: ['tìm quán'], participation_intents: ['hỏi địa điểm'], research_intents: ['giá'], inclusions: ['cafe'], exclusions: [], assumptions: [], queries: [{ text: 'quán cafe yên tĩnh', family: 'REQUEST' }] }, '2026-10-30T00:00:00Z');
}
function observation(id = 'post-1', changes: Partial<ConversationObservation> = {}): ConversationObservation {
  return { platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id, parent_id: null, text: 'Có quán cafe nào yên tĩnh không?', observed_at: '2026-10-30T10:00:00Z',
    permalink: `https://example.test/${id}`, provenance: { run_id: 'synthetic', method: 'TEST_FIXTURE' }, ...changes };
}
async function makePipeline(directory: string, model: ModelGateway, options: { target?: number; rawCap?: number; threadsShare?: 0.8 | 0.7; onProgress?: (progress: OpportunityProgress) => void; comments?: boolean;
  watch?: CampaignPlan['watch']; collect?: OpportunityPipelineInput['collectConversation']; withRevisitWindow?: OpportunityPipelineInput['withRevisitWindow']; verifierGateway?: ModelGateway;
  reuseSavedCampaign?: boolean; store?: OpportunityPipelineInput['store']; resolveRoot?: OpportunityPipelineInput['resolveThreadsReplyRoot']; storageLimits?: StorageLimits } = {}) {
  const target = options.target ?? 1000, rawCap = options.rawCap ?? Math.max(3000, target);
  const plan = campaign(target, rawCap, options.threadsShare); if (options.watch) plan.watch = options.watch;
  return createOpportunityPipeline({ directory, runId: 'synthetic-run', config: { enabled: true, prompt: 'Tìm quán cafe', brandContext: '', totalTarget: target, threadsShare: options.threadsShare ?? 0.8,
    rawCap, budgetUsd: 3, commentsEnabled: options.comments ?? true }, platforms: ['threads', 'facebook'], ...(options.reuseSavedCampaign ? {} : { campaign: plan }), gateway: model,
    collectConversation: options.collect ?? (async () => undefined), ...(options.onProgress ? { onProgress: options.onProgress } : {}), ...(options.withRevisitWindow ? { withRevisitWindow: options.withRevisitWindow } : {}),
    ...(options.verifierGateway ? { verifierGateway: options.verifierGateway } : {}), ...(options.store ? { store: options.store } : {}),
    ...(options.resolveRoot ? { resolveThreadsReplyRoot: options.resolveRoot } : {}), ...(options.storageLimits ? { storageLimits: options.storageLimits } : {}) });
}
async function until(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() >= end) throw Error('TEST_WAIT_TIMED_OUT'); await sleep(20); }
}
async function closeAndRemove(pipeline: OpportunityPipeline, directory: string): Promise<void> { await pipeline.close(); rmSync(directory, { recursive: true, force: true }); }

test('parallel classification drains every retained snapshot once with bounded batches and identical decisions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-parallel-pipeline-'));
  let activeCalls = 0, peak = 0; const seen: string[] = [];
  const model = gateway(async request => {
    const rows = (request.input as { conversations: ModelConversation[] }).conversations;
    assert.ok(rows.length <= 8); seen.push(...rows.map(row => row.snapshot_id));
    peak = Math.max(peak, ++activeCalls); await sleep(40); activeCalls--; return modelResult(request);
  });
  const pipeline = await createOpportunityPipeline({ directory, runId: 'parallel-classify',
    config: { enabled: true, prompt: 'Tìm quán cafe', brandContext: '', totalTarget: 100, threadsShare: .8, rawCap: 300, budgetUsd: 3, commentsEnabled: false },
    platforms: ['threads'], campaign: campaign(), gateway: model, classificationWorkers: 4, processingMode: 'RETAINED', assessmentTime: '2026-11-03T00:00:00Z',
    collectConversation: async () => { throw Error('UNEXPECTED_BROWSER'); } });
  try {
    await pipeline.ingest(Array.from({ length: 40 }, (_, index) => observation('parallel-' + index)));
    await pipeline.drain(); const result = await pipeline.results();
    assert.ok(peak > 1 && peak <= 4); assert.equal(new Set(seen).size, 40); assert.equal(seen.length, 40);
    assert.equal(result.progress.counts.suitable, 40); assert.equal(result.progress.counts.failed, 0);
    assert.equal((await pipeline.store.jobs(['RUNNING'], pipeline.context)).length, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('direct planner pins grounded recipe before billing, preserves interrupted legacy attempts and skips replanning saved campaigns', async () => {
  for (const legacy of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'csd-direct-planner-'));
    let pipeline: OpportunityPipeline | null = null;
    const model = gateway(async request => {
      const pin = JSON.parse(readFileSync(join(directory, 'opportunity', 'planner-recipe.json'), 'utf8'));
      assert.equal(pin.planner_policy, legacy ? 'legacy-short-v1' : 'grounded-constraints-v1');
      assert.equal(request.purpose, legacy ? 'campaign-planner-v1.1-grounded-short' : 'campaign-planner-v1.2.1-grounded-constraints');
      return { ...modelResult({ ...request, input: { conversations: [] } }), value: {
        topic: 'sửa đàn piano', audience: [], needs: ['sửa đàn'], participation_intents: ['hỏi thợ'], research_intents: [], inclusions: [], exclusions: [], assumptions: [],
        queries: [{ text: 'sửa đàn piano', family: 'REQUEST' }],
        ...(legacy ? {} : { constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] } }),
      } };
    });
    const input: OpportunityPipelineInput = { directory, runId: 'direct-planner-test', config: { enabled: true, prompt: 'Tìm người sửa đàn piano', brandContext: '',
      totalTarget: 1000, threadsShare: 0.8, rawCap: 3000, budgetUsd: 3, commentsEnabled: false }, platforms: ['threads'], gateway: model,
      collectConversation: async () => { throw Error('UNEXPECTED_BROWSER'); } };
    try {
      if (legacy) { const folder = join(directory, 'opportunity', 'model'); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'model-ledger.jsonl'), '{"type":"START"}\n'); }
      pipeline = await createOpportunityPipeline(input);
      assert.equal(pipeline.campaign.planner_policy, legacy ? undefined : 'grounded-constraints-v1');
      const before = readFileSync(join(directory, 'opportunity', 'campaign.json'), 'utf8');
      await pipeline.close(); pipeline = await createOpportunityPipeline(input);
      assert.equal(model.calls(), 1); assert.equal(readFileSync(join(directory, 'opportunity', 'campaign.json'), 'utf8'), before);
    } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('initial CLI run minutes are committed once; Resume and supplied campaigns retain their saved limits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-initial-minutes-'));
  let pipeline: OpportunityPipeline | null = null;
  const model = gateway(async request => ({ ...modelResult({ ...request, input: { conversations: [] } }), value: {
    topic: 'tai nghe', audience: [], needs: ['chọn tai nghe'], participation_intents: ['hỏi kinh nghiệm'], research_intents: [], inclusions: [], exclusions: [], assumptions: [],
    queries: [{ text: 'tai nghe', family: 'REQUEST' }], constraints: { geographies: [], languages: [], max_age_days: null, source_priority: null, unresolved: [] },
  } }));
  const input: OpportunityPipelineInput = { directory, runId: 'minutes-test', maxRunMinutes: 37, gateway: model,
    config: { enabled: true, prompt: 'Tìm cuộc thảo luận chọn tai nghe', brandContext: '', totalTarget: 100, threadsShare: 0.8,
      rawCap: 300, budgetUsd: 1, commentsEnabled: false }, platforms: ['threads', 'facebook'], collectConversation: async () => { throw Error('UNEXPECTED_BROWSER'); } };
  try {
    pipeline = await createOpportunityPipeline(input); assert.equal(pipeline.campaign.budget.max_run_minutes, 37);
    const file = join(directory, 'opportunity', 'campaign.json'), bytes = readFileSync(file, 'utf8');
    assert.equal(JSON.parse(bytes).budget.max_run_minutes, 37);
    await pipeline.close(); pipeline = await createOpportunityPipeline({ ...input, maxRunMinutes: 15 });
    assert.equal(pipeline.campaign.budget.max_run_minutes, 37); assert.equal(readFileSync(file, 'utf8'), bytes); assert.equal(model.calls(), 1);
    await pipeline.close(); pipeline = await createOpportunityPipeline({ ...input, directory: join(directory, 'prepared'), campaign: campaign(), maxRunMinutes: 15 });
    assert.equal(pipeline.campaign.budget.max_run_minutes, 240); assert.equal(model.calls(), 1);
  } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid initial run minutes reject before planner persistence or any model invocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-invalid-minutes-')), model = gateway();
  try {
    for (const value of [0, -1, 1441, 1.5, NaN, Infinity, '15', null]) {
      await assert.rejects(createOpportunityPipeline({ directory, runId: 'invalid-minutes', maxRunMinutes: value as number, gateway: model,
        config: { enabled: true, prompt: 'Tìm tai nghe', brandContext: '', totalTarget: 100, threadsShare: 0.8, rawCap: 300, budgetUsd: 1, commentsEnabled: false },
        platforms: ['threads'], collectConversation: async () => { throw Error('UNEXPECTED_BROWSER'); } }), /CAMPAIGN_RUN_MINUTES_INVALID/);
    }
    assert.equal(model.calls(), 0); assert.equal(existsSync(join(directory, 'opportunity')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function focusedResult(request: JsonModelRequest, verdict: 'KEEP' | 'DOWNGRADE_NOT_YET' = 'KEEP'): JsonModelResult {
  const rows = (request.input as { conversations: Array<{ snapshot_id: string; spans: Array<{ id: string }> }> }).conversations;
  return { value: rows.map(row => ({ snapshot_id: row.snapshot_id, verdict,
    reason: verdict === 'KEEP' ? 'PRESERVE_CONSUMER_OPENING' : 'PROVIDER_SELF_PROMOTION', evidence_ids: [row.spans[0]!.id], explanation: 'Synthetic focused check', expiry: null })),
    invocation_id: 'synthetic-focused', request_hash: 'focused-hash', model: 'synthetic-model', model_version: null,
    usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, thinking_tokens: 0 }, cost_usd: 0.001,
    unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 1, price };
}
async function upgradeFixture(directory: string, baseline: CampaignPlan) {
  const folder = join(directory, 'opportunity'), store = await createAsyncConversationStore(join(folder, 'store'));
  try { return await prepareCombinedEvaluationUpgrade({ directory: folder, baselineCampaign: baseline, store, reason: 'TEST_EXPLICIT_EXPERIMENTAL_UPGRADE' }); }
  finally { await store.close(); }
}

test('explicit experimental context resumes with pending backfill, immutable baseline caps and no legacy model-job leakage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-focused-pipeline-'));
  const first = await makePipeline(directory, gateway()); let resumed: OpportunityPipeline | null = null;
  let release!: () => void, entered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await first.ingest([observation('existing')]); await first.drain();
    const baseline = first.campaign, originalContext = first.context, snapshot = await first.store.snapshot('threads', 'existing');
    await first.store.enqueue({ type: 'CLASSIFY', idempotency_key: 'old-context-extra', payload: { ...originalContext, platform: 'threads', root_post_id: 'existing', snapshot_id: snapshot!.id } });
    await first.close(); const folder = join(directory, 'opportunity'), before = readFileSync(join(folder, 'campaign.json'), 'utf8');
    recordRawCapExtension({ directory: folder, campaign: baseline, expectedFromCap: 3000, toRawCap: 3500, reason: 'TEST_EXTENSION', observedCounts: { raw: 1, suitable: 1, pending: 0 } });
    await upgradeFixture(directory, baseline);
    const model = gateway(async request => { assert.match(request.purpose, /focused-verifier/); entered = true; await gate; return focusedResult(request); });
    resumed = await makePipeline(directory, model, { reuseSavedCampaign: true });
    assert.notDeepEqual(resumed.context, originalContext); assert.equal(resumed.runtimeLimits.effective_raw_cap, 3500);
    assert.equal(resumed.progress().counts.suitable, 0); assert.equal(resumed.progress().counts.pending, 1);
    const draining = resumed.drain(); await until(() => entered);
    assert.equal(resumed.progress().counts.suitable, 0); assert.equal(resumed.progress().preview.some(p => p.classification === 'SUITABLE'), false);
    release(); await draining;
    assert.equal(resumed.progress().counts.suitable, 1); assert.equal(model.calls(), 1);
    assert.equal((await resumed.store.jobs(undefined, originalContext)).find(j => j.idempotency_key === 'old-context-extra')!.state, 'PAUSED');
    assert.equal((await resumed.store.stats(originalContext)).suitable, 1);
    assert.equal(readFileSync(join(folder, 'campaign.json'), 'utf8'), before);
    const exported = await resumed.results(); assert.equal(exported.evaluation?.policy, 'PRIMARY_PLUS_FOCUSED_VERIFIER');
    assert.equal(exported.conversations.every(row => row.decision.filter_version === resumed!.campaign.filter_version), true);
  } finally { release(); await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('experimental new-discovery positives enter durable verification and a downgrade never appears as suitable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-focused-pipeline-')); const first = await makePipeline(directory, gateway());
  const baseline = first.campaign; await first.close(); let resumed: OpportunityPipeline | null = null;
  try {
    await upgradeFixture(directory, baseline);
    const model = gateway(async request => request.purpose.includes('focused-verifier') ? focusedResult(request, 'DOWNGRADE_NOT_YET') : modelResult(request));
    const seen: OpportunityProgress[] = []; resumed = await makePipeline(directory, model, { reuseSavedCampaign: true, onProgress: p => seen.push(p) });
    await resumed.ingest([observation('fresh')]); await resumed.drain();
    assert.equal(model.calls(), 2); assert.equal(resumed.progress().counts.suitable, 0); assert.equal(resumed.progress().counts.notYet, 1);
    assert.equal(seen.every(p => p.counts.suitable === 0), true);
    const history = await resumed.store.decisionHistory(resumed.context);
    assert.equal(history.some(d => d.reason_code === 'AWAITING_FOCUSED_VERIFIER' && d.assessment_status === 'PENDING'), true);
    assert.equal(history.some(d => d.classification === 'SUITABLE'), false);
    assert.equal((await resumed.store.jobs(undefined, resumed.context)).find(j => j.type === 'VERIFY')!.state, 'SUCCEEDED');
  } finally { await resumed?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('experimental verifier budget failure pauses pipeline with pending output and cannot fall back to baseline suitable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-focused-pipeline-')); const first = await makePipeline(directory, gateway()); let resumed: OpportunityPipeline | null = null;
  try {
    await first.ingest([observation('existing')]); await first.drain(); const baseline = first.campaign, originalContext = first.context; await first.close();
    await upgradeFixture(directory, baseline);
    resumed = await makePipeline(directory, gateway(async () => { throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED'); }), { reuseSavedCampaign: true });
    await resumed.drain(); const output = await resumed.results();
    assert.equal(output.progress.phase, 'MODEL_PAUSED'); assert.equal(output.progress.counts.suitable, 0); assert.equal(output.progress.counts.pending, 1);
    assert.equal(output.conversations.some(row => row.decision.classification === 'SUITABLE'), false);
    assert.equal((await resumed.store.stats(originalContext)).suitable, 1);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('a total target of1000 honors the configured platform ratio and does not complete on the wrong mix', async () => {
  for (const threadsShare of [0.8, 0.7] as const) {
    const directory = mkdtempSync(join(tmpdir(), 'csd-platform-target-'));
    const store = await createAsyncConversationStore(join(directory, 'opportunity', 'store'));
    const observed = { threads: Math.round(1000 * threadsShare), facebook: Math.round(1000 * (1 - threadsShare)) };
    const syntheticCounts = new Proxy(store, { get(target, key) {
      if (key !== 'stats') return Reflect.get(target, key);
      return async (...args: Parameters<typeof store.stats>) => {
        const base = await target.stats(...args), suitable = args[1] ? observed[args[1]] : observed.threads + observed.facebook;
        return { ...base, raw_unique_posts: suitable, suitable, pending: 0 };
      };
    } });
    const pipeline = await makePipeline(directory, gateway(), { threadsShare, store: syntheticCounts });
    try {
      assert.equal(pipeline.targetReached(), true); assert.equal(pipeline.progress().counts.suitable, 1000);
      assert.equal(pipeline.discoveryShouldStop('threads'), true); assert.equal(pipeline.discoveryShouldStop('facebook'), true);
      observed.threads -= 100; observed.facebook += 100; await pipeline.results();
      assert.equal(pipeline.progress().counts.suitable, 1000); assert.equal(pipeline.targetReached(), false);
      assert.equal(pipeline.discoveryShouldStop('threads'), false); assert.equal(pipeline.discoveryShouldStop('facebook'), true);
    } finally { await closeAndRemove(pipeline, directory); }
  }
});
test('explicit baseline resume wakes legacy browser jobs but comments-disabled mode never collects them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-legacy-enrichment-resume-'));
  const first = await makePipeline(directory, gateway()); let resumed: OpportunityPipeline | null = null, calls = 0;
  try {
    await first.store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: 'legacy-browser-without-context',
      payload: { platform: 'threads', root_post_id: 'legacy', root_url: 'https://example.test/legacy' } });
    await first.close();
    resumed = await makePipeline(directory, gateway(), { reuseSavedCampaign: true, comments: false, collect: async () => { calls++; } });
    assert.equal((await resumed.store.jobs()).find(j => j.idempotency_key === 'legacy-browser-without-context')!.state, 'PENDING');
    await resumed.enrich('threads', {} as WebContents, () => false, 1); assert.equal(calls, 0);
    assert.equal(await resumed.startWatching().catch(() => false), false);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('reply resolver persists a proven root and comment before ordinary enrichment, without counting the reply as another post', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-resolve-test-'));
  const rootUrl = 'https://www.threads.com/@fixture/post/RootCode';
  let called = 0;
  const pipeline = await makePipeline(directory, gateway(), { resolveRoot: async input => {
    called++; assert.equal(input.candidate.id, '2');
    await input.onObservations([observation('1', { permalink: rootUrl }), observation('2', { entity_type: 'COMMENT', root_post_id: '1', parent_id: '1', permalink: input.candidate.url })]);
    return { status: 'RESOLVED', root: { id: '1', url: rootUrl } };
  } });
  try {
    await pipeline.ingestRows('threads', [{ post_id: '2', is_reply: true, text: 'Xin địa chỉ quán cafe', post_url: 'https://www.threads.com/@fixture/post/ReplyCode', query: 'xin quán cafe' }], {});
    assert.equal(pipeline.progress().counts.raw, 0);
    await pipeline.enrich('threads', {} as WebContents, () => false, 1, ['ROOT_RESOLVE']);
    assert.equal(called, 1); assert.equal(pipeline.progress().counts.raw, 1); assert.equal(pipeline.progress().counts.comments, 1);
    assert.equal((await pipeline.store.jobs()).filter(job => job.type === 'ENRICH_CONVERSATION').length, 1);
    assert.equal((await pipeline.store.jobs()).find(job => job.type === 'ROOT_RESOLVE')?.state, 'SUCCEEDED');
    const exported = await pipeline.results(); assert.equal(exported.root_resolution.attempts, 1);
    assert.equal((await pipeline.store.observations()).filter(o => o.entity_type === 'CANDIDATE').length, 1);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('resume backfills old reply locators; unsafe locators and unresolved captures never create roots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-resume-test-'));
  const first = await makePipeline(directory, gateway());
  let second: OpportunityPipeline | null = null, calls = 0;
  try {
    await first.ingestRows('threads', [{ post_id: '2', is_reply: true, text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/ReplyCode' },
      { post_id: '3', is_reply: true, text: 'Cafe?', post_url: 'https://example.test/@fixture/post/Other' }], {});
    await first.close();
    second = await makePipeline(directory, gateway(), { reuseSavedCampaign: true, resolveRoot: async () => { calls++; return { status: 'UNRESOLVED', root: null }; } });
    assert.equal((await second.store.jobs()).filter(j => j.type === 'ROOT_RESOLVE').length, 1);
    await second.enrich('threads', {} as WebContents, () => false, 2, ['ROOT_RESOLVE']);
    assert.equal(calls, 1); assert.equal(second.progress().counts.raw, 0);
    await second.stop(); assert.equal((await second.store.observations()).filter(o => o.provenance.method === 'ROOT_RESOLUTION_UNRESOLVED').length, 1);
  } finally { await second?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('root resolver account barrier pauses the platform, and fabricated success cannot create a suitable root', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-failure-test-'));
  let barrier = false;
  const pipeline = await makePipeline(directory, gateway(), { resolveRoot: async () => barrier ? { status: 'INACCESSIBLE', root: null } : { status: 'RESOLVED', root: { id: '1', url: 'https://www.threads.com/@fixture/post/Root' } } });
  try {
    await pipeline.ingestRows('threads', [{ post_id: '2', is_reply: true, text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/Reply' }], {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 1, ['ROOT_RESOLVE']);
    const failed = (await pipeline.store.jobs()).find(j => j.type === 'ROOT_RESOLVE');
    assert.equal(failed?.error, 'ROOT_RESOLUTION_EVIDENCE_MISSING'); assert.equal(pipeline.progress().counts.raw, 0);
    const audit = await pipeline.store.observations();
    assert.equal(audit.some(o => o.provenance.method === 'ROOT_RESOLUTION_RESOLVED'), false);
    assert.equal(audit.some(o => o.provenance.method === 'ROOT_RESOLUTION_EVIDENCE_MISSING'), true);
    barrier = true;
    await pipeline.ingestRows('threads', [{ post_id: '3', is_reply: true, text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/Reply2' }], {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 1, ['ROOT_RESOLVE']);
    assert.equal((await pipeline.store.jobs()).filter(j => j.type === 'ROOT_RESOLVE').every(j => j.state === 'PAUSED'), true);
    assert.equal(pipeline.progress().lastError, 'COMMENTS_ACCOUNT_BARRIER_THREADS');
  } finally { await closeAndRemove(pipeline, directory); }
});

test('root resolution refreshes native root hint acquired after its idempotent candidate job was queued', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-hint-test-'));
  const rootUrl = 'https://www.threads.com/@fixture/post/Root'; let called = 0;
  const pipeline = await makePipeline(directory, gateway(), { resolveRoot: async input => {
    called++; assert.equal(input.candidate.root_id, '1');
    await input.onObservations([observation('1', { permalink: rootUrl }), observation('2', { entity_type: 'COMMENT', root_post_id: '1', parent_id: '1', permalink: input.candidate.url })]);
    return { status: 'RESOLVED', root: { id: '1', url: rootUrl } };
  } });
  try {
    const row = { post_id: '2', is_reply: true, text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/Reply' };
    await pipeline.ingestRows('threads', [row], {});
    await pipeline.ingestRows('threads', [{ ...row, root_post_id: '1', parent_id: '1' }], {});
    assert.equal((await pipeline.store.jobs()).filter(job => job.type === 'ROOT_RESOLVE').length, 1);
    await pipeline.enrich('threads', {} as WebContents, () => false, 1, ['ROOT_RESOLVE']);
    assert.equal(called, 1); assert.equal((await pipeline.store.jobs()).find(job => job.type === 'ROOT_RESOLVE')?.state, 'SUCCEEDED');
    assert.equal((await pipeline.store.observations()).filter(o => o.provenance.method === 'ROOT_RESOLUTION_RESOLVED').length, 1);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('known orphan root identity is passed to resolver and contradictory callback rows cannot mutate another conversation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-conflict-test-'));
  const pipeline = await makePipeline(directory, gateway(), { resolveRoot: async input => {
    assert.equal(input.candidate.root_id, '1');
    await input.onObservations([observation('9', { permalink: 'https://www.threads.com/@fixture/post/Wrong' })]);
    return { status: 'RESOLVED', root: { id: '9', url: 'https://www.threads.com/@fixture/post/Wrong' } };
  } });
  try {
    await pipeline.ingestRows('threads', [{ post_id: '2', is_reply: true, root_post_id: '1', text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/Reply' }], {});
    assert.equal((await pipeline.store.jobs()).find(job => job.type === 'ROOT_RESOLVE')?.payload.expected_root_id, '1');
    await pipeline.enrich('threads', {} as WebContents, () => false, 1, ['ROOT_RESOLVE']);
    assert.equal((await pipeline.store.jobs()).find(job => job.type === 'ROOT_RESOLVE')?.error, 'ROOT_RESOLUTION_IDENTITY_CONFLICT');
    assert.equal(await pipeline.store.snapshot('threads', '9'), null);
    assert.equal((await pipeline.store.observations()).some(o => o.provenance.method === 'ROOT_RESOLUTION_RESOLVED'), false);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('already resolved historical candidate is not scheduled again during resume backfill', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-backfill-dedup-test-'));
  const first = await makePipeline(directory, gateway()); let resumed: OpportunityPipeline | null = null;
  try {
    await first.ingestRows('threads', [{ post_id: '2', is_reply: true, text: 'Cafe?', post_url: 'https://www.threads.com/@fixture/post/Reply' }], {});
    await first.ingest([observation('1', { permalink: 'https://www.threads.com/@fixture/post/Root' }), observation('2', { entity_type: 'COMMENT', root_post_id: '1', parent_id: '1' })]);
    await first.close();
    resumed = await makePipeline(directory, gateway(), { reuseSavedCampaign: true, resolveRoot: async () => { throw Error('UNNECESSARY_RESOLUTION'); } });
    assert.equal((await resumed.store.jobs()).filter(job => job.type === 'ROOT_RESOLVE').length, 0);
    assert.equal((await resumed.store.observations()).filter(o => o.entity_type === 'CANDIDATE').length, 1);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('root resolution attempt cap survives resume without dropping unattempted locators', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-root-cap-test-'));
  let calls = 0, resumed: OpportunityPipeline | null = null;
  const resolveRoot: NonNullable<OpportunityPipelineInput['resolveThreadsReplyRoot']> = async () => { calls++; return { status: 'UNRESOLVED', root: null }; };
  const first = await makePipeline(directory, gateway(), { resolveRoot });
  try {
    await first.ingestRows('threads', Array.from({ length: 51 }, (_, i) => ({ post_id: String(i + 10), is_reply: true, text: 'Cafe?', post_url: `https://www.threads.com/@fixture/post/R${i}` })), {});
    await first.enrich('threads', {} as WebContents, () => false, 51, ['ROOT_RESOLVE']);
    assert.equal(calls, 50); await first.close();
    resumed = await makePipeline(directory, gateway(), { reuseSavedCampaign: true, resolveRoot });
    await resumed.enrich('threads', {} as WebContents, () => false, 5, ['ROOT_RESOLVE']);
    assert.equal(calls, 50); const output = await resumed.results(); assert.equal(output.root_resolution.remaining_jobs, 1); assert.equal(output.root_resolution.attempts, 50);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('persisted filter recipe records its exact hash and remains byte-identical across explicit resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-recipe-test-')), firstModel = gateway();
  const first = await makePipeline(directory, firstModel);
  let resumed: OpportunityPipeline | null = null;
  try {
    const file = join(directory, 'opportunity', 'filter-recipe.json'), original = readFileSync(file, 'utf8');
    const saved = JSON.parse(original) as { recipe: unknown; recipe_sha256: string; recorded_at: string; backfilled_on_resume: boolean };
    assert.deepEqual(saved.recipe, classifierRecipe()); assert.equal(saved.recipe_sha256, contentHash(classifierRecipe()));
    assert.equal(contentHash(saved.recipe), saved.recipe_sha256); assert.equal(saved.backfilled_on_resume, false);
    await first.close();
    const resumeModel = gateway(); resumed = await makePipeline(directory, resumeModel, { reuseSavedCampaign: true });
    assert.equal(readFileSync(file, 'utf8'), original); assert.equal(resumed.campaign.filter_version, first.campaign.filter_version);
    assert.equal(firstModel.calls(), 0); assert.equal(resumeModel.calls(), 0);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('tampered recipe rejects resume before store access or inference and preserves campaign state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-recipe-test-')), first = await makePipeline(directory, gateway());
  await first.close();
  const recipeFile = join(directory, 'opportunity', 'filter-recipe.json'), campaignFile = join(directory, 'opportunity', 'campaign.json');
  const original = JSON.parse(readFileSync(recipeFile, 'utf8')), campaignBytes = readFileSync(campaignFile, 'utf8');
  let touches = 0;
  const forbiddenStore = new Proxy({} as NonNullable<OpportunityPipelineInput['store']>, { get() { touches++; throw Error('STORE_TOUCHED_BEFORE_RECIPE_CHECK'); } });
  try {
    for (const change of ['recipe_only', 'hash_only', 'recipe_and_hash']) {
      const tampered = structuredClone(original);
      if (change !== 'hash_only') tampered.recipe.system += '\nSYNTHETIC_UNAUTHORIZED_RULE';
      if (change !== 'recipe_only') tampered.recipe_sha256 = change === 'hash_only' ? '0'.repeat(64) : contentHash(tampered.recipe);
      writeFileSync(recipeFile, JSON.stringify(tampered)); const model = gateway();
      await assert.rejects(() => makePipeline(directory, model, { reuseSavedCampaign: true, store: forbiddenStore }), /FILTER_RECIPE_MISMATCH/);
      assert.equal(model.calls(), 0); assert.equal(touches, 0); assert.equal(readFileSync(campaignFile, 'utf8'), campaignBytes);
      assert.equal(existsSync(join(directory, 'opportunity', 'store', 'conversation-writer.lock')), false);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('resuming an older filter version requires an explicit upgrade without new model calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-recipe-test-')), first = await makePipeline(directory, gateway());
  await first.close();
  const campaignFile = join(directory, 'opportunity', 'campaign.json'), recipeFile = join(directory, 'opportunity', 'filter-recipe.json');
  const saved = JSON.parse(readFileSync(campaignFile, 'utf8')); saved.filter_version = 'conversation-opportunity-v0.0.0';
  writeFileSync(campaignFile, JSON.stringify(saved)); const oldCampaign = readFileSync(campaignFile, 'utf8'), originalRecipe = readFileSync(recipeFile, 'utf8'), model = gateway();
  let touches = 0;
  const forbiddenStore = new Proxy({} as NonNullable<OpportunityPipelineInput['store']>, { get() { touches++; throw Error('STORE_TOUCHED_BEFORE_VERSION_CHECK'); } });
  try {
    await assert.rejects(() => makePipeline(directory, model, { reuseSavedCampaign: true, store: forbiddenStore }), /CAMPAIGN_FILTER_UPGRADE_REQUIRED/);
    assert.equal(model.calls(), 0); assert.equal(touches, 0); assert.equal(readFileSync(campaignFile, 'utf8'), oldCampaign);
    assert.equal(readFileSync(recipeFile, 'utf8'), originalRecipe); assert.equal(existsSync(join(directory, 'opportunity', 'store', 'conversation-writer.lock')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('streaming classification publishes useful results while discovery remains active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), events: OpportunityProgress[] = [], model = gateway();
  const pipeline = await makePipeline(directory, model, { onProgress: progress => events.push(progress) });
  try {
    await Promise.all([pipeline.ingest([observation('one')]), pipeline.ingest([observation('two', { platform: 'facebook' })])]);
    await until(() => events.some(event => event.counts.suitable === 2));
    assert.equal(pipeline.progress().phase, 'COLLECTING'); assert.equal(pipeline.progress().totalTarget, 1000);
    assert.equal(pipeline.progress().byPlatform.threads.suitable, 1); assert.equal(pipeline.progress().byPlatform.facebook.suitable, 1);
    assert.equal((await pipeline.store.observations()).length, 2); assert.equal(model.calls(), 1);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('delayed verifier keeps primary proposals out of suitable results and audits a downgrade with combined cost', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), events: OpportunityProgress[] = [], primary = gateway();
  let verificationRequest: JsonModelRequest | null = null, release: ((result: JsonModelResult) => void) | null = null;
  const verification = gateway(async request => {
    verificationRequest = request;
    return new Promise<JsonModelResult>(resolve => { release = resolve; });
  });
  const verifier: ModelGateway = { ...verification, summary: () => ({ ...verification.summary(), model: 'synthetic-verifier', measured_cost_usd: verification.calls() * 0.004,
    unmetered_cost_upper_usd: 0.002, reserved_usd: 0.003 }) };
  const pipeline = await makePipeline(directory, primary, { verifierGateway: verifier, onProgress: event => events.push(event) });
  const resolveVerification = () => {
    if (!release || !verificationRequest) return;
    const request = verificationRequest, resolve = release;
    release = null;
    const conversations = (request.input as { conversations: ModelConversation[] }).conversations;
    resolve({ ...modelResult(request), model: 'synthetic-verifier', cost_usd: 0.004,
      value: conversations.map(conversation => ({ snapshot_id: conversation.snapshot_id, verdict: 'RESEARCH_PROMOTION',
        evidence_ids: [conversation.spans[0]!.id], explanation: 'Bài quảng bá quán chưa có nhu cầu tiêu dùng đang mở.' })) });
  };
  try {
    await pipeline.ingest([observation('requires-verification')]); await until(() => release !== null);
    assert.equal(primary.calls(), 1); assert.equal(verification.calls(), 1);
    assert.equal(pipeline.progress().counts.suitable, 0);
    assert.equal((await pipeline.store.results(pipeline.context, { classification: 'SUITABLE' })).length, 0);
    assert.equal(events.some(event => event.counts.suitable > 0 || event.preview.some(row => row.classification === 'SUITABLE')), false);
    const awaiting = await pipeline.store.decisionHistory(pipeline.context);
    assert.equal(awaiting.length, 1); assert.equal(awaiting[0]!.reason_code, 'AWAITING_VERIFIER');
    assert.equal(awaiting[0]!.classification, null); assert.equal(awaiting[0]!.attributes?.proposed_classification, 'SUITABLE');
    resolveVerification(); await pipeline.drain();
    assert.equal(pipeline.progress().counts.suitable, 0); assert.equal(pipeline.progress().counts.notYet, 1);
    assert.equal(events.some(event => event.counts.suitable > 0 || event.preview.some(row => row.classification === 'SUITABLE')), false);
    const history = await pipeline.store.decisionHistory(pipeline.context);
    assert.equal(history.length, 2);
    assert.equal(history[0]!.classification, null); assert.equal(history[0]!.assessment_status, 'PENDING');
    assert.equal(history[0]!.reason_code, 'AWAITING_VERIFIER'); assert.equal(history[0]!.attributes?.proposed_classification, 'SUITABLE');
    assert.equal(history[0]!.model, 'synthetic-model'); assert.ok(history[0]!.evidence_ids.length > 0);
    assert.equal(history[1]!.classification, 'NOT_YET'); assert.equal(history[1]!.assessment_status, 'ASSESSED');
    assert.equal(history[1]!.reason_code, 'VERIFIER_RESEARCH_PROMOTION'); assert.equal(history[1]!.attributes?.verification_status, 'DOWNGRADED');
    assert.equal(history[1]!.model, 'synthetic-verifier');
    const exported = await pipeline.results();
    assert.equal(exported.cost.measured_cost_usd, 0.005); assert.equal(exported.cost.unmetered_cost_upper_usd, 0.002);
    assert.equal(exported.cost.reserved_usd, 0.003); assert.equal(exported.cost.billable_attempts, 2); assert.equal(exported.cost.models.length, 2);
    assert.ok(Math.abs(exported.cost.remaining_usd - 2.99) < 1e-12);
    assert.equal(pipeline.progress().costUsd, 0.005); assert.equal(pipeline.progress().costUpperUsd, 0.01);
  } finally { resolveVerification(); await closeAndRemove(pipeline, directory); }
});

test('total target is shared across platforms; explicitly configured seven-to-three mix satisfies a target of ten', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), pipeline = await makePipeline(directory, gateway(), { target: 10, threadsShare: 0.7 });
  try {
    await pipeline.ingest(Array.from({ length: 9 }, (_, i) => observation(`root-${i}`, { platform: i < 7 ? 'threads' : 'facebook' })));
    await pipeline.drain();
    assert.equal(pipeline.targetReached(), false); assert.equal(pipeline.discoveryShouldStop('facebook'), false);
    await pipeline.ingest([observation('root-9', { platform: 'facebook' })]);
    await pipeline.drain();
    assert.equal(pipeline.progress().counts.suitable, 10); assert.equal(pipeline.targetReached(), true);
    assert.equal(pipeline.progress().byPlatform.threads.suitable, 7); assert.equal(pipeline.progress().byPlatform.facebook.suitable, 3);
    assert.equal(pipeline.discoveryShouldStop('threads'), true); assert.equal(pipeline.discoveryShouldStop('facebook'), true);
    assert.equal(pipeline.progress().phase, 'SETTLED');
  } finally { await closeAndRemove(pipeline, directory); }
});

test('new comment evidence changes a check-in to suitable without inflating raw root count', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), pipeline = await makePipeline(directory, gateway());
  try {
    await pipeline.ingest([observation('checkin', { text: 'CHECKIN tại quán cafe' })]); await pipeline.drain();
    assert.equal(pipeline.progress().counts.notYet, 1);
    await pipeline.ingest([observation('checkin', { entity_type: 'COMMENT', entity_id: 'question-1', parent_id: 'checkin', text: 'Quán yên tĩnh không bạn?', observed_at: '2026-10-30T11:00:00Z' })]);
    await pipeline.drain();
    assert.equal(pipeline.progress().counts.suitable, 1); assert.equal(pipeline.progress().counts.raw, 1); assert.equal(pipeline.progress().counts.comments, 1);
    const result = (await pipeline.store.results(pipeline.context))[0]!; assert.equal(result.decision.action_target!.entity_id, 'question-1');
  } finally { await closeAndRemove(pipeline, directory); }
});

test('more than 128 context-pending rows do not deadlock backpressure after their queue is settled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), model = gateway(), pipeline = await makePipeline(directory, model);
  try {
    await pipeline.ingest(Array.from({ length: 129 }, (_, i) => observation(`media-${i}`, { text: '' })));
    await pipeline.drain(); assert.equal(pipeline.progress().counts.pending, 129); assert.equal(model.calls(), 0);
    assert.equal(pipeline.progress().phase, 'PARTIAL');
    const finished = pipeline.backpressure();
    await Promise.race([finished, sleep(1500).then(() => { throw Error('BACKPRESSURE_DEADLOCK'); })]);
    assert.equal((await pipeline.store.jobs(['PENDING', 'RUNNING', 'RETRY'])).filter(job => job.type === 'CLASSIFY').length, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('Stop aborts inference but preserves the interrupted job for explicit later resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  let started = false;
  const aborting = gateway(async request => {
    started = true;
    return new Promise<JsonModelResult>((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(new ModelGatewayError('MODEL_ABORTED_USAGE_UNKNOWN')), { once: true }));
  });
  const first = await makePipeline(directory, aborting);
  await first.ingest([observation()]); await until(() => started); await first.stop();
  assert.equal(first.progress().phase, 'PAUSED'); assert.equal((await first.store.jobs(['PAUSED'])).filter(job => job.type === 'CLASSIFY').length, 1);
  assert.equal(first.progress().counts.unrelated, 0); await first.close();
  const resumed = await makePipeline(directory, gateway());
  try { await resumed.drain(); assert.equal(resumed.progress().counts.suitable, 1); assert.equal((await resumed.store.jobs(['SUCCEEDED']))[0]!.attempts, 2); }
  finally { await closeAndRemove(resumed, directory); }
});

test('transient provider failure retries a durable job and becomes a valid result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  const model = gateway(async (request, call) => { if (call === 1) throw new ModelGatewayError('MODEL_NETWORK_USAGE_UNKNOWN', true); return modelResult(request); });
  const pipeline = await makePipeline(directory, model);
  try {
    await pipeline.ingest([observation()]); await pipeline.drain();
    assert.equal(model.calls(), 2); assert.equal(pipeline.progress().counts.suitable, 1);
    assert.equal((await pipeline.store.jobs(['SUCCEEDED']))[0]!.attempts, 2);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('missing key pauses model work and retains retryable jobs instead of silently completing them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  const model = gateway(async () => { throw new ModelGatewayError('GEMINI_API_KEY_MISSING'); });
  const pipeline = await makePipeline(directory, model);
  try {
    await pipeline.ingest([observation()]); await pipeline.drain();
    assert.equal(pipeline.progress().phase, 'MODEL_PAUSED'); assert.equal(pipeline.progress().lastError, 'GEMINI_API_KEY_MISSING');
    assert.equal((await pipeline.store.jobs(['RETRY'])).length, 1); assert.equal((await pipeline.store.jobs(['SUCCEEDED'])).length, 0);
    assert.equal(pipeline.discoveryShouldStop('threads'), true);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('persistent transient errors exhaust retry budget without leaving a spinning processing loop', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  const model = gateway(async () => { throw new ModelGatewayError('MODEL_HTTP_503', true); });
  const pipeline = await makePipeline(directory, model);
  try {
    await pipeline.ingest([observation()]); await pipeline.drain();
    assert.equal(model.calls(), 3); assert.equal(pipeline.progress().counts.failed, 1); assert.equal(pipeline.progress().phase, 'PARTIAL');
    assert.equal((await pipeline.store.jobs(['FAILED'])).length, 1); await pipeline.backpressure();
  } finally { await closeAndRemove(pipeline, directory); }
});

test('late model response for an earlier snapshot remains history and cannot restore an obsolete opportunity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  let firstRequest: JsonModelRequest | null = null, release: ((result: JsonModelResult) => void) | null = null;
  const model = gateway(async (request, call) => { if (call === 1) { firstRequest = request; return new Promise<JsonModelResult>(resolve => { release = resolve; }); } return modelResult(request); });
  const pipeline = await makePipeline(directory, model);
  try {
    await pipeline.ingest([observation()]); await until(() => release !== null);
    await pipeline.ingest([observation('post-1', { text: 'RESOLVED Đã tìm được quán rồi', observed_at: '2026-10-30T12:00:00Z' })]);
    (release as unknown as (result: JsonModelResult) => void)(modelResult(firstRequest!));
    await pipeline.drain();
    assert.equal(pipeline.progress().counts.suitable, 0); assert.equal(pipeline.progress().counts.notYet, 1);
    assert.equal((await pipeline.store.decisionHistory(pipeline.context)).length, 2);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('row ingest preserves sparse metadata and keeps every observed row while stopping at raw cap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')), pipeline = await makePipeline(directory, gateway(), { target: 1, rawCap: 3 });
  try {
    await pipeline.ingestRows('threads', [{ post_id: 'metadata', text: 'Tìm quán cafe?', author_name: 'Example', source_type: 'GROUP', source_name: 'Example group', post_url: 'https://example.test/metadata', media_refs: [{ type: 'IMAGE', url: 'https://example.test/image' }], collected_at: '2026-10-30T10:00:00Z' }], {});
    await pipeline.ingestRows('threads', [{ post_id: 'metadata', text: 'Tìm quán cafe?', collected_at: '2026-10-30T11:00:00Z' }], {});
    const snapshot = await pipeline.store.snapshot('threads', 'metadata');
    assert.equal(snapshot!.post!.author.name, 'Example'); assert.equal(snapshot!.post!.source.kind, 'GROUP'); assert.equal(snapshot!.post!.media.length, 1); assert.equal(snapshot!.post!.permalink, 'https://example.test/metadata');
    await pipeline.ingestRows('threads', [1, 2, 3].map(i => ({ post_id: `extra-${i}`, text: 'Tìm quán cafe?', collected_at: '2026-10-30T11:00:00Z' })), {});
    assert.equal(pipeline.progress().counts.raw, 4); assert.equal(pipeline.discoveryShouldStop('threads'), true);
    assert.equal((await pipeline.store.observations()).length, 5);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('unknown comment counts receive lower-priority initial capture while explicit zero with text is skipped', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-comment-count-test-')), pipeline = await makePipeline(directory, gateway());
  try {
    await pipeline.ingestRows('threads', [
      { post_id: 'unknown', text: 'A complete relevant post', post_url: 'https://example.test/unknown' },
      { post_id: 'null-count', text: 'Another complete post', replies: null, post_url: 'https://example.test/null-count' },
      { post_id: 'positive', text: 'A complete post with replies', comments_count: 3, post_url: 'https://example.test/positive' },
      { post_id: 'zero', text: 'A complete post without replies', comments_count: 0, post_url: 'https://example.test/zero' },
      { post_id: 'image-only', text: '', comments_count: 0, post_url: 'https://example.test/image-only' },
    ], {});
    const jobs = (await pipeline.store.jobs()).filter(job => job.type === 'ENRICH_CONVERSATION');
    assert.equal(jobs.length, 4); assert.equal(jobs.some(job => job.payload.root_post_id === 'zero'), false);
    const priority = (id: string) => jobs.find(job => job.payload.root_post_id === id)!.priority;
    assert.ok(priority('unknown') < priority('positive')); assert.ok(priority('positive') < priority('image-only'));
    assert.equal(priority('null-count'), priority('unknown'));
    assert.equal((await pipeline.store.snapshot('threads', 'unknown'))!.coverage.advertised_count, null);
    assert.equal((await pipeline.store.snapshot('threads', 'zero'))!.coverage.advertised_count, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('bounded promotion watch can discover a consumer comment while expired promotions never capture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-promotion-watch-test-')); let captures = 0;
  const pipeline = await makePipeline(directory, gateway(), { watch: { enabled: true, revisit_hours: [0.00001, 0.00002], ttl_hours: 1, max_attempts: 2 },
    withRevisitWindow: async (_platform, work) => { await work({} as WebContents); },
    collect: async input => { captures++; assert.equal(input.root.id, 'provider'); await input.onObservations([observation(input.root.id,
      { entity_type: 'COMMENT', entity_id: 'customer-question', parent_id: input.root.id, text: 'Dịch vụ phù hợp cho nhu cầu của tôi không?', observed_at: new Date().toISOString() })]); } });
  try {
    await pipeline.ingest([observation('provider', { text: 'PROMOTION Our venue offers a service', observed_at: new Date(Date.now() - 2000).toISOString(), source: { kind: 'PAGE' } }),
      observation('expired-provider', { text: 'PROMOTION Old provider post', observed_at: new Date(Date.now() - 7200000).toISOString(), source: { kind: 'PAGE' } })]);
    await pipeline.drain(); assert.equal(pipeline.progress().counts.notYet, 2); assert.equal(captures, 0);
    assert.equal((await pipeline.store.jobs()).filter(job => job.type === 'REVISIT').length, 4);
    assert.equal(await pipeline.startWatching(), true); await until(() => pipeline.progress().counts.suitable === 1 && !pipeline.isWatching());
    assert.equal(captures, 1); assert.equal(pipeline.progress().counts.raw, 2);
    const result = (await pipeline.store.results(pipeline.context, { classification: 'SUITABLE' }))[0]!;
    assert.equal(result.snapshot.root_post_id, 'provider'); assert.equal(result.decision.action_target?.entity_id, 'customer-question');
    assert.ok(result.snapshot.spans.some(span => span.entity_id === 'customer-question' && result.decision.evidence_ids.includes(span.id)));
    assert.equal((await pipeline.store.jobs(['SUPERSEDED'])).filter(job => job.error === 'WATCH_TTL_EXPIRED').length, 2);
    assert.equal(pipeline.progress().watchPending, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('explicit watcher coalesces missed revisits and reclassifies new comments after discovery ends', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  let opens = 0, captures = 0;
  const pipeline = await makePipeline(directory, gateway(), { watch: { enabled: true, revisit_hours: [0.00001, 0.00002, 0.00003], ttl_hours: 1, max_attempts: 3 },
    withRevisitWindow: async (_platform, work) => { opens++; await work({} as WebContents); },
    collect: async input => { captures++; await input.onObservations([observation(input.root.id, { entity_type: 'COMMENT', entity_id: 'watch-question', parent_id: input.root.id,
      text: 'Quán này có yên tĩnh không?', observed_at: new Date().toISOString() })]); } });
  try {
    await pipeline.ingest([observation('watch-root', { text: 'CHECKIN quán cafe', observed_at: new Date(Date.now() - 2000).toISOString() })]); await pipeline.drain();
    await sleep(50); assert.equal(opens, 0); assert.equal(pipeline.isWatching(), false);
    assert.equal(await pipeline.startWatching(), true);
    await until(() => pipeline.progress().counts.suitable === 1 && !pipeline.isWatching());
    assert.equal(opens, 1); assert.equal(captures, 1); assert.equal(pipeline.progress().counts.raw, 1);
    assert.equal((await pipeline.store.jobs(['SUPERSEDED'])).filter(job => job.type === 'REVISIT').length, 2);
    assert.equal(pipeline.progress().watchPending, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('Stop cancels future promotion watch timers and factory creation never auto-starts the watcher', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  let opens = 0;
  const options = { watch: { enabled: true, revisit_hours: [0.0004], ttl_hours: 1, max_attempts: 1 },
    withRevisitWindow: async (_platform: 'facebook' | 'threads', work: (window: WebContents) => Promise<void>) => { opens++; await work({} as WebContents); } };
  const first = await makePipeline(directory, gateway(), options);
  await first.ingest([observation('future-watch', { text: 'PROMOTION Our venue offers a service', observed_at: new Date().toISOString() })]); await first.drain();
  assert.equal(await first.startWatching(), true); assert.equal(first.progress().phase, 'WATCHING');
  await first.stop(); await first.close(); await sleep(1500); assert.equal(opens, 0);
  const resumed = await makePipeline(directory, gateway(), options);
  try {
    await sleep(60); assert.equal(opens, 0); await resumed.drain(); assert.equal(await resumed.startWatching(), true);
    await until(() => !resumed.isWatching()); assert.equal(opens, 1);
  } finally { await closeAndRemove(resumed, directory); }
});

test('Stop waits for the active watch capture to persist partial evidence and release its window', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-'));
  let started = false, released = false;
  const pipeline = await makePipeline(directory, gateway(), { watch: { enabled: true, revisit_hours: [0.00001], ttl_hours: 1, max_attempts: 1 },
    withRevisitWindow: async (_platform, work) => { try { await work({} as WebContents); } finally { released = true; } },
    collect: async input => { started = true; while (!input.shouldStop()) await sleep(5); await input.onObservations([observation(input.root.id, { entity_type: 'CAPTURE', entity_id: null,
      text: '', observed_at: new Date().toISOString(), coverage: { status: 'PARTIAL', stop_reason: 'USER_STOP' } })]); } });
  try {
    await pipeline.ingest([observation('active-watch', { text: 'CHECKIN quán cafe', observed_at: new Date(Date.now() - 1000).toISOString() })]); await pipeline.drain();
    await pipeline.startWatching(); await until(() => started); await pipeline.stop();
    assert.equal(released, true); assert.equal(pipeline.progress().phase, 'PAUSED'); assert.equal((await pipeline.store.snapshot('threads', 'active-watch'))!.coverage.stop_reason, 'USER_STOP');
  } finally { await closeAndRemove(pipeline, directory); }
});

test('account barrier pauses only that platform enrichment and avoids repeated inaccessible captures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-test-')); let captures = 0;
  const pipeline = await makePipeline(directory, gateway(), { collect: async () => { captures++; return { coverage: { status: 'INACCESSIBLE', stop_reason: 'ACCOUNT_BARRIER' } }; } });
  try {
    await pipeline.ingestRows('threads', [1, 2, 3].map(i => ({ post_id: `barrier-${i}`, text: 'CHECKIN quán cafe', post_url: `https://example.test/barrier-${i}`, replies: 2 })), {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 3);
    assert.equal(captures, 1); assert.equal((await pipeline.store.jobs(['PAUSED'])).filter(job => job.type === 'ENRICH_CONVERSATION').length, 3);
    await pipeline.ingestRows('threads', [{ post_id: 'barrier-4', text: 'CHECKIN quán cafe', post_url: 'https://example.test/barrier-4', replies: 2 }], {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 3); await pipeline.drain();
    assert.equal(captures, 1); assert.equal(pipeline.progress().counts.unrelated, 0); assert.equal(pipeline.progress().lastError, 'COMMENTS_ACCOUNT_BARRIER_THREADS');
    assert.equal((await pipeline.store.jobs(['PENDING'])).filter(job => job.type === 'ENRICH_CONVERSATION').length, 0);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('query handoff prioritizes its own enrichment jobs then uses remaining bounded slots for older work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-query-test-')), captured: string[] = [];
  const pipeline = await makePipeline(directory, gateway(), { collect: async input => { captured.push(input.root.id); } });
  try {
    await pipeline.ingestRows('threads', Array.from({ length: 9 }, (_, i) => ({ post_id: `older-${i}`, text: '', query: 'older query', replies: 1, post_url: `https://example.test/older-${i}` })), {});
    await pipeline.ingestRows('threads', Array.from({ length: 2 }, (_, i) => ({ post_id: `current-${i}`, text: 'CHECKIN', query: 'current query', replies: 1, post_url: `https://example.test/current-${i}` })), {});
    const queued = (await pipeline.store.jobs(['PENDING'])).filter(job => job.type === 'ENRICH_CONVERSATION');
    assert.equal(queued.filter(job => job.payload.query === 'current query').length, 2);
    await pipeline.enrich('threads', {} as WebContents, () => false, 3, undefined, 'current query');
    assert.equal(captured.length, 3); assert.ok(captured.slice(0, 2).every(root => root.startsWith('current-')));
    assert.ok(captured[2]!.startsWith('older-')); assert.equal((await pipeline.store.jobs(['PENDING'])).filter(job => job.type === 'ENRICH_CONVERSATION').length, 8);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('a retryable comment capture retains its durable retry instead of claiming completion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-capture-retry-test-'));
  const pipeline = await makePipeline(directory, gateway(), { collect: async () => ({ coverage: { status: 'RETRYABLE_ERROR', stop_reason: 'CONVERSATION_NAVIGATION_TIMEOUT' } }) });
  try {
    await pipeline.ingestRows('threads', [{ post_id: 'retry-root', text: 'CHECKIN', replies: 2, post_url: 'https://example.test/retry-root' }], {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 1);
    const job = (await pipeline.store.jobs()).find(item => item.type === 'ENRICH_CONVERSATION');
    assert.equal(job?.state, 'RETRY'); assert.equal(job?.error, 'ENRICHMENT_RETRYABLE_CAPTURE'); assert.equal(job?.attempts, 1);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('bounded final enrichment rotates legacy query buckets without discarding their remaining jobs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-query-test-')), captured: string[] = [];
  const pipeline = await makePipeline(directory, gateway(), { collect: async input => { captured.push(input.root.id); } });
  try {
    for (const query of ['A', 'B', 'C']) for (let index = 0; index < 6; index++) {
      const root = `${query}-${index}`;
      await pipeline.ingest([observation(root, { provenance: { run_id: 'synthetic', method: 'SEARCH', query } })]);
      await pipeline.store.enqueue({ type: 'ENRICH_CONVERSATION', idempotency_key: `legacy-${root}`, payload: { platform: 'threads', root_post_id: root } });
    }
    assert.deepEqual(new Set(await pipeline.store.enrichmentQueries('threads')), new Set(['A', 'B', 'C']));
    await pipeline.enrich('threads', {} as WebContents, () => false, 5);
    assert.equal(captured.length, 5); assert.equal(new Set(captured.slice(0, 3).map(root => root[0])).size, 3);
    for (const query of ['A', 'B', 'C']) assert.ok(captured.filter(root => root.startsWith(query)).length <= 2);
    assert.equal((await pipeline.store.jobs(['PENDING'])).filter(job => job.type === 'ENRICH_CONVERSATION').length, 13);
    assert.equal((await pipeline.store.jobs(['SUCCEEDED'])).filter(job => job.type === 'ENRICH_CONVERSATION').length, 5);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('storage cap stops acquisition across platforms, keeps admitted raw, drains inference and remains pinned on Resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-storage-cap-'));
  const limits = { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: 2 * 1024 * 1024, in_flight_reserve_bytes: 65536 };
  const model = gateway(); let captured = 0;
  let pipeline = await makePipeline(directory, model, { storageLimits: limits, collect: async () => { captured++; } });
  try {
    await pipeline.backpressure(); assert.equal(pipeline.discoveryStopReason('threads'), null);
    writeFileSync(join(directory, 'admitted-raw.bin'), Buffer.alloc(2 * 1024 * 1024));
    await pipeline.ingestRows('threads', [{ post_id: 'storage-post', text: 'Có nơi học đàn nào không?', replies: 2, post_url: 'https://example.test/storage-post' }], {});
    await pipeline.ingest([observation('storage-comment', { entity_type: 'COMMENT', root_post_id: 'storage-post', parent_id: 'storage-post', text: 'Học phí bao nhiêu?' })]);
    await pipeline.backpressure();
    assert.equal(pipeline.discoveryStopReason('threads'), 'STORAGE_RUN_BYTES_REACHED');
    assert.equal(pipeline.discoveryStopReason('facebook'), 'STORAGE_RUN_BYTES_REACHED');
    await pipeline.enrich('threads', {} as WebContents, () => false, 3); assert.equal(captured, 0);
    assert.equal((await pipeline.store.jobs()).find(job => job.type === 'ENRICH_CONVERSATION')?.attempts, 0);
    await pipeline.drain();
    const output = await pipeline.results();
    assert.equal(output.progress.counts.raw, 1); assert.equal(output.progress.counts.comments, 1);
    assert.equal(output.progress.counts.pending, 0); assert.equal(output.storage.stop_reason, 'STORAGE_RUN_BYTES_REACHED');
    assert.ok(output.storage.usage!.run_bytes >= limits.max_run_bytes); assert.equal(await pipeline.startWatching(), false);
    const pin = readFileSync(join(directory, 'opportunity', 'storage-policy.json'), 'utf8');
    output.storage.policy.limits.max_run_bytes = Number.MAX_SAFE_INTEGER;
    assert.equal((await pipeline.results()).storage.policy.limits.max_run_bytes, limits.max_run_bytes);
    await pipeline.close();
    pipeline = await makePipeline(directory, gateway(), { reuseSavedCampaign: true, storageLimits: { ...DEFAULT_STORAGE_LIMITS } });
    await pipeline.backpressure(); assert.equal(pipeline.discoveryStopReason('facebook'), 'STORAGE_RUN_BYTES_REACHED');
    assert.equal(readFileSync(join(directory, 'opportunity', 'storage-policy.json'), 'utf8'), pin);
  } finally { await closeAndRemove(pipeline, directory); }
});

test('byte backlog applies backpressure below the job-count limit and releases after inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-storage-backlog-'));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const model = gateway(async request => { await gate; return modelResult(request); });
  const pipeline = await makePipeline(directory, model, { comments: false, storageLimits: { ...DEFAULT_STORAGE_LIMITS, max_pending_bytes: 1 } });
  let waiting: Promise<void> | null = null;
  try {
    await pipeline.ingest([observation('byte-pressure')]);
    let released = false; waiting = pipeline.backpressure().then(() => { released = true; });
    await until(() => model.calls() === 1); assert.equal(released, false);
    assert.equal(pipeline.discoveryStopReason('threads'), null);
    release(); await waiting;
    assert.equal(released, true); assert.equal((await pipeline.store.backlogBytes(pipeline.context)).total_bytes, 0);
    assert.equal(pipeline.discoveryStopReason('threads'), null);
  } finally { release(); await waiting; await closeAndRemove(pipeline, directory); }
});

test('storage stop during comment capture retains the batch and leaves enrichment resumable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-pipeline-storage-comments-'));
  const pipeline = await makePipeline(directory, gateway(), { storageLimits: { ...DEFAULT_STORAGE_LIMITS, max_run_bytes: 2 * 1024 * 1024, in_flight_reserve_bytes: 65536 },
    collect: async input => {
      await input.onObservations([observation('cap-comment', { entity_type: 'COMMENT', root_post_id: input.root.id, parent_id: input.root.id })]);
      writeFileSync(join(directory, 'comment-raw.bin'), Buffer.alloc(2 * 1024 * 1024));
      await input.beforeNextPage!(); throw Error('UNEXPECTED_NEXT_PAGE');
    } });
  try {
    await pipeline.ingestRows('threads', [{ post_id: 'root', text: 'CHECKIN', replies: 2, post_url: 'https://example.test/root' }], {});
    await pipeline.enrich('threads', {} as WebContents, () => false, 2);
    assert.equal((await pipeline.store.snapshot('threads', 'root'))?.comments.length, 1);
    const job = (await pipeline.store.jobs()).find(item => item.type === 'ENRICH_CONVERSATION');
    assert.equal(job?.state, 'RETRY'); assert.equal(job?.error, 'STORAGE_RUN_BYTES_REACHED'); assert.equal(job?.attempts, 1);
    assert.equal(pipeline.discoveryStopReason('threads'), 'STORAGE_RUN_BYTES_REACHED');
  } finally { await closeAndRemove(pipeline, directory); }
});
