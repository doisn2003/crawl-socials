import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planQueries } from '../src/application/query-planner.js';
import type { PlannerInput, PlannerTarget } from '../src/application/query-planner.js';
import { expandCampaignQueries } from '../src/application/query-expansion.js';
import { buildCampaignIntent } from '../src/application/campaign-intent.js';
import { createCampaignValidator } from '../src/infrastructure/config/campaign-validator.js';
import { FakeSocialAdapter } from '../src/infrastructure/adapters/fake-social-adapter.js';
import type { FakeAdapterFixture } from '../src/infrastructure/adapters/fake-social-adapter.js';
import type { CampaignSpec, SourceType } from '../src/domain/campaign.js';
import type { KeywordDeclaration } from '../src/domain/campaign-intent.js';
import type { AdapterCapabilities, AdapterRequest } from '../src/domain/adapter-contracts.js';
import { validateAdapterRequest } from '../src/application/adapter-capabilities.js';

const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const validator = createCampaignValidator(json('.brain/specs/campaign.schema.json') as object);
const fixture = (): FakeAdapterFixture => json('tests/fixtures/adapters/facebook-pages.json') as FakeAdapterFixture;
function target(source_type: SourceType = 'PAGE'): PlannerTarget {
  return { search_mode: 'POST_SEARCH', source_type, source_id: null, source_evidence_ref: null,
    access_context: { access_context_id: 'synthetic-access', profile_id: null, account_id: null, account_binding: 'ANONYMOUS', source_permission: 'UNKNOWN' } };
}
function input(change?: (campaign: CampaignSpec) => void, declarations: KeywordDeclaration[] = []): PlannerInput {
  const campaign = validator.parse(json('.brain/specs/campaign.coffee.json'));
  campaign.workload.keywords = ['quán cà phê', 'Tiny Cafe'];
  // Synthetic test limits only; the saved user campaign remains unchanged.
  campaign.budgets = { currency: 'VND', max_cost: 0, max_requests: 40, max_operator_minutes: 5, max_storage_mb: 10 };
  change?.(campaign);
  const intent = buildCampaignIntent(campaign, validator, declarations);
  return { intent, proposals: expandCampaignQueries(intent, { max_queries: 24, max_depth: 2, max_candidate_checks: 200,
    strategies: { COFFEE_SPELLING: true, INTENT_PHRASING: true, CONFIGURED_PLACE: true } }),
    capability: new FakeSocialAdapter(fixture()).capabilities,
    targets: [target('PAGE'), target('PUBLIC_GROUP'), target('PUBLIC_PERSONAL')],
    context: { namespace: 'synthetic-planner-v1', mode: 'FIXTURE', geography_policy: 'POST_VALIDATE' },
    budget: { task: { jobs: 8, candidates: 24, request_units: 40, cost_units: 0 },
      global_remaining: { jobs: 8, candidates: 24, request_units: 40, cost_units: 0 },
      per_job: { candidates: 3, request_units: 2, cost_units: 0 }, request_unit: 'ADAPTER_CALLS', currency: 'VND', cost_unit_scale: 1,
      request_basis_ref: 'fixture:two-calls-whole-job', cost_basis_ref: 'fixture:no-external-service' } };
}
const hasReason = (plan: ReturnType<typeof planQueries>, reason: string) => plan.decisions.some(decision => decision.reasons.includes(reason as never));
const code = (value: string) => (error: unknown) => error instanceof Error && error.message === value;

test('planner emits contract-compatible templates, original-first order and no actual run or execution authorization', () => {
  const data = input(), before = structuredClone(data), plan = planQueries(data);
  assert.deepEqual(data, before); assert.equal(plan.execution_authorized, false);
  assert.equal(plan.campaign_snapshot.mode, 'DRAFT'); assert.equal(plan.capability_snapshot.verification, 'FIXTURE_ONLY');
  assert.equal(plan.jobs.length, 8);
  const localIds = plan.jobs.map(job => plan.lineage_catalog.find(node => node.lineage_id === job.lineage_id)!.proposal.id);
  assert.deepEqual(localIds.slice(0, 6), ['q0', 'q0', 'q0', 'q1', 'q1', 'q1']);
  for (const job of plan.jobs) {
    assert(!('run_id' in job.request_template.query));
    assert.equal(validateAdapterRequest(data.capability, { ...job.request_template, query: { ...job.request_template.query, run_id: 'synthetic-validation-only' } }), null);
    assert.equal(job.expected_capture_mode, 'FIXTURE');
  }
  assert(!JSON.stringify(plan).includes('planner:shape-check-only'));
  assert(!('started_at' in plan)); assert(!('deadline_at' in plan));
  assert(plan.warnings.includes('FIXTURE_SOURCE_PERMISSION_REMAINS_UNKNOWN'));
});

