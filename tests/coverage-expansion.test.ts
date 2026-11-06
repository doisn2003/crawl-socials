import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoverageExpansion, initialDiscoveryQueries, type CoverageExpansionContext } from '../src/application/coverage-queries.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { contentHash } from '../src/domain/conversation.js';
import { discoveryPortfolioBudget, originalRequestFacets } from '../src/domain/discovery-contract.js';
import { modelRequest } from '../src/domain/opportunity-keywords.mjs';
import type { CampaignPlan } from '../src/domain/campaign-plan.js';
import type { ModelGateway, JsonModelRequest } from '../src/application/ports/model-gateway.js';
import type { IntentInput } from '../src/shared/semantic-intent.js';

function fixture(): CampaignPlan {
  const input: IntentInput = { stage: 'S2', prompt: 'Tìm người muốn học piano', context: '', seeds: [], revision: 1, answers: [], edits: [] };
  const facets = originalRequestFacets(input), facet = facets[0]!;
  const plan = literalCampaign({ prompt: input.prompt, seed_queries: ['học piano'], suitable_target: 1000, raw_cap: 10000, model_usd: 3 });
  plan.filter_mode = 'CONSISTENT';
  plan.intent_resolution = { schema_version: 1, input, recipe_hash: 'a'.repeat(64), plan: {
    state: 'READY', intent_revision: 1, understanding: input.prompt, target_roles: [], intent: [], constraints: [],
    branches: [{ id: 'learn', label: 'Học đàn', anchor: 'piano', source: 'PROMPT', quote: input.prompt, scope: 'CORE', reason: 'Ý gốc', facet_ids: [facet.id] }],
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], queries: [], caveats: [], improvements: [], uncovered: [], original_facets: facets,
  } };
  plan.discovery_plan = { version: '2.0.0', evidence_scope: 'POST_ONLY', facets,
    coverage: [{ facet_id: facet.id, disposition: 'SEARCH', branch_ids: ['learn'], reason: 'Ý gốc', superseded_by: null }],
    queries: [{ query_id: 'first', text: 'học piano', family_id: 'TOPIC', facet_ids: [facet.id], wave: 0, origin: 'MODEL', rationale: 'Ý gốc' }],
    max_queries: 240, initial_wave: 0 };
  plan.queries[0]!.wave = 0;
  return plan;
}
const context = (): CoverageExpansionContext => ({ allowModel: true, accepted: 293, raw: 470, pending: 35,
  queryYield: [{ platform: 'threads', query: 'học piano', observed: 470, accepted: 293 }] });
function query(plan: CampaignPlan, text: string, family = 'RECOMMENDATION') {
  return { text, branch_id: 'learn', family_id: family, facet_ids: [plan.discovery_plan!.facets[0]!.id], rationale: 'Cách nói khác cùng nhu cầu học đàn' };
}
function model(generate: (request: JsonModelRequest) => unknown | Promise<unknown>): ModelGateway {
  return { summary: () => ({ remaining_usd: 3 }), generateJson: async (request: JsonModelRequest) => ({ value: await generate(request), request_hash: 'recorded', model: 'fixture' }) } as unknown as ModelGateway;
}

