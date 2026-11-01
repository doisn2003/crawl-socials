import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductionService } from '../src/application/production-service.js';
import { campaignFromModel } from '../src/application/compile-campaign.js';
import { classifierRecipe } from '../src/application/classification-service.js';
import { prepareCombinedEvaluationUpgrade, evaluationContext } from '../src/application/evaluation-upgrade.js';
import { ConversationStore } from '../src/infrastructure/storage/conversation-store.js';
import type { AsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { contentHash } from '../src/domain/conversation.js';
import type { OpportunityProgress } from '../src/shared/production-api.js';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'csd-active-cache-')), id = 'crawl-00000000-0000-4000-8000-000000000001';
  const output = join(directory, 'collections', id), opportunity = join(output, 'opportunity'); mkdirSync(opportunity, { recursive: true });
  const campaign = campaignFromModel({ campaign_id: 'piano-test', prompt: 'Tìm lớp học piano', seed_queries: ['học piano'], suitable_target: 10, raw_cap: 30, model_usd: 3 },
    { topic: 'lớp học piano', audience: [], needs: ['tìm lớp học'], participation_intents: [], research_intents: [], inclusions: [], exclusions: [], assumptions: [], queries: [{ text: 'học piano', family: 'REQUEST' }] }, '2026-10-30T00:00:00Z');
  const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value));
  write(join(opportunity, 'campaign.json'), campaign); write(join(opportunity, 'filter-recipe.json'), { recipe: classifierRecipe(), recipe_sha256: contentHash(classifierRecipe()) });
  const context = evaluationContext(campaign), store = new ConversationStore(join(opportunity, 'store'));
  store.ingest({ platform: 'threads', entity_type: 'POST', entity_id: '1', root_post_id: '1', parent_id: null, text: 'Xin lớp piano cho người mới', observed_at: '2026-10-30T10:00:00Z', provenance: { method: 'TEST', run_id: 'test' } }, context);
  const snapshot = store.snapshot('threads', '1')!;
  store.recordDecision({ ...context, snapshot_id: snapshot.id, classification: 'SUITABLE', assessment_status: 'ASSESSED', reason_code: 'PRIMARY_REQUEST', evidence_ids: [snapshot.spans[0]!.id], action_target: { entity_id: '1', type: 'POST' }, model: 'synthetic' });
  const counts = { raw: 1, comments: 0, suitable: 1, notYet: 0, unrelated: 0, pending: 0, failed: 0 };
  const progress: OpportunityProgress = { campaignId: campaign.campaign_id, totalTarget: 10, threadsShare: 0.8, counts, byPlatform: { threads: counts, facebook: { ...counts, raw: 0, suitable: 0 } },
    costUsd: 0.1, costUpperUsd: 0.1, usageUnknown: 0, budgetUsd: 3, phase: 'SETTLED', lastError: null,
    preview: [{ platform: 'threads', rootId: '1', classification: 'SUITABLE', text: 'OLD_PRIMARY_PREVIEW', link: '', reason: '', evidence: [], observedAt: snapshot.observed_at, coverage: 'NOT_ATTEMPTED' }] };
  const cacheFile = join(output, 'opportunity-results.json'); write(cacheFile, { ...store.exportSnapshot(context), campaign, progress, cost: {} });
  const facade = new Proxy({}, { get: (_target, key) => async (...args: unknown[]) => (store[key as keyof ConversationStore] as (...values: unknown[]) => unknown).apply(store, args) }) as AsyncConversationStore;
  const upgraded = await prepareCombinedEvaluationUpgrade({ directory: opportunity, baselineCampaign: campaign, store: facade, reason: 'TEST_UPGRADE' });
  const activeProgress = { ...progress, counts: { ...counts, suitable: 0, pending: 1 }, byPlatform: { ...progress.byPlatform, threads: { ...counts, suitable: 0, pending: 1 } }, preview: [], phase: 'VERIFYING' };
  const activeExport = { ...store.exportSnapshot(upgraded.context), campaign: upgraded.campaign, progress: activeProgress, cost: {} }; store.close();
  write(join(directory, 'latest-run.json'), { id, state: 'COMPLETED', startedAt: '2026-10-30T10:00:00Z', finishedAt: '2026-10-30T11:00:00Z', minimumPosts: 10, keywords: ['học piano'], outputDirectory: output,
    platforms: [{ platform: 'threads', profileId: 'csd-00000000-0000-4000-8000-000000000002', state: 'COMPLETED', count: 1, reason: 'TARGET_REACHED' }], preview: [], opportunity: progress });
  let launched = 0;
  const service = createProductionService({ directory, version: 'test', host: { async list() { return []; }, async sessionStatus() { return true; }, async create() { throw Error('UNEXPECTED'); }, async openLogin() { throw Error('UNEXPECTED'); } },
    async collect() { launched++; throw Error('UNEXPECTED'); } });
  return { directory, opportunity, service, cacheFile, activeExport, write, launched: () => launched, close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('active upgrade suppresses old positive UI/cooler progress and rejects cached baseline JSON/XLSX input without starting work', async () => {
  const f = await fixture(); try {
    const before = readFileSync(f.cacheFile);
    const state = await f.service.getState(); assert.equal(state.run?.opportunity?.counts.suitable, 0); assert.equal(state.run?.opportunity?.counts.pending, 1);
    assert.deepEqual(state.run?.opportunity?.preview, []); assert.equal(state.run?.opportunity?.lastError, 'RESULTS_STALE_EVALUATION_CONTEXT'); assert.equal(state.run?.state, 'STOPPED');
    assert.equal(f.service.progress()?.opportunity?.counts.suitable, 0);
    assert.throws(() => f.service.results(), /RESULTS_STALE_EVALUATION_CONTEXT/);
    await assert.rejects(f.service.snapshotResults(), /RESULTS_STALE_EVALUATION_CONTEXT/);
    assert.deepEqual(readFileSync(f.cacheFile), before); assert.equal(f.launched(), 0);
  } finally { f.close(); }
});

test('matching active-context export is usable while cached baseline completion is not presented as completed', async () => {
  const f = await fixture(); try {
    f.write(f.cacheFile, f.activeExport);
    const state = await f.service.getState(); assert.equal(state.run?.opportunity?.phase, 'VERIFYING'); assert.equal(state.run?.opportunity?.counts.suitable, 0); assert.equal(state.run?.state, 'STOPPED');
    const result = await f.service.snapshotResults(); assert.deepEqual((result.opportunity as typeof f.activeExport).campaign, f.activeExport.campaign); assert.equal(f.launched(), 0);
  } finally { f.close(); }
});

test('migrating or corrupt active pointer never falls back to an older successful export', async () => {
  const f = await fixture(); try {
    f.write(f.cacheFile, f.activeExport);
    const pointerFile = join(f.opportunity, 'active-evaluation.json'), pointer = JSON.parse(readFileSync(pointerFile, 'utf8'));
    f.write(pointerFile, { ...pointer, state: 'MIGRATING' }); await assert.rejects(f.service.snapshotResults(), /RESULTS_STALE_EVALUATION_CONTEXT/);
    f.write(pointerFile, { ...pointer, recipe_sha256: 'bad' });
    await assert.rejects(f.service.snapshotResults(), /ACTIVE_EVALUATION_POLICY_MISMATCH/);
    assert.equal((await f.service.getState()).run?.opportunity?.counts.suitable, 0); assert.equal(f.launched(), 0);
  } finally { f.close(); }
});
