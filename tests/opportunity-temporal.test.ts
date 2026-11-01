import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createOpportunityPipeline, type OpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { campaignFromModel } from '../src/application/compile-campaign.js';
import { classifierRecipe } from '../src/application/classification-service.js';
import { TEMPORAL_OPPORTUNITY_FILTER_VERSION } from '../src/domain/campaign-plan.js';
import { contentHash, type ConversationObservation } from '../src/domain/conversation.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import type { AsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { ModelGatewayError, type JsonModelRequest, type JsonModelResult, type ModelGateway } from '../src/application/ports/model-gateway.js';

const at = '2026-10-30T10:00:00.000Z', deadline = '2026-10-30T10:00:00.100Z';
const price = { input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, observed_at: at, source: 'TEST' };
type Row = { snapshot_id: string; as_of: string; post: { entity_id: string; published_at: string }; spans: Array<{ id: string; entity_id: string; text: string }> };
function model(handler?: (request: JsonModelRequest, calls: number) => Promise<JsonModelResult>) {
  const requests: JsonModelRequest[] = [];
  const reply = (request: JsonModelRequest): JsonModelResult => ({ value: (request.input as { conversations: Row[] }).conversations.map(row => {
    const expired = Date.parse(row.as_of) >= Date.parse(deadline), span = row.spans[0]!;
    return { snapshot_id: row.snapshot_id, case_code: expired ? 'RELATED_EXPIRED' : 'OPPORTUNITY_REQUEST',
      evidence_ids: [span.id], action_entity_id: expired ? '' : span.entity_id, need_summary: 'A time-bounded travel request', intents: ['find_hotel'],
      topic_fit: 'RELATED', observed_need: 'REQUEST', speaker_role: 'CONSUMER', brand_fit: 'TOPIC_ONLY', participation_context: expired ? 'CLOSED' : 'OPEN', freshness: 'CURRENT',
      temporal_status: expired ? 'EXPIRED_WINDOW' : 'CURRENT_WINDOW', valid_until: expired ? null : deadline,
      temporal_evidence: [{ entity_id: row.post.entity_id, evidence_id: span.id, quote: 'before the deadline', published_at: row.post.published_at, expires_at: deadline }] };
  }), invocation_id: 'synthetic', request_hash: contentHash(request.input), model: 'synthetic', model_version: null,
  usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, thinking_tokens: 0 }, cost_usd: 0, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 0, price });
  const gateway: ModelGateway = { async generateJson(request) { requests.push(request); return handler ? handler(request, requests.length) : reply(request); },
    summary: () => ({ model: 'synthetic', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0, remaining_usd: 3,
      billable_attempts: requests.length, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }) };
  return { gateway, requests, reply };
}
function plan(target = 1) {
  return campaignFromModel({ campaign_id: 'temporal-travel', prompt: 'Find hotel advice', seed_queries: ['hotel advice'], suitable_target: target,
    filter_version: TEMPORAL_OPPORTUNITY_FILTER_VERSION, desired_platform_weights: { threads: 0.8, facebook: 0.2 } }, {
    topic: 'hotels', audience: ['travellers'], needs: ['hotel recommendations'], participation_intents: ['accommodation advice'], research_intents: ['hotel amenities'],
    inclusions: ['hotels'], exclusions: [], assumptions: [], queries: [{ text: 'hotel advice', family: 'REQUEST' }] }, at);
}
const observation = (id = 'trip'): ConversationObservation => ({ platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id,
  parent_id: null, text: 'I need hotel advice before the deadline.', published_at: at, observed_at: at, provenance: { run_id: 'test', method: 'FIXTURE' } });
function clockStore(directory: string, now: () => Date): AsyncConversationStore {
  const store = createConversationStore(join(directory, 'opportunity', 'store'), { now });
  return new Proxy({}, { get(_target, property) {
    if (property === 'then' || typeof property !== 'string') return undefined;
    return async (...args: unknown[]) => (store[property as keyof typeof store] as (...values: unknown[]) => unknown).apply(store, args);
  } }) as AsyncConversationStore;
}
async function pipeline(directory: string, gateway: ModelGateway, now: () => Date, resume = false) {
  return createOpportunityPipeline({ directory, runId: 'test', config: { enabled: true, prompt: 'Find hotel advice', brandContext: '', totalTarget: 1,
    threadsShare: 0.8, rawCap: 3000, budgetUsd: 3, commentsEnabled: false }, platforms: ['threads'], ...(resume ? {} : { campaign: plan() }),
    gateway, now, store: clockStore(directory, now), collectConversation: async () => { throw Error('BROWSER_MUST_NOT_OPEN_FOR_TIME_ONLY_REFRESH'); } });
}
async function until(check: () => boolean) { const end = Date.now() + 5000; while (!check()) { if (Date.now() >= end) throw Error('TEST_WAIT_TIMED_OUT'); await sleep(10); } }