test('task/global/campaign budgets share one allocation across query and source fanout', () => {
  const data = input(campaign => { campaign.budgets.max_requests = 5; });
  data.budget.task.jobs = 7; data.budget.global_remaining.jobs = 6;
  data.budget.task.candidates = 20; data.budget.global_remaining.candidates = 5;
  const plan = planQueries(data);
  assert.deepEqual(plan.effective_budget, { jobs: 6, candidates: 5, request_units: 5, cost_units: 0 });
  assert.deepEqual(plan.allocation, { jobs: 2, candidates: 5, request_units: 4, cost_units: 0 });
  assert.deepEqual(plan.jobs.map(job => job.reservation.candidates), [3, 2]);
  assert(hasReason(plan, 'CANDIDATE_BUDGET_EXHAUSTED')); assert(hasReason(plan, 'REQUEST_BUDGET_EXHAUSTED'));
  assert.equal(plan.source_coverage.valid_source_mix_proven, false);
  assert.deepEqual(plan.source_coverage.required_without_jobs, ['PUBLIC_PERSONAL']);
  assert.deepEqual(plan.unallocated_dimensions, ['WALL_TIME', 'OPERATOR_TIME', 'STORAGE']);
});

test('known zero job budget defers without treating zero as unlimited', () => {
  const data = input(); data.budget.global_remaining.jobs = 0;
  const plan = planQueries(data);
  assert.equal(plan.jobs.length, 0); assert(hasReason(plan, 'JOB_BUDGET_EXHAUSTED'));
  assert.equal(plan.effective_budget!.jobs, 0);
});

test('unknown campaign/task/global/reservation budgets or units remain unknown and defer jobs', () => {
  const cases = [
    input(campaign => { campaign.budgets.max_cost = null; }),
    input(campaign => { campaign.budgets.max_requests = null; }),
    input(campaign => { campaign.budgets.max_storage_mb = null; }),
  ];
  for (const data of cases) {
    const plan = planQueries(data); assert.equal(plan.jobs.length, 0); assert.equal(plan.effective_budget, null);
    assert(hasReason(plan, 'CAMPAIGN_BUDGET_UNRESOLVED'));
  }
  for (const mutate of [
    (data: PlannerInput) => { data.budget.task.candidates = null; },
    (data: PlannerInput) => { data.budget.global_remaining.request_units = null; },
    (data: PlannerInput) => { data.budget.per_job.cost_units = null; },
    (data: PlannerInput) => { data.budget.request_unit = null; },
  ]) {
    const data = input(); mutate(data); const plan = planQueries(data);
    assert.equal(plan.jobs.length, 0); assert(hasReason(plan, 'BUDGET_UNRESOLVED'));
    assert.equal(plan.effective_budget, null);
  }
  const unknownBasis = input(); unknownBasis.budget.cost_basis_ref = null;
  assert(hasReason(planQueries(unknownBasis), 'RESERVATION_BASIS_UNKNOWN'));
  assert.equal(planQueries(unknownBasis).budget_configuration.cost_basis_ref, null);
});

test('cost reservations use explicit integer units and campaign currency cap without binary rounding up', () => {
  const data = input(campaign => { campaign.budgets.currency = 'USD'; campaign.budgets.max_cost = 0.29; });
  data.budget.currency = 'USD'; data.budget.cost_unit_scale = 100;
  data.budget.task.cost_units = 100; data.budget.global_remaining.cost_units = 100; data.budget.per_job.cost_units = 10;
  const plan = planQueries(data);
  assert.equal(plan.effective_budget!.cost_units, 29); assert.equal(plan.allocation.cost_units, 20);
  assert.equal(plan.jobs.length, 2); assert(hasReason(plan, 'COST_BUDGET_EXHAUSTED'));
  const mismatch = input(); mismatch.budget.currency = 'USD';
  assert(hasReason(planQueries(mismatch), 'CURRENCY_MISMATCH'));
  const fractional = input(campaign => { campaign.budgets.currency = 'USD'; campaign.budgets.max_cost = 0.291; });
  fractional.budget.currency = 'USD'; fractional.budget.cost_unit_scale = 100;
  assert(hasReason(planQueries(fractional), 'CAMPAIGN_COST_NOT_REPRESENTABLE'));
});

