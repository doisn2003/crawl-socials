import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoverageExpansion, initialDiscoveryQueries, readCoverageDiagnostics, type CoverageExpansionContext } from '../src/application/coverage-queries.js';
import { BREADTH_BUCKETS, coverageWaveRequest, parseCoverageWave, portfolioDiagnostics } from '../src/application/coverage-portfolio.js';
import { literalCampaign } from '../src/application/compile-campaign.js';
import { contentHash } from '../src/domain/conversation.js';
import { discoveryPortfolioBudget, originalRequestFacets } from '../src/domain/discovery-contract.js';
import { modelRequest } from '../src/domain/opportunity-keywords.mjs';
import { geminiWireSchema } from '../src/infrastructure/llm/gemini-gateway.js';
import type { CampaignPlan } from '../src/domain/campaign-plan.js';
import type { ModelGateway, JsonModelRequest } from '../src/application/ports/model-gateway.js';
import { ModelGatewayError } from '../src/application/ports/model-gateway.js';
import type { IntentInput } from '../src/shared/semantic-intent.js';
import { observedInitialCafeQueries, observedLegacyExpansion, variedCafeQueries } from './fixtures/discovery-breadth.js';

function fixture(): CampaignPlan {
  const input: IntentInput = { stage: 'S2', prompt: 'Tìm quán cafe chill', context: '', seeds: [], revision: 1, answers: [], edits: [] };
  const facets = originalRequestFacets(input), facet = facets[0]!;
  const plan = literalCampaign({ prompt: input.prompt, seed_queries: ['quán cafe chill'], suitable_target: 1000, raw_cap: 10000, model_usd: 3 });
  plan.filter_mode = 'CONSISTENT';
  plan.intent_resolution = { schema_version: 1, input, recipe_hash: 'a'.repeat(64), plan: {
    state: 'READY', intent_revision: 1, understanding: input.prompt, target_roles: [], intent: [], constraints: [],
    branches: [{ id: 'cafe', label: 'Quán cafe chill', anchor: 'quán cafe chill', source: 'PROMPT', quote: input.prompt, scope: 'CORE', reason: 'Ý gốc', facet_ids: [facet.id] }],
    questions: [], unresolved_fields: [], unconfirmed_assumptions: [], queries: [], caveats: [], improvements: [], uncovered: [], original_facets: facets,
  } };
  plan.discovery_plan = { version: '2.0.0', evidence_scope: 'POST_ONLY', facets,
    coverage: [{ facet_id: facet.id, disposition: 'SEARCH', branch_ids: ['cafe'], reason: 'Ý gốc', superseded_by: null }],
    queries: observedInitialCafeQueries.map((text, n) => ({ query_id: 'query-' + n, text, family_id: 'TOPIC', facet_ids: [facet.id], wave: 0, origin: 'MODEL', rationale: 'Phản hồi ban đầu đã lưu' })),
    max_queries: 240, initial_wave: 0 };
  plan.queries = observedInitialCafeQueries.map(text => ({ text, family: 'BROAD', platforms: ['threads', 'facebook'], wave: 0 }));
  return plan;
}
const context = (): CoverageExpansionContext => ({ allowModel: true, accepted: 293, raw: 470, pending: 35 });
function response(plan: CampaignPlan, request: JsonModelRequest): Record<string, any> {
  const input = request.input as { requested_buckets: { id: string; style: string | null; slots: string[] }[] };
  return Object.fromEntries(input.requested_buckets.map(bucket => [bucket.id, {
    branch_ids: ['cafe'], not_applicable_reason: '', queries: Object.fromEntries(bucket.slots.map((slot, index) => {
      const text = variedCafeQueries[bucket.id]![index]!;
      const lexical_basis = bucket.style ? { source_expression: ['SYNONYM', 'ABBREVIATION'].includes(bucket.style) ? 'cafe' : 'quán cafe chill',
        search_expression: bucket.style === 'SYNONYM' ? 'cà phê' : bucket.style === 'ABBREVIATION' ? 'cf' : text, relation: bucket.style } : null;
      return [slot, { text, branch_id: 'cafe', family_id: bucket.id === 'TOPIC_SYNONYMS' || bucket.id === 'ABBREVIATIONS' ? 'TOPIC'
        : bucket.id === 'EXPERIENCE' ? 'REVIEW' : bucket.id === 'DECISION' ? 'COMPARISON' : bucket.id === 'DISCUSSION' ? 'DEBATE' : bucket.id === 'LATENT_CONTEXT' ? 'FEELING' : 'RECOMMENDATION',
      facet_ids: [plan.discovery_plan!.facets[0]!.id], rationale: 'Cách nói hoặc hoàn cảnh gắn với việc tìm không gian uống cafe thư giãn', lexical_basis }];
    })) }]));
}
function model(generate: (request: JsonModelRequest) => unknown | Promise<unknown>): ModelGateway {
  return { summary: () => ({ remaining_usd: 3 }), generateJson: async (request: JsonModelRequest) => ({ value: await generate(request), request_hash: 'recorded', model: 'fixture' }) } as unknown as ModelGateway;
}
const read = (directory: string) => JSON.parse(readFileSync(join(directory, 'coverage-query-expansion.json'), 'utf8'));

