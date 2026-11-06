import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionService, type ProductionHost } from '../src/application/production-service.js';
import { createOpportunityPipeline, type OpportunityPipelineInput } from '../src/application/opportunity-pipeline.js';
import { unassessedGateway } from '../src/application/filter-policy.js';

test('follow-up discovery clones the committed recipe, retains exclusion keys on resume and never plans', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-recipe-'));
  const profileId = 'csd-00000000-0000-4000-8000-000000000001';
  const host: ProductionHost = { async list() { return [{ id: profileId, platform: 'facebook', label: 'Fixture', createdAt: '2026-11-06T00:00:00Z',
    accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 }, open: false, persistenceError: null }]; },
    async sessionStatus() { return true; }, async create() { throw Error('NO_CREATE'); }, async openLogin() { throw Error('NO_LOGIN'); } };
  const pipelineInputs: OpportunityPipelineInput[] = []; let plannerCalls = 0;
  const service = createProductionService({ directory, version: 'test', host, watchAfterDiscovery: false,
    prepareCampaignDraft: async () => { plannerCalls++; throw Error('NO_PLANNER'); },
    createOpportunity: input => { pipelineInputs.push(input); return createOpportunityPipeline({ ...input, gateway: unassessedGateway }); },
    async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
    async collectConversation() { throw Error('NO_COMMENT_COLLECTION'); } });
  try {
    service.saveConfig({ schemaVersion: 2, keywords: ['spa'], minimumPosts: 1, opportunity: { enabled: true, prompt: 'spa', brandContext: '',
      filterMode: 'OFF', totalTarget: 1, rawCap: 1000, budgetUsd: 0, commentsEnabled: false } });
    await service.start({ profiles: [{ platform: 'facebook', profileId }] }); await service.settled();
    const source = service.results().run;
    const sourceCampaignPath = join(source.outputDirectory, 'opportunity', 'campaign.json'), before = readFileSync(sourceCampaignPath, 'utf8');
    await service.startDiscoveryFromRecipe(source.id, 100, ['facebook:old-root']); await service.settled();
    const next = service.results().run, cloned = pipelineInputs.at(-1)!;
    assert.notEqual(next.id, source.id); assert.equal(next.discoverySourceRunId, source.id);
    assert.equal(cloned.config.commentsEnabled, false); assert.equal(cloned.campaign?.suitable_target, 100);
    assert.deepEqual(cloned.excludedRootKeys, ['facebook:old-root']); assert.equal(cloned.config.budgetUsd, 0);
    assert.equal(readFileSync(sourceCampaignPath, 'utf8'), before); assert.equal(service.readRunState(source.id)?.id, source.id);
    await service.resume(); await service.settled();
    assert.deepEqual(pipelineInputs.at(-1)!.excludedRootKeys, ['facebook:old-root']);
    assert.equal(plannerCalls, 0);
    await assert.rejects(service.startDiscoveryFromRecipe('../escape', 100), /DISCOVERY_INPUT_INVALID/);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});