test('a nine-query or smaller frozen plan can generate real subsequent waves shared across accounts and restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-waves-')), plan = fixture(); let calls = 0;
  const gateway = model(async request => {
    calls++;
    const input = request.input as { progress: { target: number }; requested_queries: number; existing: string[] };
    assert.equal(input.progress.target, 1000); assert.equal(input.requested_queries, 40);
    await new Promise(r => setTimeout(r, 5));
    return { queries: [query(plan, calls === 1 ? 'xin thầy dạy đàn' : 'tập đàn cho người mới')], exhausted: false, reason: 'Còn hướng tìm hợp lệ' };
  });
  try {
    const a = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    const b = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    const initial = initialDiscoveryQueries(plan, 'threads');
    const both = await Promise.all([a({ knownQueries: initial }), b({ knownQueries: initial })]);
    assert.deepEqual(both, [['xin thầy dạy đàn'], ['xin thầy dạy đàn']]); assert.equal(calls, 1);
    const resumed = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    assert.deepEqual(await resumed({ knownQueries: initial }), ['xin thầy dạy đàn']); assert.equal(calls, 1);
    assert.deepEqual(await resumed({ knownQueries: [...initial, ...both[0]!] }), ['tập đàn cho người mới']); assert.equal(calls, 2);
    const saved = JSON.parse(readFileSync(join(directory, 'coverage-query-expansion.json'), 'utf8'));
    assert.equal(saved.attempts.length, 2); assert.equal(saved.attempts[0].queries[0].branch_id, 'learn');
    assert.equal(plan.queries.length, 1); // Frozen recipe/acceptance contract stays immutable.
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('saved reserve is shared before inference and OFF cannot generate even with a permissive caller', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-off-')), plan = fixture();
  plan.filter_mode = 'OFF'; plan.budget.model_usd = 0;
  plan.discovery_plan!.queries.push({ ...plan.discovery_plan!.queries[0]!, text: 'tập đàn', query_id: 'reserve', wave: 1 });
  plan.queries.push({ ...plan.queries[0]!, text: 'tập đàn', wave: 1 });
  let calls = 0;
  const gateway = model(() => { calls++; throw Error('OFF_MODEL_CALL'); });
  try {
    const expand = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    assert.deepEqual(await expand({ knownQueries: ['học piano'] }), ['tập đàn']);
    assert.deepEqual(await expand({ knownQueries: ['học piano', 'tập đàn'] }), []);
    assert.deepEqual(await expand(), ['tập đàn']); assert.equal(calls, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('invalid generations and interrupted attempts retain their bounded allowance across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-failed-')), plan = fixture(); let calls = 0;
  const gateway = model(() => { calls++; return { queries: [query(plan, 'tìm người học piano')], exhausted: false, reason: '' }; });
  try {
    for (let n = 0; n < 6; n++) {
      const expand = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
      await assert.rejects(expand({ knownQueries: ['học piano'] }), /QUERY_EXPANSION_UNGROUNDED/);
    }
    const file = join(directory, 'coverage-query-expansion.json'), saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.attempts[5].state = 'STARTED'; writeFileSync(file, JSON.stringify(saved));
    assert.deepEqual(await createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context)({ knownQueries: ['học piano'] }), []);
    assert.equal(calls, 6); assert.equal(JSON.parse(readFileSync(file, 'utf8')).attempts.length, 6);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('target attainment, exhausted portfolio and 240-query maximum stop new paid expansion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-cap-')), plan = fixture(); let calls = 0;
  const gateway = model(() => { calls++; return { queries: [], exhausted: true, reason: 'Không còn hướng phù hợp với mục tiêu' }; });
  try {
    const reached = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, () => ({ ...context(), accepted: 1000 }));
    assert.deepEqual(await reached({ knownQueries: ['học piano'] }), []); assert.equal(calls, 0);
    const expand = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    assert.deepEqual(await expand({ knownQueries: ['học piano'] }), []); assert.equal(calls, 1);
    assert.deepEqual(await expand({ knownQueries: ['học piano'] }), []); assert.equal(calls, 1);
    plan.queries = Array.from({ length: 240 }, (_, n) => ({ text: 'học đàn ' + n, family: 'BROAD', platforms: ['threads'], wave: 0 }));
    writeFileSync(join(directory, 'coverage-query-expansion.json'), JSON.stringify({ version: 2, fingerprint: contentHash(plan), state: 'ACTIVE', queries: [], waves: [], attempts: [] }));
    assert.deepEqual(await createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context)({ knownQueries: plan.queries.map(q => q.text) }), []);
    assert.equal(calls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('planner effort scales by accepted target and literal source coverage does not search operator instruction clauses', () => {
  const input: IntentInput = { stage: 'S2', prompt: 'Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill', context: '', seeds: [], revision: 1, answers: [], edits: [], discovery_target: 5000 };
  assert.deepEqual(originalRequestFacets(input).map(f => f.literal_query), ['tìm quán cafe chill', 'trải nghiệm đi cafe chill', 'quán cafe chill']);
  const request = modelRequest('B', input, {});
  const effort = request.input.SEARCH_EFFORT as ReturnType<typeof discoveryPortfolioBudget>;
  assert.equal(effort.accepted_target, 5000);
  assert.equal(effort.preferred_queries, 192);
  assert.equal(discoveryPortfolioBudget(1000).preferred_queries, 96);
  assert.equal(discoveryPortfolioBudget(1000).initial_wave_size, 48);
});