test('actual 13-query plan and 10-query old expansion are incomplete; required slots survive wire simplification', () => {
  const plan = fixture();
  const d = portfolioDiagnostics(plan, [], observedLegacyExpansion);
  assert.equal(d.total_queries, 23); assert.equal(d.state, 'INCOMPLETE'); assert.ok(d.missing.includes('LEXICAL_DIVERSITY'));
  const request = coverageWaveRequest(plan, [...observedInitialCafeQueries, ...observedLegacyExpansion], [], 48, {}, [], new AbortController().signal);
  const wire = geminiWireSchema(request.schema) as { required: string[]; properties: Record<string, any> };
  assert.equal(wire.required.length, 8);
  assert.equal(wire.required.reduce((n, id) => n + wire.properties[id].properties.queries.required.length, 0), 48);
  const parsed = parseCoverageWave(response(plan, request), request, plan, observedInitialCafeQueries);
  assert.equal(parsed.queries.length, 48);
  const complete = portfolioDiagnostics(plan, [parsed], parsed.queries.map(q => q.text));
  assert.equal(complete.state, 'COMPLETE'); assert.equal(complete.total_queries, 61); assert.equal(complete.lexical_styles.length, 4);
});

test('resume migrates old stopped expansion without resetting attempts, completes breadth once and shares it across accounts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-waves-')), plan = fixture(); let calls = 0;
  writeFileSync(join(directory, 'coverage-query-expansion.json'), JSON.stringify({ version: 2, fingerprint: contentHash(plan), state: 'EXHAUSTED',
    queries: observedLegacyExpansion, waves: [], attempts: [{ wave: 1, state: 'COMPLETE', queries: [], request_hash: 'old-spent-attempt' }] }));
  const gateway = model(async request => { calls++; await new Promise(r => setTimeout(r, 5)); return response(plan, request); });
  try {
    const a = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    const b = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    const knownQueries = [...observedInitialCafeQueries, ...observedLegacyExpansion];
    const both = await Promise.all([a({ knownQueries, completeInitial: true }), b({ knownQueries, completeInitial: true })]);
    assert.equal(both[0]!.length, 48); assert.deepEqual(both[0], both[1]); assert.equal(calls, 1);
    assert.equal(read(directory).attempts.length, 2); assert.equal(read(directory).attempts[0].request_hash, 'old-spent-attempt');
    const resumed = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    assert.deepEqual(await resumed({ knownQueries, completeInitial: true }), both[0]); assert.equal(calls, 1);
    assert.deepEqual(await resumed({ knownQueries: [...knownQueries, ...both[0]!], completeInitial: true }), []); assert.equal(calls, 1);
    assert.equal(readCoverageDiagnostics(directory)!.state, 'COMPLETE'); assert.equal(plan.queries.length, 13);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('synonym claims that merely append words to the original anchor are rejected, as are wrong-role queries', () => {
  const plan = fixture(), request = coverageWaveRequest(plan, observedInitialCafeQueries, [], 48, {}, [], new AbortController().signal);
  const raw = response(plan, request);
  raw.TOPIC_SYNONYMS.queries.q1.text = 'quán cafe chill thư giãn';
  raw.TOPIC_SYNONYMS.queries.q1.lexical_basis = { source_expression: 'cafe', search_expression: 'thư giãn', relation: 'SYNONYM' };
  raw.DIRECT_NEED.queries.q1.text = 'tìm người đi cafe';
  const parsed = parseCoverageWave(raw, request, plan, observedInitialCafeQueries);
  assert.equal(parsed.queries.length, 46); assert.equal(parsed.buckets.reduce((n, b) => n + b.rejected, 0), 2);
});

test('OFF serves a saved reserve with zero calls even if the caller requests initial completion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-off-')), plan = fixture();
  plan.filter_mode = 'OFF'; plan.budget.model_usd = 0;
  plan.discovery_plan!.queries.push({ ...plan.discovery_plan!.queries[0]!, text: 'cafe yên tĩnh', query_id: 'reserve', wave: 1 });
  plan.queries.push({ ...plan.queries[0]!, text: 'cafe yên tĩnh', wave: 1 }); let calls = 0;
  const gateway = model(() => { calls++; throw Error('OFF_MODEL_CALL'); });
  try {
    const expand = createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context);
    assert.deepEqual(await expand({ knownQueries: observedInitialCafeQueries, completeInitial: true }), ['cafe yên tĩnh']);
    assert.deepEqual(await expand({ knownQueries: [...observedInitialCafeQueries, 'cafe yên tĩnh'], completeInitial: true }), []);
    assert.equal(calls, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('missing named buckets receive bounded repair, then an explicit incomplete outcome across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-failed-')), plan = fixture(); let calls = 0;
  const gateway = model(() => { calls++; return { queries: [], exhausted: true, reason: 'Old soft format' }; });
  try {
    for (let n = 0; n < 3; n++) await assert.rejects(createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context)
      ({ knownQueries: observedInitialCafeQueries, completeInitial: true }), /QUERY_COVERAGE_INCOMPLETE/);
    assert.equal(calls, 6); assert.equal(read(directory).attempts.length, 6);
    assert.equal(read(directory).stop_reason, 'EXPANSION_ATTEMPT_LIMIT'); assert.equal(read(directory).coverage.state, 'INCOMPLETE');
    const saved = read(directory); saved.attempts[5].state = 'STARTED'; writeFileSync(join(directory, 'coverage-query-expansion.json'), JSON.stringify(saved));
    await assert.rejects(createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context)
      ({ knownQueries: observedInitialCafeQueries, completeInitial: true }), /QUERY_COVERAGE_INCOMPLETE/);
    assert.equal(calls, 6);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('no unsupported padding is invented when every requested bucket is explicitly not applicable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-limited-')), plan = fixture(); let calls = 0;
  const gateway = model(request => { calls++; const raw = response(plan, request); for (const b of Object.values(raw)) {
    b.not_applicable_reason = 'Trong phạm vi hẹp này chưa có cách diễn đạt khác được xác nhận hợp lý';
    for (const k of Object.keys(b.queries)) b.queries[k] = null;
  } return raw; });
  try {
    await assert.rejects(createCoverageExpansion(directory, plan, gateway, new AbortController().signal, context)
      ({ knownQueries: observedInitialCafeQueries, completeInitial: true }), /QUERY_COVERAGE_INCOMPLETE/);
    assert.equal(calls, 1); assert.deepEqual(read(directory).queries, []); assert.equal(read(directory).state, 'LIMITED');
    assert.equal(read(directory).coverage.state, 'INCOMPLETE');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('target attainment prevents calls and a sparse portfolio never pretends count means classification quality', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-target-')), plan = fixture(); let calls = 0;
  try {
    const expand = createCoverageExpansion(directory, plan, model(() => { calls++; throw Error('UNEXPECTED'); }), new AbortController().signal,
      () => ({ ...context(), accepted: 1000 }));
    assert.deepEqual(await expand({ knownQueries: observedInitialCafeQueries, completeInitial: true }), []); assert.equal(calls, 0);
    assert.equal(readCoverageDiagnostics(directory)!.state, 'INCOMPLETE');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('proven pre-dispatch failure does not consume an expansion attempt, but dispatched failure does', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-expand-dispatch-')), plan = fixture();
  try {
    await assert.rejects(createCoverageExpansion(directory, plan, model(() => { throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED'); }), new AbortController().signal, context)
      ({ knownQueries: observedInitialCafeQueries, completeInitial: true }), /MODEL_BUDGET_EXHAUSTED/);
    assert.equal(read(directory).attempts.length, 0);
    await assert.rejects(createCoverageExpansion(directory, plan, model(() => { throw new ModelGatewayError('MODEL_TIMEOUT', false, 'dispatched-call'); }), new AbortController().signal, context)
      ({ knownQueries: observedInitialCafeQueries, completeInitial: true }), /MODEL_TIMEOUT/);
    assert.equal(read(directory).attempts.length, 1); assert.equal(read(directory).attempts[0].state, 'FAILED');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('planner effort follows target while literal coverage omits operator instruction wrappers', () => {
  const input: IntentInput = { stage: 'S2', prompt: 'Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill', context: '', seeds: [], revision: 1, answers: [], edits: [], discovery_target: 5000 };
  assert.deepEqual(originalRequestFacets(input).map(f => f.literal_query), ['tìm quán cafe chill', 'trải nghiệm đi cafe chill', 'quán cafe chill']);
  const effort = modelRequest('B', input, {}).input.SEARCH_EFFORT as ReturnType<typeof discoveryPortfolioBudget>;
  assert.equal(effort.accepted_target, 5000); assert.equal(effort.preferred_queries, 192);
  assert.equal(discoveryPortfolioBudget(1000).preferred_queries, 96); assert.equal(BREADTH_BUCKETS.length, 8);
});
