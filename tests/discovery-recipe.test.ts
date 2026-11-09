import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionService, type ProductionHost } from '../src/application/production-service.js';
import { createOpportunityPipeline, type OpportunityPipelineInput } from '../src/application/opportunity-pipeline.js';
import { unassessedGateway } from '../src/application/filter-policy.js';

test('a saved follow-up run resumes with its recipe and delivery exclusions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-discovery-recipe-'));
  const profileId = 'csd-00000000-0000-4000-8000-000000000001';
  const host: ProductionHost = { async list() { return [{ id: profileId, platform: 'facebook', label: 'Fixture', createdAt: '2026-11-06T00:00:00Z',
    accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 }, open: false, persistenceError: null }]; },
    async sessionStatus() { return true; }, async create() { throw Error('NO_CREATE'); }, async openLogin() { throw Error('NO_LOGIN'); } };
  const pipelineInputs: OpportunityPipelineInput[] = []; let plannerCalls = 0;
  const openService = () => createProductionService({ directory, version: 'test', host, watchAfterDiscovery: false,
    prepareCampaignDraft: async () => { plannerCalls++; throw Error('NO_PLANNER'); },
    createOpportunity: input => { pipelineInputs.push(input); return createOpportunityPipeline({ ...input, gateway: unassessedGateway }); },
    async collect() { return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; },
    async collectConversation() { throw Error('NO_COMMENT_COLLECTION'); } });
  let service = openService();
  try {
    service.saveConfig({ schemaVersion: 2, keywords: ['spa'], minimumPosts: 1, opportunity: { enabled: true, prompt: 'spa', brandContext: '',
      filterMode: 'OFF', totalTarget: 1, rawCap: 1000, budgetUsd: 0, commentsEnabled: false } });
    await service.start({ profiles: [{ platform: 'facebook', profileId }] }); await service.settled();
    const saved = { ...service.results().run, discoverySourceRunId: 'crawl-00000000-0000-4000-8000-000000000099' };
    const campaignPath = join(saved.outputDirectory, 'opportunity', 'campaign.json'), before = readFileSync(campaignPath, 'utf8');
    await service.shutdown();
    writeFileSync(join(directory, 'latest-run.json'), JSON.stringify(saved));
    writeFileSync(join(saved.outputDirectory, 'run-state.json'), JSON.stringify(saved));
    writeFileSync(join(saved.outputDirectory, 'discovery-parent.json'), JSON.stringify({
      schemaVersion: 1, sourceRunId: saved.discoverySourceRunId, excludedRootKeys: ['facebook:old-root'],
    }));
    service = openService();
    assert.equal(service.readRunState(saved.id)?.discoverySourceRunId, saved.discoverySourceRunId);
    await service.resume(); await service.settled();
    assert.deepEqual(pipelineInputs.at(-1)!.excludedRootKeys, ['facebook:old-root']);
    assert.equal(service.results().run.id, saved.id);
    assert.equal(readFileSync(campaignPath, 'utf8'), before);
    assert.equal(plannerCalls, 0);
  } finally { await service.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});
