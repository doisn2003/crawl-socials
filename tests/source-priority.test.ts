import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourcePriorityScores } from '../src/domain/source-priority.js';
import { contentHash, type ConversationObservation, type ConversationSnapshot, type SourceKind } from '../src/domain/conversation.js';
import type { ConversationDecisionInput } from '../src/domain/conversation-decision.js';
import { campaignFromModel } from '../src/application/compile-campaign.js';
import { opportunityRank } from '../src/application/classification-service.js';
import { pinRankingRecipe } from '../src/application/ranking-recipe-pin.js';
import { createConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import { createOpportunityPipeline, type OpportunityPipeline } from '../src/application/opportunity-pipeline.js';
import { atomicJson } from '../src/infrastructure/config/user-config.js';
import type { ModelGateway } from '../src/application/ports/model-gateway.js';

function campaign() {
  return campaignFromModel({ campaign_id: 'source-priority-test', prompt: 'Tìm đàn piano', source_priority: ['GROUP', 'PAGE'], seed_queries: ['đàn piano'] },
    { topic: 'đàn piano', audience: [], needs: [], participation_intents: [], research_intents: [], inclusions: [], exclusions: [], assumptions: [],
      queries: [{ text: 'đàn piano', family: 'BROAD' }] });
}
function observation(id: string, kind: SourceKind): ConversationObservation {
  return { platform: 'threads', entity_type: 'POST', entity_id: id, root_post_id: id, parent_id: null,
    text: 'Xin kinh nghiệm chọn đàn piano cho người mới học?', source: { kind }, observed_at: '2026-10-31T00:00:00Z',
    provenance: { run_id: 'source-priority-test', method: 'TEST_FIXTURE' } };
}
function context(plan = campaign()) { return { campaign_id: plan.campaign_id, campaign_version: plan.version, filter_version: plan.filter_version }; }
function decision(snapshot: ConversationSnapshot, ctx = context(), changes: Partial<ConversationDecisionInput> = {}): ConversationDecisionInput {
  return { ...ctx, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED', reason_code: 'EXPLICIT_NEED',
    evidence_ids: [snapshot.spans[0]!.id], model: 'synthetic', attributes: { observed_need: 'REQUEST', brand_fit: 'TOPIC_ONLY', participation_context: 'OPEN', freshness: 'CURRENT' }, ...changes };
}
const temp = () => mkdtempSync(join(tmpdir(), 'csd-source-priority-'));
function compare(a: number[], b: number[]) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!; return 0; }

test('source preferences are bounded soft ties; legacy and partial-order semantics remain explicit', () => {
  assert.deepEqual(sourcePriorityScores(), { PROFILE: 3, GROUP: 2, PAGE: 1, UNKNOWN: 1 });
  assert.deepEqual(sourcePriorityScores(['GROUP', 'PAGE']), { PROFILE: 0, GROUP: 2, PAGE: 1, UNKNOWN: 0 });
  for (const invalid of [[], ['GROUP', 'GROUP'], ['INVENTED'], ['PAGE', "'); DROP TABLE snapshots;--"]]) {
    assert.throws(() => sourcePriorityScores(invalid as SourceKind[]), /SOURCE_PRIORITY_INVALID/);
  }
});

