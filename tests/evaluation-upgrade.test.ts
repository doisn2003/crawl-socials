import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import type { AsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { campaignFromModel } from '../src/application/compile-campaign.js';
import { classifierRecipe } from '../src/application/classification-service.js';
import { prepareCombinedEvaluationUpgrade, readActiveEvaluation, resumeEvaluationMigration, evaluationContext } from '../src/application/evaluation-upgrade.js';
import { enqueueFocusedVerification, processFocusedVerificationBatch, focusedVerificationDecision } from '../src/application/focused-verification-backfill.js';
import { FOCUSED_VERIFIER_VERSION, FOCUSED_VERIFIER_PROMPT_SHA256 } from '../src/application/opportunity-verifier-v2.js';
import { contentHash } from '../src/domain/conversation.js';
import type { ConversationObservation, ConversationSnapshot } from '../src/domain/conversation.js';
import type { ConversationDecisionInput } from '../src/domain/conversation-decision.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import type { ModelGateway, JsonModelResult } from '../src/application/ports/model-gateway.js';

function asyncFacade(store: ConversationStore): AsyncConversationStore {
  return new Proxy({}, { get: (_target, key) => async (...args: unknown[]) => {
    const method = store[key as keyof ConversationStore] as (...values: unknown[]) => unknown;
    return method.apply(store, args);
  } }) as AsyncConversationStore;
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'csd-evaluation-upgrade-'));
  const campaign = campaignFromModel({ campaign_id: 'upgrade-test', prompt: 'Tìm quán cafe', seed_queries: ['cafe yên tĩnh'], suitable_target: 10, raw_cap: 30, model_usd: 3 },
    { topic: 'cafe', audience: [], needs: ['tìm quán'], participation_intents: [], research_intents: [], inclusions: [], exclusions: [], assumptions: [], queries: [{ text: 'cafe yên tĩnh', family: 'REQUEST' }] }, '2026-10-30T00:00:00Z');
  const context = evaluationContext(campaign), store = new ConversationStore(join(directory, 'store'));
  writeFileSync(join(directory, 'campaign.json'), JSON.stringify(campaign));
  writeFileSync(join(directory, 'filter-recipe.json'), JSON.stringify({ recipe: classifierRecipe(), recipe_sha256: contentHash(classifierRecipe()) }));
  for (const model of ['model', 'model-gemini-3.5-flash-lite']) { mkdirSync(join(directory, model)); writeFileSync(join(directory, model, 'model-ledger.jsonl'), 'UNCHANGED_TEST_LEDGER\n'); }
  const observe = (id: string, text = 'Xin quán cafe yên tĩnh', at = '2026-10-30T10:00:00Z'): ConversationObservation => ({ platform: 'threads', entity_type: 'POST', entity_id: id,
    root_post_id: id, parent_id: null, text, observed_at: at, published_at: '2026-10-30T09:00:00Z', provenance: { method: 'TEST', run_id: 'test' } });
  const snapshots: ConversationSnapshot[] = [];
  for (const [id, classification] of [['s', 'SUITABLE'], ['n', 'NOT_YET'], ['u', 'UNRELATED'], ['p', null]] as const) {
    store.ingest(observe(id), context); const snapshot = store.snapshot('threads', id)!; snapshots.push(snapshot);
    store.recordDecision({ ...context, snapshot_id: snapshot.id, classification, assessment_status: classification ? 'ASSESSED' : 'PENDING',
      reason_code: classification ? 'PRIMARY_RESULT' : 'MISSING_CONTEXT', model: 'primary-model', evidence_ids: classification ? [snapshot.spans[0]!.id] : [],
      action_target: classification === 'SUITABLE' ? { entity_id: id, type: 'POST' } : null });
  }
  return { directory, campaign, context, store, facade: asyncFacade(store), snapshots, observe,
    close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function gateway(verdict: 'KEEP' | 'DOWNGRADE_NOT_YET' = 'KEEP', fail = false): ModelGateway & { calls: number } {
  const g = { calls: 0, async generateJson(request: Parameters<ModelGateway['generateJson']>[0]): Promise<JsonModelResult> {
    g.calls++; if (fail) throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED');
    const input = request.input as { conversations: Array<{ snapshot_id: string; spans: Array<{ id: string }> }> };
    return { value: input.conversations.map(s => ({ snapshot_id: s.snapshot_id, verdict,
      reason: verdict === 'KEEP' ? 'PRESERVE_CONSUMER_OPENING' : 'EMPLOYMENT_CONTEXT', evidence_ids: [s.spans[0]!.id], explanation: 'Synthetic audit', expiry: null })),
      invocation_id: 'test-audit', request_hash: 'test', model: 'audit-model', model_version: null, usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, thinking_tokens: 0 },
      cost_usd: 0.001, unmetered_cost_upper_usd: 0, cache_hit: false, elapsed_ms: 1,
      price: { input_per_million: 0.3, output_per_million: 2.5, cached_input_per_million: 0.03, observed_at: '2026-10-30', source: 'SYNTHETIC' } };
  }, summary() { return { model: 'audit-model', budget_usd: 3, measured_cost_usd: 1.5 + g.calls * 0.001, unmetered_cost_upper_usd: 0.04,
    reserved_usd: 0, remaining_usd: 1.46 - g.calls * 0.001, billable_attempts: 400 + g.calls, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' as const }; } };
  return g;
}

test('upgrade preserves baseline files/history/cost ledgers and only copies current negative decisions as assessed', async () => {
  const f = fixture(); try {
    const before = readFileSync(join(f.directory, 'campaign.json'), 'utf8'), recipe = readFileSync(join(f.directory, 'filter-recipe.json'), 'utf8');
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    assert.equal(active.state, 'READY_FOR_VERIFICATION'); assert.notDeepEqual(active.context, f.context);
    assert.equal(f.store.stats(f.context).suitable, 1); assert.equal(f.store.decisionHistory(f.context).length, 4);
    const stats = f.store.stats(active.context); assert.equal(stats.suitable, 0); assert.equal(stats.pending, 2); assert.equal(stats.not_yet, 1); assert.equal(stats.unrelated, 1);
    assert.equal(f.store.jobs(undefined, active.context).filter(j => j.type === 'VERIFY').length, 1);
    assert.equal(f.store.jobs(undefined, active.context).filter(j => j.type === 'CLASSIFY').length, 1);
    assert.equal(readFileSync(join(f.directory, 'campaign.json'), 'utf8'), before); assert.equal(readFileSync(join(f.directory, 'filter-recipe.json'), 'utf8'), recipe);
    for (const model of ['model', 'model-gemini-3.5-flash-lite']) assert.equal(readFileSync(join(f.directory, model, 'model-ledger.jsonl'), 'utf8'), 'UNCHANGED_TEST_LEDGER\n');
    assert.ok(f.store.results(active.context).find(r => r.decision.classification === 'NOT_YET')!.decision.attributes?.source_decision_id);
  } finally { f.close(); }
});
test('interrupted migration selects fail-closed context and resumes without replacing verified results or duplicating jobs', async () => {
  const f = fixture(); try {
    let failed = false;
    const crashing = new Proxy(f.facade, { get(target, key) { if (key !== 'recordDecision') return Reflect.get(target, key);
      return async (input: ConversationDecisionInput) => { const result = await target.recordDecision(input); if (!failed) { failed = true; throw Error('SIMULATED_CRASH'); } return result; }; } });
    await assert.rejects(prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: crashing, reason: 'TEST_APPROVED_UPGRADE' }), /SIMULATED_CRASH/);
    const pending = readActiveEvaluation(f.directory, f.campaign)!; assert.equal(pending.state, 'MIGRATING'); assert.equal(f.store.stats(pending.context).suitable, 0);
    await resumeEvaluationMigration(f.directory, f.facade); const active = readActiveEvaluation(f.directory)!;
    const g = gateway(); await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: g });
    assert.equal(g.calls, 1); assert.equal(f.store.stats(active.context).suitable, 1); assert.equal(f.store.stats(f.context).suitable, 1);
    const historyCount = f.store.decisionHistory(active.context).length;
    await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    assert.equal(f.store.decisionHistory(active.context).length, historyCount);
    assert.equal(f.store.jobs(undefined, active.context).filter(j => j.type === 'VERIFY').length, 1);
    assert.equal(g.summary().measured_cost_usd, 1.501);
  } finally { f.close(); }
});
test('new snapshot supersedes a verification job without API and retains one fresh classification job', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    f.store.ingest(f.observe('s', 'Có thêm câu hỏi mới', '2026-10-30T11:00:00Z'), active.context);
    const g = gateway(), result = await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: g });
    assert.equal(result.stale, 1); assert.equal(g.calls, 0); assert.equal(f.store.stats(active.context).suitable, 0);
    const freshId = f.store.snapshot('threads', 's')!.id;
    assert.equal(f.store.jobs(undefined, active.context).filter(j => j.type === 'CLASSIFY' && j.payload.snapshot_id === freshId).length, 1);
  } finally { f.close(); }
});
test('verification failures remain pending in new context and never expose baseline positives', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    const result = await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: gateway('KEEP', true) });
    assert.equal(result.failures[0]!.code, 'MODEL_BUDGET_EXHAUSTED'); assert.equal(f.store.stats(active.context).suitable, 0); assert.equal(f.store.stats(f.context).suitable, 1);
    assert.equal(f.store.jobs(undefined, active.context).find(j => j.type === 'VERIFY')!.state, 'RETRY');
    assert.equal(f.store.results(active.context).find(r => r.snapshot.root_post_id === 's')!.decision.classification, null);
  } finally { f.close(); }
});
test('audited downgrade changes only composed context and retains audit/source evidence history', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: gateway('DOWNGRADE_NOT_YET') });
    const decision = f.store.results(active.context).find(r => r.snapshot.root_post_id === 's')!.decision;
    assert.equal(decision.classification, 'NOT_YET'); assert.equal(decision.attributes?.primary_model, 'primary-model');
    assert.equal(JSON.parse(String(decision.attributes?.focused_audit_json)).verdict, 'DOWNGRADE_NOT_YET');
    assert.equal(f.store.stats(f.context).suitable, 1); assert.ok(decision.attributes?.source_decision_id);
  } finally { f.close(); }
});
test('new discovery suitability stays pending until the durable verifier completes', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    f.store.ingest(f.observe('fresh'), active.context); const snapshot = f.store.snapshot('threads', 'fresh')!;
    const proposal: ConversationDecisionInput = { ...active.context, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED',
      reason_code: 'PRIMARY_RESULT', evidence_ids: [snapshot.spans[0]!.id], action_target: { entity_id: 'fresh', type: 'POST' }, model: 'primary-model' };
    await enqueueFocusedVerification(f.facade, active.campaign, snapshot, proposal);
    assert.equal(f.store.stats(active.context).suitable, 0);
    await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: gateway() });
    assert.equal(f.store.stats(active.context).suitable, 2);
  } finally { f.close(); }
});
test('active policy tampering fails closed rather than silently falling back to baseline', async () => {
  const f = fixture(); try {
    await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    const file = join(f.directory, 'active-evaluation.json'), pointer = JSON.parse(readFileSync(file, 'utf8')); pointer.recipe_sha256 = 'bad'; writeFileSync(file, JSON.stringify(pointer));
    assert.throws(() => readActiveEvaluation(f.directory), /ACTIVE_EVALUATION_POLICY_MISMATCH/); assert.equal(f.store.stats(f.context).suitable, 1);
  } finally { f.close(); }
});
test('crash after an audited decision but before job completion resumes without charging another model call', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    const crashing = new Proxy(f.facade, { get(target, key) { return key === 'complete' ? async () => { throw Error('SIMULATED_ACK_CRASH'); } : Reflect.get(target, key); } });
    const g = gateway();
    await assert.rejects(processFocusedVerificationBatch({ store: crashing, campaign: active.campaign, gateway: g }), /SIMULATED_ACK_CRASH/);
    assert.equal(f.store.stats(active.context).suitable, 1); assert.equal(g.calls, 1);
    f.store.pause({ context: active.context }); f.store.resume({ context: active.context });
    const resumed = await processFocusedVerificationBatch({ store: f.facade, campaign: active.campaign, gateway: g });
    assert.equal(resumed.already_completed, 1); assert.equal(g.calls, 1);
    assert.equal(f.store.jobs(undefined, active.context).find(j => j.type === 'VERIFY')!.state, 'SUCCEEDED');
  } finally { f.close(); }
});
test('a stale baseline negative is reclassified rather than copied to new evidence', async () => {
  const f = fixture(); try {
    f.store.ingest(f.observe('n', 'New consumer question changes the post', '2026-10-30T12:00:00Z'), f.context);
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    const decision = f.store.results(active.context).find(r => r.snapshot.root_post_id === 'n')!.decision;
    assert.equal(decision.assessment_status, 'PENDING'); assert.equal(decision.classification, null);
    assert.equal(f.store.jobs(undefined, active.context).filter(j => j.type === 'CLASSIFY' && j.payload.root_post_id === 'n').length, 1);
  } finally { f.close(); }
});
test('KEEP preserves the consumer comment action target when audit evidence describes the promotional parent', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    f.store.ingest({ ...f.observe('s'), entity_type: 'COMMENT', entity_id: 'consumer-question', parent_id: 's', text: 'Có chỗ yên tĩnh không?', observed_at: '2026-10-30T12:00:00Z' }, active.context);
    const snapshot = f.store.snapshot('threads', 's')!, commentSpan = snapshot.spans.find(s => s.entity_id === 'consumer-question')!;
    const proposal: ConversationDecisionInput = { ...active.context, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED',
      reason_code: 'CONSUMER_COMMENT', evidence_ids: [commentSpan.id], action_target: { entity_id: 'consumer-question', type: 'COMMENT' }, model: 'primary' };
    const decision = focusedVerificationDecision(active.campaign, snapshot, proposal, { snapshot_id: snapshot.id, verdict: 'KEEP', reason: 'PRESERVE_CONSUMER_OPENING',
      evidence_ids: [snapshot.spans.find(s => s.entity_id === 's')!.id], explanation: 'Provider parent does not negate consumer question', expiry: null,
      version: FOCUSED_VERIFIER_VERSION, prompt_sha256: FOCUSED_VERIFIER_PROMPT_SHA256, model: 'audit', invocation_id: 'audit-1' });
    assert.deepEqual(decision.action_target, proposal.action_target); assert.ok(decision.evidence_ids.includes(commentSpan.id));
  } finally { f.close(); }
});
test('an interrupted immutable-file staging write recovers from the frozen preparation without changing the campaign', async () => {
  const f = fixture(); try {
    const active = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    const original = readFileSync(join(active.directory, 'campaign.json'), 'utf8');
    unlinkSync(join(f.directory, 'active-evaluation.json'));
    for (const file of ['manifest.json', 'campaign.json', 'filter-recipe.json', 'migration-plan.json']) unlinkSync(join(active.directory, file));
    writeFileSync(join(active.directory, 'campaign.json.next'), '{TRUNCATED');
    const resumed = await prepareCombinedEvaluationUpgrade({ directory: f.directory, baselineCampaign: f.campaign, store: f.facade, reason: 'TEST_APPROVED_UPGRADE' });
    assert.equal(readFileSync(join(resumed.directory, 'campaign.json'), 'utf8'), original); assert.deepEqual(resumed.context, active.context);
  } finally { f.close(); }
});