test('opt-in temporal policy freezes request time and refreshes unchanged suitable content without comments or a browser', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-time-pipeline-')); let clock = at;
  const gateway = model(), p = await pipeline(directory, gateway.gateway, () => new Date(clock));
  try {
    await p.ingest([observation()]); await p.drain();
    assert.equal(gateway.requests.length, 1); assert.equal(p.progress().counts.suitable, 1);
    const snapshot = await p.store.snapshot('threads', 'trip'), original = await p.store.decisionHistory(p.context);
    assert.equal(original[0]!.evaluated_at, at); assert.equal(await p.startWatching(), true);
    assert.equal(p.progress().watchActive, false); assert.equal(p.progress().assessmentActive, true);
    const saved = JSON.parse(readFileSync(join(directory, 'opportunity', 'filter-recipe.json'), 'utf8'));
    assert.equal(saved.recipe_sha256, contentHash(classifierRecipe(TEMPORAL_OPPORTUNITY_FILTER_VERSION)));
    clock = deadline;
    await until(() => p.progress().counts.notYet === 1 && !p.isWatching());
    assert.equal(gateway.requests.length, 2); assert.equal(p.progress().counts.suitable, 0); assert.equal(p.progress().counts.raw, 1);
    assert.equal((await p.store.snapshot('threads', 'trip'))!.id, snapshot!.id);
    assert.deepEqual((await p.store.decisionHistory(p.context)).map(d => d.evaluated_at), [at, deadline]);
    assert.equal((gateway.requests[1]!.input as { conversations: Row[] }).conversations[0]!.as_of, deadline);
    assert.equal((await p.results()).snapshots.length, 1);
  } finally { await p.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Stop cancels expiry timers; explicit Resume requests overdue assessment using the same immutable recipe', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-time-pipeline-')); let clock = at, resumed: OpportunityPipeline | undefined;
  const gateway = model(), first = await pipeline(directory, gateway.gateway, () => new Date(clock));
  try {
    await first.ingest([observation()]); await first.drain(); await first.startWatching();
    const recipe = readFileSync(join(directory, 'opportunity', 'filter-recipe.json'), 'utf8');
    await first.stop(); clock = deadline; await sleep(150);
    assert.equal(gateway.requests.length, 1); assert.equal(first.progress().assessmentActive, false);
    await first.close(); resumed = await pipeline(directory, gateway.gateway, () => new Date(clock), true);
    assert.equal(gateway.requests.length, 1, 'factory does not synchronously invoke the model');
    await resumed.drain(); assert.equal(resumed.progress().counts.notYet, 1); assert.equal(gateway.requests.length, 2);
    assert.equal(readFileSync(join(directory, 'opportunity', 'filter-recipe.json'), 'utf8'), recipe);
    assert.equal((await resumed.store.jobs()).filter(job => job.payload.evaluated_at === deadline).length, 1);
  } finally { await resumed?.close(); await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a paused model still drops expired suitable counts without enqueuing or spending on a refresh', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-time-pipeline-')); let clock = at;
  const normal = model(), limited = model(async (request, call) => { if (call > 1) throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED'); return normal.reply(request); });
  const p = await pipeline(directory, limited.gateway, () => new Date(clock));
  try {
    await p.ingest([observation()]); await p.drain(); assert.equal(p.progress().counts.suitable, 1);
    await p.ingest([observation('second')]); await p.drain();
    assert.equal(p.progress().phase, 'MODEL_PAUSED'); assert.equal(limited.requests.length, 2);
    assert.equal(await p.startWatching(), true, 'read-only expiry monitoring survives budget pause');
    clock = deadline; await until(() => p.progress().counts.suitable === 0 && !p.isWatching()); await sleep(120);
    assert.equal(limited.requests.length, 2); assert.equal(p.progress().counts.pending, 2); assert.equal(p.progress().phase, 'MODEL_PAUSED');
    assert.equal((await p.store.jobs()).filter(job => job.payload.evaluated_at === deadline).length, 0);
  } finally { await p.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed temporal refresh exhausts one durable job without repeatedly creating new time keys', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-time-pipeline-')); let clock = at;
  const normal = model(), broken = model(async (request, call) => call === 1 ? normal.reply(request) : { ...normal.reply(request), value: [] });
  const p = await pipeline(directory, broken.gateway, () => new Date(clock));
  try {
    await p.ingest([observation()]); await p.drain(); await p.startWatching(); clock = deadline;
    await until(() => broken.requests.length >= 3 && !p.isWatching());
    const attempts = broken.requests.length; await sleep(180); assert.equal(broken.requests.length, attempts);
    assert.equal((await p.store.jobs()).filter(job => job.payload.evaluated_at === deadline).length, 1);
    assert.equal((await p.store.assessmentsDue(p.context)).length, 0); assert.equal(p.progress().counts.pending, 1);
  } finally { await p.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an odd total uses integer platform allocation and a zero-share target does not require another root', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-time-target-')); const gateway = model();
  const p = await createOpportunityPipeline({ directory, runId: 'test', config: { enabled: true, prompt: 'Find hotel advice', brandContext: '', totalTarget: 1,
    threadsShare: 0.8, rawCap: 3000, budgetUsd: 3, commentsEnabled: false }, platforms: ['threads', 'facebook'], campaign: plan(), gateway: gateway.gateway,
    now: () => new Date(at), store: clockStore(directory, () => new Date(at)), collectConversation: async () => undefined });
  try {
    assert.equal(p.discoveryStopReason('facebook'), 'INTENT_TARGET_REACHED');
    await p.ingest([observation()]); await p.drain(); assert.equal(p.targetReached(), true);
    assert.equal(p.progress().counts.suitable, 1); assert.equal(p.discoveryStopReason('threads'), 'INTENT_TARGET_REACHED');
  } finally { await p.close(); rmSync(directory, { recursive: true, force: true }); }
});