test('configured SQL source order agrees with JS before pagination; semantic evidence outranks preferred sources', () => {
  const directory = temp(), store = createConversationStore(directory), plan = campaign(), ctx = context(plan), source_priority: SourceKind[] = ['GROUP', 'PAGE'];
  try {
    const strong = store.ingest(observation('strong-profile', 'PROFILE'), ctx).snapshot!;
    store.recordDecision(decision(strong, ctx, { attributes: { ...decision(strong, ctx).attributes, brand_fit: 'ALIGNED' } }));
    for (const [id, kind] of [['older-group', 'GROUP'], ['older-page', 'PAGE'], ['unknown', 'UNKNOWN']] as const) {
      const snapshot = store.ingest(observation(id, kind), ctx).snapshot!; store.recordDecision(decision(snapshot, ctx));
    }
    for (let index = 0; index < 45; index++) {
      const snapshot = store.ingest(observation(`newer-profile-${index}`, 'PROFILE'), ctx).snapshot!; store.recordDecision(decision(snapshot, ctx));
    }
    const latestGroup = store.ingest(observation('preferred-but-no-opening', 'GROUP'), ctx).snapshot!;
    store.recordDecision(decision(latestGroup, ctx, { classification: 'NOT_YET', reason_code: 'RELATED_CHECKIN' }));
    const options = { ranked: true, source_priority };
    const ranked = store.results(ctx, options), expected = store.results(ctx).sort((a, b) => compare(opportunityRank(a.decision, a.snapshot, source_priority), opportunityRank(b.decision, b.snapshot, source_priority)));
    assert.deepEqual(ranked.map(row => row.snapshot.root_post_id), expected.map(row => row.snapshot.root_post_id));
    assert.deepEqual(store.results(ctx, { ...options, limit: 3 }).map(row => row.snapshot.root_post_id), ['strong-profile', 'older-group', 'older-page']);
    assert.equal(ranked.length, 50); assert.equal(ranked.at(-1)!.snapshot.root_post_id, 'preferred-but-no-opening');
    assert.deepEqual(store.exportSnapshot(ctx, { source_priority }).conversations.map(row => row.snapshot.id), ranked.map(row => row.snapshot.id));
    assert.equal(store.results(ctx, { ranked: true, limit: 2 })[1]!.snapshot.root_post_id, 'newer-profile-44');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('ranking policy freezes campaign order, rejects tampering and preserves old runs without changing their campaign', () => {
  const directory = temp(), plan = campaign();
  try {
    const pin = pinRankingRecipe({ directory, campaign: plan, campaignExisted: false }), path = join(directory, 'ranking-recipe.json');
    assert.equal(pin.recipe.policy, 'campaign-source-priority-v1'); assert.deepEqual(pin.recipe.source_priority, plan.source_priority);
    const bytes = readFileSync(path, 'utf8');
    assert.deepEqual(pinRankingRecipe({ directory, campaign: plan, campaignExisted: true }), pin);
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.throws(() => pinRankingRecipe({ directory, campaign: { ...plan, source_priority: ['PAGE'] }, campaignExisted: true }), /RANKING_SOURCE_PRIORITY_MISMATCH/);
    writeFileSync(path, JSON.stringify({ ...pin, recipe_sha256: '0'.repeat(64) }));
    assert.throws(() => pinRankingRecipe({ directory, campaign: plan, campaignExisted: true }), /RANKING_RECIPE_PIN_INVALID/);
    const oldDirectory = join(directory, 'old'), before = contentHash(plan);
    const legacy = pinRankingRecipe({ directory: oldDirectory, campaign: plan, campaignExisted: true });
    assert.deepEqual(legacy.recipe, { schema_version: 1, policy: 'legacy-source-priority-v1', source_priority: null });
    assert.equal(contentHash(plan), before);
    assert.deepEqual(pinRankingRecipe({ directory: oldDirectory, campaign: plan, campaignExisted: false }), legacy);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('pipeline preview and frozen exports share pinned source order across Resume; old runs keep legacy order', async () => {
  for (const legacy of [false, true]) {
    const directory = temp(), opportunity = join(directory, 'opportunity'), plan = campaign(), ctx = context(plan);
    let pipeline: OpportunityPipeline | null = null, modelCalls = 0;
    const gateway: ModelGateway = { generateJson: async () => { modelCalls++; throw Error('UNEXPECTED_MODEL'); },
      summary: () => ({ model: 'synthetic', budget_usd: 3, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0, remaining_usd: 3,
        billable_attempts: 0, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }) };
    try {
      const store = createConversationStore(join(opportunity, 'store'));
      for (const kind of ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'] as const) {
        const snapshot = store.ingest(observation(kind, kind), ctx).snapshot!; store.recordDecision(decision(snapshot, ctx));
      }
      for (let job = store.claim('fixture', { context: ctx }); job; job = store.claim('fixture', { context: ctx })) store.complete(job.id, job.lease_token!);
      store.close();
      if (legacy) atomicJson(join(opportunity, 'campaign.json'), plan);
      const input = { directory, runId: plan.campaign_id, campaign: plan, gateway, platforms: ['threads', 'facebook'] as Array<'threads' | 'facebook'>,
        config: { enabled: true, prompt: plan.prompt, brandContext: '', totalTarget: 1000, threadsShare: 0.8 as const, rawCap: 3000, budgetUsd: 3, commentsEnabled: false },
        collectConversation: async () => { throw Error('UNEXPECTED_BROWSER'); } };
      const expected = legacy ? ['PROFILE', 'GROUP', 'UNKNOWN', 'PAGE'] : ['GROUP', 'PAGE', 'UNKNOWN', 'PROFILE'];
      pipeline = await createOpportunityPipeline(input);
      assert.deepEqual(pipeline.progress().preview.map(row => row.rootId), expected);
      const first = await pipeline.results(); assert.deepEqual(first.conversations.map(row => row.snapshot.root_post_id), expected);
      assert.equal(first.ranking.recipe.policy, legacy ? 'legacy-source-priority-v1' : 'campaign-source-priority-v1');
      if (first.ranking.recipe.source_priority) first.ranking.recipe.source_priority.reverse();
      assert.deepEqual((await pipeline.results()).conversations.map(row => row.snapshot.root_post_id), expected, 'export callers cannot mutate the pinned runtime order');
      const before = readFileSync(join(opportunity, 'ranking-recipe.json'), 'utf8');
      await pipeline.close(); pipeline = await createOpportunityPipeline(input);
      assert.deepEqual((await pipeline.results()).conversations.map(row => row.snapshot.root_post_id), expected);
      assert.equal(readFileSync(join(opportunity, 'ranking-recipe.json'), 'utf8'), before); assert.equal(modelCalls, 0);
    } finally { await pipeline?.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});