test('language and date constraints are sent only when both required capabilities exist; unsupported filters defer', () => {
  const data = input(campaign => {
    campaign.workload.language = 'vi';
    campaign.historical_window = { mode: 'RANGE', from_utc: '2020-01-01T00:00:00.000Z', to_utc: '2026-01-01T00:00:00.000Z' };
  });
  const supported = planQueries(data);
  assert.deepEqual(supported.jobs[0]!.request_template.query.filters, {
    language: 'vi', published_from: '2020-01-01T00:00:00.000Z', published_to: '2026-01-01T00:00:00.000Z',
  });
  data.capability = { ...data.capability, filters_by_mode: { POST_SEARCH: ['published_from'] } };
  const missing = planQueries(data);
  assert.equal(missing.jobs.length, 0); assert(hasReason(missing, 'LANGUAGE_FILTER_UNSUPPORTED'));
  assert(hasReason(missing, 'DATE_FILTER_UNSUPPORTED'));
});

test('required geography is explicit post-validation or defer, never a fictitious adapter filter or keyword substitute', () => {
  const data = input(campaign => {
    campaign.workload.keywords = ['cafe Hà Nội'];
    campaign.workload.geography = { mode: 'INCLUDE', places: ['Hà Nội'], preferred_places: [], evidence_rule: 'fixture:post-location-evidence' };
  });
  data.context.geography_policy = 'DEFER';
  const blocked = planQueries(data);
  assert.equal(blocked.jobs.length, 0); assert(hasReason(blocked, 'GEOGRAPHY_POST_VALIDATION_REQUIRED'));
  data.context.geography_policy = 'POST_VALIDATE';
  const post = planQueries(data);
  assert(post.jobs.length > 0); assert(post.jobs.every(job => job.geography_handling === 'POST_VALIDATE'));
  assert.deepEqual(post.jobs[0]!.request_template.query.filters, {});
  assert.deepEqual(post.campaign_snapshot.workload.geography.places, ['Hà Nội']);
  assert.equal(post.validation_policy, 'ALL_CAMPAIGN_CONDITIONS_BEFORE_VALID_UNIQUE_COUNT');
  const any = planQueries(input());
  assert(any.jobs.every(job => job.geography_handling === 'NO_REQUIRED_FILTER'));
  assert.deepEqual(any.campaign_snapshot.workload.geography.preferred_places, ['Hà Nội']);
});

test('exact phrase has no declared adapter syntax so it defers; brand text is passed unchanged', () => {
  const data = input(undefined, [
    { keyword_index: 0, kind: 'EXACT_PHRASE', declaration_ref: 'fixture:exact' },
    { keyword_index: 1, kind: 'BRAND', declaration_ref: 'fixture:brand' },
  ]);
  const plan = planQueries(data);
  assert(hasReason(plan, 'EXACT_PHRASE_UNSUPPORTED'));
  assert(plan.jobs.length > 0); assert(plan.jobs.every(job => job.request_template.query.keyword === 'Tiny Cafe'));
  assert(plan.lineage_catalog.some(node => node.proposal.keyword_kind === 'EXACT_PHRASE'));
});

test('capability unknown and fixture verification cannot be raised to LIVE by planning', () => {
  const data = input(); data.context.mode = 'LIVE';
  let plan = planQueries(data);
  assert.equal(plan.jobs.length, 0); assert(hasReason(plan, 'LIVE_CAPABILITY_REQUIRED')); assert(hasReason(plan, 'LIVE_PERMISSION_REQUIRED'));
  data.capability = { ...data.capability, adapter_id: 'synthetic-live-contract', verification: 'LIVE_VERIFIED' };
  plan = planQueries(data); assert.equal(plan.jobs.length, 0); assert(hasReason(plan, 'LIVE_PERMISSION_REQUIRED'));
  data.targets = data.targets.map(value => ({ ...value, access_context: { ...value.access_context, source_permission: 'ALLOWED' } }));
  const declared = planQueries(data);
  assert(declared.jobs.length > 0); assert.equal(declared.execution_authorized, false);
  assert.equal(declared.campaign_snapshot.mode, 'DRAFT');
  assert.equal(declared.context.mode, 'LIVE'); // A declaration, never a capture provenance stamp.
  const unknown = input(); unknown.capability = { ...unknown.capability, verification: 'UNKNOWN' };
  assert.equal(planQueries(unknown).jobs.length, 0); assert(hasReason(planQueries(unknown), 'CAPABILITY_UNVERIFIED'));
});

test('access denied and unverified user sessions do not receive executable-shaped jobs', () => {
  const denied = input(); denied.targets = [target()];
  denied.targets[0]!.access_context = { ...denied.targets[0]!.access_context, source_permission: 'DENIED' };
  const plan = planQueries(denied); assert.equal(plan.jobs.length, 0); assert.equal(plan.decisions[0]!.outcome, 'REJECTED');
  assert(hasReason(plan, 'ACCESS_DENIED'));
  const session = input(); session.capability = { ...session.capability, authentication: 'USER_SESSION' };
  assert.equal(planQueries(session).jobs.length, 0); assert(hasReason(planQueries(session), 'LOGIN_REQUIRED'));
});

test('unsupported mode/source/scope are explicit, source discovery is never substituted for posts', () => {
  const mode = input(); mode.targets = [{ ...target(), search_mode: 'SOURCE_DISCOVERY' }];
  assert(hasReason(planQueries(mode), 'UNSUPPORTED_MODE')); assert.equal(planQueries(mode).jobs.length, 0);
  const missing = input(); missing.capability = { ...missing.capability, source_types: ['PAGE'], collection_scopes: ['JOINED_GROUPS'] };
  const plan = planQueries(missing);
  assert(hasReason(plan, 'UNSUPPORTED_SOURCE')); assert(hasReason(plan, 'UNSUPPORTED_SCOPE')); assert.equal(plan.jobs.length, 0);
});

test('target identity and mode are checked, post URLs are not accepted as source seeds', () => {
  const data = input(); data.targets = [{ ...target(), search_mode: 'SOURCE_FEED' }];
  assert(hasReason(planQueries(data), 'SOURCE_IDENTITY_UNVERIFIED'));
  data.targets = [{ ...target(), search_mode: 'SOURCE_FEED', source_id: 'fixture-page', source_evidence_ref: 'fixture:verified-source' }];
  assert(planQueries(data).jobs.length > 0);
  data.targets = [{ ...target(), source_id: 'fixture-page', source_evidence_ref: 'fixture:verified-source' }];
  assert(hasReason(planQueries(data), 'TARGET_MODE_CONFLICT'));
  data.targets = [{ ...target(), search_mode: 'SOURCE_FEED', source_id: 'https://www.facebook.com/a/posts/123', source_evidence_ref: 'fixture:post-not-source' }];
  assert.throws(() => planQueries(data), code('PLANNER_INPUT_INVALID'));
});

test('duplicate targets are rejected without multiplying allocation', () => {
  const data = input(); data.targets = [target(), target()];
  const plan = planQueries(data);
  assert(plan.decisions.filter(decision => decision.target_index === 1).every(decision => decision.outcome === 'REJECTED' && decision.reasons.includes('DUPLICATE_TARGET')));
  assert(plan.jobs.every(job => job.target_index === 0));
  assert.equal(plan.allocation.candidates, plan.jobs.reduce((total, job) => total + job.reservation.candidates, 0));
});

test('source mix remains unproven; disabled and unresolved sources stay distinct from a zero quota', () => {
  const data = input(campaign => {
    campaign.source_requirements.PUBLIC_PERSONAL = { in_scope: false, minimum_valid_unique_posts: 0 };
    campaign.source_requirements.PUBLIC_GROUP = { in_scope: null, minimum_valid_unique_posts: null };
  });
  const plan = planQueries(data);
  assert(hasReason(plan, 'SOURCE_OUT_OF_SCOPE')); assert(hasReason(plan, 'SOURCE_SCOPE_UNRESOLVED'));
  assert(plan.jobs.every(job => job.request_template.query.source_type === 'PAGE'));
  assert.deepEqual(plan.source_coverage.unresolved_requirements, ['PUBLIC_GROUP']);
  assert.equal(plan.source_coverage.valid_source_mix_proven, false);
});

test('IDs bind configuration, campaign, proposals, adapter and targets; complete lineage survives job caps', () => {
  const data = input(); const plan = planQueries(data);
  assert.equal(new Set(plan.jobs.map(job => job.job_id)).size, plan.jobs.length);
  assert.equal(new Set(plan.jobs.map(job => job.request_template.query.query_id)).size, plan.jobs.length);
  const catalog = new Map(plan.lineage_catalog.map(node => [node.lineage_id, node]));
  for (const node of catalog.values()) if (node.parent_lineage_id) assert(catalog.has(node.parent_lineage_id));
  for (const job of plan.jobs) {
    assert(catalog.has(job.lineage_id));
    if (job.request_template.query.parent_query_id) assert(catalog.has(job.request_template.query.parent_query_id));
  }
  data.budget.task.jobs = 1;
  const capped = planQueries(data);
  assert.equal(capped.jobs.length, 1); assert.equal(capped.lineage_catalog.length, data.proposals.queries.length);
  assert(capped.lineage_catalog.length > capped.jobs.length); assert.notEqual(capped.plan_id, plan.plan_id);
  const changedAdapter = input(); changedAdapter.capability = { ...changedAdapter.capability, adapter_version: '2.0.0' };
  assert.notEqual(planQueries(changedAdapter).plan_id, plan.plan_id);
  const changedContext = input(); changedContext.targets[0]!.access_context = { ...changedContext.targets[0]!.access_context, access_context_id: 'other-context' };
  assert.notEqual(planQueries(changedContext).plan_id, plan.plan_id);
  const changedCampaign = input(campaign => { campaign.campaign_id = 'other-campaign'; });
  assert.notEqual(planQueries(changedCampaign).plan_id, plan.plan_id);
});

test('same input is deterministic and deeply immutable without freezing caller-owned objects', () => {
  const data = input(), plan = planQueries(data);
  assert.deepEqual(planQueries(input()), plan);
  assert(Object.isFrozen(plan.jobs[0]!.request_template.query.filters));
  assert(!Object.isFrozen(data.context)); assert(!Object.isFrozen(data.capability));
  data.context.namespace = 'changed'; data.budget.per_job.candidates = 99;
  assert.equal(plan.context.namespace, 'synthetic-planner-v1'); assert.equal(plan.budget_configuration.per_job.candidates, 3);
  assert.throws(() => { (plan.jobs as unknown as { job_id: string }[])[0]!.job_id = 'changed'; }, TypeError);
});

test('mutated proposals, malformed enums and malformed budgets fail closed at runtime', () => {
  const data = input(); const forged = structuredClone(data.proposals);
  (forged.queries[0] as unknown as { text: string }).text = 'unrelated private marker';
  data.proposals = forged;
  assert.throws(() => planQueries(data), code('PLANNER_PROPOSALS_INVALID'));
  const cap = input(); cap.capability = { ...cap.capability, verification: ['LIVE_VERIFIED'] as unknown as AdapterCapabilities['verification'] };
  assert.throws(() => planQueries(cap), code('PLANNER_CAPABILITY_INVALID'));
  const context = input(); context.targets[0]!.access_context = { ...context.targets[0]!.access_context, source_permission: ['ALLOWED'] as never };
  assert.throws(() => planQueries(context), code('PLANNER_INPUT_INVALID'));
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = input(); invalid.budget.global_remaining.request_units = value;
    assert.throws(() => planQueries(invalid), code('PLANNER_INPUT_INVALID'));
  }
});

test('fake adapter consumes a bound template over multiple pages without resetting the job allocation or promoting provenance', async () => {
  const data = input(); data.targets = [{ ...target(), search_mode: 'SOURCE_FEED', source_id: 'fixture-page', source_evidence_ref: 'fixture:verified-source' }];
  data.budget.task.jobs = 1; data.budget.task.candidates = 3;
  const plan = planQueries(data), job = plan.jobs[0]!;
  const request: AdapterRequest = { ...job.request_template, query: { ...job.request_template.query, run_id: 'fixture-planner-run' } };
  const adapter = new FakeSocialAdapter(fixture(), () => '2026-10-27T00:00:00.000Z');
  assert.equal((await adapter.initialize()).status, 'OK');
  const access = await adapter.checkAccess(request.access_context);
  assert.equal(access.status, 'OK'); if (access.status === 'OK') assert.equal(access.value.source_permission, 'UNKNOWN');
  let calls = 1, count = 0, result = await adapter.searchPosts(request);
  const identities = new Set<string | null>();
  while (result.status === 'OK') {
    assert.equal(result.value.kind, 'POSTS');
    if (result.value.kind !== 'POSTS') throw new Error('Unexpected fixture entity');
    const page = result.value.page;
    assert.equal(page.capture_mode, 'FIXTURE');
    for (const candidate of page.candidates) { count++; identities.add(candidate.post_id); assert.equal(candidate.provenance.capture_mode, 'FIXTURE'); }
    if (page.continuation.status !== 'MORE') break;
    calls++; assert(calls <= job.reservation.request_units);
    result = await adapter.fetchBatch(request, page.continuation.checkpoint);
  }
  assert.equal(result.status, 'OK'); assert.equal(calls, 2); assert.equal(count, 3); assert.equal(identities.size, 2);
  assert.equal(job.reservation.candidates, 3); assert.equal(plan.allocation.jobs, 1);
  assert.equal(plan.source_coverage.valid_source_mix_proven, false);
  await adapter.stop();
});
