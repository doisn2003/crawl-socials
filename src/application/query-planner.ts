import { createHash } from 'node:crypto';
import { expandCampaignQueries } from './query-expansion.js';
import type { ExpandedQuery, QueryExpansionResult } from './query-expansion.js';
import { validateAccessContext, validateAdapterRequest } from './adapter-capabilities.js';
import type { AdapterAccessContext, AdapterCapabilities, AdapterRequest, QueryPlan, SearchMode } from '../domain/adapter-contracts.js';
import type { CampaignIntent, Immutable } from '../domain/campaign-intent.js';
import { SOURCE_TYPES } from '../domain/campaign.js';
import type { CampaignSpec, SourceType } from '../domain/campaign.js';

export const QUERY_PLANNER_VERSION = 'query-planner-v1' as const;
export type RequestBudgetUnit = 'ADAPTER_CALLS' | 'CONTROLLED_ACTIONS' | 'HTTP_REQUESTS';
export interface PlannerTarget {
  search_mode: SearchMode; source_type: SourceType; source_id: string | null;
  /** A caller-verified source identity reference, never a post seed or a permission grant. */
  source_evidence_ref: string | null; access_context: AdapterAccessContext;
}
export interface PlannerLimits { jobs: number | null; candidates: number | null; request_units: number | null; cost_units: number | null; }
export interface PlannerBudget {
  task: PlannerLimits; global_remaining: PlannerLimits;
  per_job: { candidates: number | null; request_units: number | null; cost_units: number | null };
  request_unit: RequestBudgetUnit | null; currency: string; cost_unit_scale: 1 | 100 | 1000 | 1000000;
  /** Upper-bound reservation basis for the ENTIRE job, including continuations/retries. */
  request_basis_ref: string | null; cost_basis_ref: string | null;
}
export interface PlannerContext {
  namespace: string; mode: 'FIXTURE' | 'LIVE'; geography_policy: 'POST_VALIDATE' | 'DEFER';
}
export type PlannerReason = 'UNSUPPORTED_MODE' | 'UNSUPPORTED_SOURCE' | 'UNSUPPORTED_SCOPE' | 'SOURCE_OUT_OF_SCOPE'
  | 'SOURCE_SCOPE_UNRESOLVED' | 'SOURCE_IDENTITY_UNVERIFIED' | 'TARGET_MODE_CONFLICT' | 'DUPLICATE_TARGET'
  | 'CAPABILITY_UNVERIFIED' | 'LIVE_CAPABILITY_REQUIRED' | 'LIVE_PERMISSION_REQUIRED' | 'ACCESS_DENIED' | 'LOGIN_REQUIRED'
  | 'EXACT_PHRASE_UNSUPPORTED' | 'LANGUAGE_FILTER_UNSUPPORTED' | 'DATE_FILTER_UNSUPPORTED' | 'GEOGRAPHY_UNRESOLVED'
  | 'GEOGRAPHY_POST_VALIDATION_REQUIRED' | 'CAMPAIGN_BUDGET_UNRESOLVED' | 'BUDGET_UNRESOLVED'
  | 'RESERVATION_BASIS_UNKNOWN' | 'CURRENCY_MISMATCH' | 'CAMPAIGN_COST_NOT_REPRESENTABLE'
  | 'JOB_BUDGET_EXHAUSTED' | 'CANDIDATE_BUDGET_EXHAUSTED' | 'REQUEST_BUDGET_EXHAUSTED' | 'COST_BUDGET_EXHAUSTED';
export interface PlannerDecision {
  lineage_id: string; target_index: number; outcome: 'PLANNED' | 'REJECTED' | 'DEFERRED';
  reasons: PlannerReason[]; job_id: string | null;
}
export interface PlannedQueryJob {
  job_id: string; lineage_id: string; target_index: number;
  request_template: { query: Omit<QueryPlan, 'run_id'>; access_context: AdapterAccessContext };
  reservation: { candidates: number; request_units: number; cost_units: number };
  geography_handling: 'NO_REQUIRED_FILTER' | 'POST_VALIDATE';
  expected_capture_mode: PlannerContext['mode'];
}
export interface OfflineQueryPlan {
  version: typeof QUERY_PLANNER_VERSION; plan_id: string; execution_authorized: false;
  planning_status: 'PLANNED' | 'NO_JOBS'; context: PlannerContext;
  binding: { campaign_sha256: string; proposals_sha256: string; capability_sha256: string; configuration_sha256: string };
  campaign_snapshot: Immutable<CampaignSpec>; capability_snapshot: AdapterCapabilities;
  budget_configuration: PlannerBudget; targets: PlannerTarget[];
  effective_budget: { jobs: number; candidates: number; request_units: number; cost_units: number } | null;
  allocation: { jobs: number; candidates: number; request_units: number; cost_units: number };
  lineage_catalog: { lineage_id: string; parent_lineage_id: string | null; proposal: Immutable<ExpandedQuery> }[];
  jobs: PlannedQueryJob[]; decisions: PlannerDecision[];
  source_coverage: { planned_types: SourceType[]; required_without_jobs: SourceType[]; unresolved_requirements: SourceType[]; valid_source_mix_proven: false };
  validation_policy: 'ALL_CAMPAIGN_CONDITIONS_BEFORE_VALID_UNIQUE_COUNT';
  unallocated_dimensions: readonly ['WALL_TIME', 'OPERATOR_TIME', 'STORAGE'];
  warnings: string[];
}
export interface PlannerInput {
  intent: Immutable<CampaignIntent>; proposals: Immutable<QueryExpansionResult>; capability: AdapterCapabilities;
  targets: readonly PlannerTarget[]; context: PlannerContext; budget: PlannerBudget;
}
function fail(code: 'PLANNER_INPUT_INVALID' | 'PLANNER_CAPABILITY_INVALID' | 'PLANNER_PROPOSALS_INVALID'): never { throw new Error(code); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const enumValue = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);
const ref = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_:/.\-]{0,255}$/.test(value);
const nullableRef = (value: unknown) => value === null || ref(value);
const counter = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as Immutable<T>;
}
const MODES = ['POST_SEARCH', 'SOURCE_DISCOVERY', 'SOURCE_FEED', 'GROUP_POST_SEARCH'] as const;
const FILTERS = ['published_from', 'published_to', 'language'] as const;
function capabilityValid(c: AdapterCapabilities) {
  const list = (value: unknown, allowed: readonly string[]) => Array.isArray(value) && value.length <= allowed.length
    && value.every(item => enumValue(item, allowed)) && new Set(value).size === value.length;
  if (!object(c) || !keys(c, ['adapter_id', 'adapter_version', 'contract_version', 'platform', 'collection_scopes', 'search_modes',
    'source_types', 'filters_by_mode', 'pagination', 'authentication', 'readable_fields', 'permalink_verification', 'checkpoint_resumption', 'verification'])
    || !ref(c.adapter_id) || !ref(c.adapter_version) || c.contract_version !== '1.0.0' || c.platform !== 'FACEBOOK'
    || !list(c.collection_scopes, ['PUBLIC_DISCOVERY', 'JOINED_GROUPS']) || !list(c.search_modes, MODES) || !list(c.source_types, SOURCE_TYPES)
    || !object(c.filters_by_mode) || Object.entries(c.filters_by_mode).some(([mode, filters]) => !MODES.includes(mode as SearchMode) || !list(filters, FILTERS))
    || !enumValue(c.verification, ['UNKNOWN', 'FIXTURE_ONLY', 'LIVE_VERIFIED']) || !enumValue(c.authentication, ['ANONYMOUS', 'USER_SESSION'])
    || !enumValue(c.pagination, ['CURSOR', 'NONE']) || !enumValue(c.checkpoint_resumption, ['SAME_INSTANCE', 'DURABLE', 'NONE'])
    || typeof c.permalink_verification !== 'boolean' || !list(c.readable_fields, ['POST_ID', 'PERMALINK', 'TEXT', 'SOURCE_CONTEXT', 'PUBLISHED_AT'])) fail('PLANNER_CAPABILITY_INVALID');
}
function validateInput(input: PlannerInput) {
  try {
    if (!object(input) || !keys(input, ['intent', 'proposals', 'capability', 'targets', 'context', 'budget'])) fail('PLANNER_INPUT_INVALID');
    capabilityValid(input.capability);
    const { context, budget, targets } = input;
    if (!object(context) || !keys(context, ['namespace', 'mode', 'geography_policy']) || !ref(context.namespace)
      || !enumValue(context.mode, ['FIXTURE', 'LIVE']) || !enumValue(context.geography_policy, ['POST_VALIDATE', 'DEFER'])
      || !Array.isArray(targets) || !targets.length || targets.length > 16) fail('PLANNER_INPUT_INVALID');
    for (const target of targets) {
      if (!object(target) || !keys(target, ['search_mode', 'source_type', 'source_id', 'source_evidence_ref', 'access_context'])
        || !enumValue(target.search_mode, MODES) || !enumValue(target.source_type, SOURCE_TYPES)
        || !(target.source_id === null || typeof target.source_id === 'string' && /^[a-zA-Z0-9_.-]{1,256}$/.test(target.source_id))
        || !nullableRef(target.source_evidence_ref) || !validateAccessContext(target.access_context)) fail('PLANNER_INPUT_INVALID');
    }
    if (!object(budget) || !keys(budget, ['task', 'global_remaining', 'per_job', 'request_unit', 'currency', 'cost_unit_scale', 'request_basis_ref', 'cost_basis_ref'])
      || !(budget.request_unit === null || enumValue(budget.request_unit, ['ADAPTER_CALLS', 'CONTROLLED_ACTIONS', 'HTTP_REQUESTS']))
      || typeof budget.currency !== 'string' || !/^[A-Z]{3}$/.test(budget.currency) || ![1, 100, 1000, 1000000].includes(budget.cost_unit_scale)
      || !nullableRef(budget.request_basis_ref) || !nullableRef(budget.cost_basis_ref)) fail('PLANNER_INPUT_INVALID');
    for (const limits of [budget.task, budget.global_remaining]) {
      if (!object(limits) || !keys(limits, ['jobs', 'candidates', 'request_units', 'cost_units']) || !Object.values(limits).every(counter)
        || (limits.jobs !== null && Number(limits.jobs) > 512) || (limits.candidates !== null && Number(limits.candidates) > 10000000)) fail('PLANNER_INPUT_INVALID');
    }
    if (!object(budget.per_job) || !keys(budget.per_job, ['candidates', 'request_units', 'cost_units']) || !Object.values(budget.per_job).every(counter)
      || budget.per_job.request_units === 0 || (budget.per_job.candidates !== null && budget.per_job.candidates > 10000000)) fail('PLANNER_INPUT_INVALID');
    let rebuilt;
    try { rebuilt = expandCampaignQueries(input.intent, input.proposals.options); }
    catch { fail('PLANNER_PROPOSALS_INVALID'); }
    if (canonical(input.proposals) !== canonical(rebuilt)) fail('PLANNER_PROPOSALS_INVALID');
  } catch (error) {
    if (error instanceof Error && ['PLANNER_INPUT_INVALID', 'PLANNER_CAPABILITY_INVALID', 'PLANNER_PROPOSALS_INVALID'].includes(error.message)) throw error;
    fail('PLANNER_INPUT_INVALID');
  }
}
function costUnits(amount: number, scale: PlannerBudget['cost_unit_scale']): number | null {
  // Decimal serialization avoids 0.29 * 100 binary rounding and never rounds a cap up.
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e21) return null;
  const fixed = amount.toFixed(Math.log10(scale));
  if (Number(fixed) !== amount) return null;
  const units = Number(fixed.replace('.', ''));
  return Number.isSafeInteger(units) ? units : null;
}
function budgetFacts(campaign: Immutable<CampaignSpec>, budget: PlannerBudget) {
  const reasons: PlannerReason[] = [];
  if ([campaign.budgets.max_cost, campaign.budgets.max_requests, campaign.budgets.max_operator_minutes, campaign.budgets.max_storage_mb].some(value => value === null)) reasons.push('CAMPAIGN_BUDGET_UNRESOLVED');
  if ([...Object.values(budget.task), ...Object.values(budget.global_remaining), ...Object.values(budget.per_job), budget.request_unit].some(value => value === null)) reasons.push('BUDGET_UNRESOLVED');
  if (!budget.request_basis_ref || !budget.cost_basis_ref) reasons.push('RESERVATION_BASIS_UNKNOWN');
  if (budget.currency !== campaign.budgets.currency) reasons.push('CURRENCY_MISMATCH');
  const campaignCost = campaign.budgets.max_cost === null ? null : costUnits(campaign.budgets.max_cost, budget.cost_unit_scale);
  if (campaign.budgets.max_cost !== null && campaignCost === null) reasons.push('CAMPAIGN_COST_NOT_REPRESENTABLE');
  const effective = reasons.length ? null : {
    jobs: Math.min(budget.task.jobs!, budget.global_remaining.jobs!), candidates: Math.min(budget.task.candidates!, budget.global_remaining.candidates!),
    request_units: Math.min(budget.task.request_units!, budget.global_remaining.request_units!, campaign.budgets.max_requests!),
    cost_units: Math.min(budget.task.cost_units!, budget.global_remaining.cost_units!, campaignCost!),
  };
  return { reasons, effective };
}

/** Creates offline request templates. The trusted host must bind a run and recheck gates/budgets before execution. */
export function planQueries(input: PlannerInput): Immutable<OfflineQueryPlan> {
  validateInput(input);
  const { intent, proposals } = input;
  const capability = structuredClone(input.capability), targets = structuredClone(input.targets) as PlannerTarget[];
  const context = structuredClone(input.context), budget = structuredClone(input.budget), campaign = structuredClone(intent.source_snapshot);
  const binding = { campaign_sha256: hash(campaign), proposals_sha256: hash(proposals), capability_sha256: hash(capability),
    configuration_sha256: hash({ context, budget, targets }) };
  const id = hash({ version: QUERY_PLANNER_VERSION, binding }), lineageId = (local: string) => 'lineage:' + id + ':' + local;
  const lineage = proposals.queries.map(proposal => ({ lineage_id: lineageId(proposal.id),
    parent_lineage_id: proposal.provenance.parent_query_id === null ? null : lineageId(proposal.provenance.parent_query_id), proposal: structuredClone(proposal) }));
  const jobs: PlannedQueryJob[] = [], decisions: PlannerDecision[] = [];
  const allocation = { jobs: 0, candidates: 0, request_units: 0, cost_units: 0 };
  const { reasons: budgetReasons, effective } = budgetFacts(campaign, budget);
  const seenTargets = new Set<string>();
  const duplicateTargets = targets.map(target => {
    const key = canonical([target.search_mode, target.source_type, target.source_id, target.access_context]);
    const duplicate = seenTargets.has(key); seenTargets.add(key); return duplicate;
  });
  const ordered = [...proposals.queries].sort((a, b) => Number(a.depth !== 0) - Number(b.depth !== 0));
  for (const proposal of ordered) for (const [targetIndex, target] of targets.entries()) {
    const reasons: PlannerReason[] = [], rejected: PlannerReason[] = [];
    const scope = campaign.source_requirements[target.source_type];
    if (duplicateTargets[targetIndex]) rejected.push('DUPLICATE_TARGET');
    if (!capability.collection_scopes.includes(campaign.collection_scope)) rejected.push('UNSUPPORTED_SCOPE');
    if (!capability.source_types.includes(target.source_type)) rejected.push('UNSUPPORTED_SOURCE');
    if (!capability.search_modes.includes(target.search_mode) || target.search_mode === 'SOURCE_DISCOVERY') rejected.push('UNSUPPORTED_MODE');
    if (scope.in_scope === false) rejected.push('SOURCE_OUT_OF_SCOPE');
    if (scope.in_scope === null) reasons.push('SOURCE_SCOPE_UNRESOLVED');
    if (target.search_mode === 'POST_SEARCH' && (target.source_id !== null || target.source_evidence_ref !== null)
      || target.search_mode === 'GROUP_POST_SEARCH' && target.source_type !== 'PUBLIC_GROUP') rejected.push('TARGET_MODE_CONFLICT');
    if (['SOURCE_FEED', 'GROUP_POST_SEARCH'].includes(target.search_mode) && (!target.source_id || !target.source_evidence_ref)) reasons.push('SOURCE_IDENTITY_UNVERIFIED');
    if (target.access_context.source_permission === 'DENIED') rejected.push('ACCESS_DENIED');
    if (context.mode === 'LIVE' && target.access_context.source_permission !== 'ALLOWED') reasons.push('LIVE_PERMISSION_REQUIRED');
    if (capability.verification === 'UNKNOWN') reasons.push('CAPABILITY_UNVERIFIED');
    if (context.mode === 'LIVE' && capability.verification !== 'LIVE_VERIFIED') reasons.push('LIVE_CAPABILITY_REQUIRED');
    if (capability.authentication === 'USER_SESSION' && target.access_context.account_binding !== 'VERIFIED') reasons.push('LOGIN_REQUIRED');
    if (proposal.keyword_kind === 'EXACT_PHRASE') reasons.push('EXACT_PHRASE_UNSUPPORTED');
    const supported = capability.filters_by_mode[target.search_mode] ?? [], filters: QueryPlan['filters'] = {};
    if (campaign.workload.language !== null) {
      if (!supported.includes('language')) reasons.push('LANGUAGE_FILTER_UNSUPPORTED');
      else Object.assign(filters, { language: campaign.workload.language });
    }
    if (campaign.historical_window.mode === 'RANGE') {
      if (!supported.includes('published_from') || !supported.includes('published_to')) reasons.push('DATE_FILTER_UNSUPPORTED');
      else Object.assign(filters, { published_from: campaign.historical_window.from_utc!, published_to: campaign.historical_window.to_utc! });
    }
    if (campaign.workload.geography.mode === 'UNRESOLVED') reasons.push('GEOGRAPHY_UNRESOLVED');
    if (campaign.workload.geography.mode === 'INCLUDE' && context.geography_policy !== 'POST_VALIDATE') reasons.push('GEOGRAPHY_POST_VALIDATION_REQUIRED');
    reasons.push(...budgetReasons);
    if (!reasons.length && !rejected.length && effective) {
      if (allocation.jobs >= effective.jobs) reasons.push('JOB_BUDGET_EXHAUSTED');
      if (allocation.candidates >= effective.candidates || budget.per_job.candidates === 0) reasons.push('CANDIDATE_BUDGET_EXHAUSTED');
      if (budget.per_job.request_units! > effective.request_units - allocation.request_units) reasons.push('REQUEST_BUDGET_EXHAUSTED');
      if (budget.per_job.cost_units! > effective.cost_units - allocation.cost_units) reasons.push('COST_BUDGET_EXHAUSTED');
    }
    const decision: PlannerDecision = { lineage_id: lineageId(proposal.id), target_index: targetIndex,
      outcome: rejected.length ? 'REJECTED' : reasons.length ? 'DEFERRED' : 'PLANNED', reasons: [...new Set([...rejected, ...reasons])], job_id: null };
    if (decision.outcome === 'PLANNED' && effective) {
      const candidateAllocation = Math.min(budget.per_job.candidates!, effective.candidates - allocation.candidates);
      const queryId = 'query:' + id + ':t' + targetIndex + ':' + proposal.id;
      const query: Omit<QueryPlan, 'run_id'> = { query_id: queryId, parent_query_id: proposal.provenance.parent_query_id === null ? null : lineageId(proposal.provenance.parent_query_id),
        expansion_reason: proposal.depth === 0 ? null : proposal.provenance.reason, policy_version: proposals.policy_version ?? proposals.version,
        adapter_id: capability.adapter_id, adapter_version: capability.adapter_version, collection_scope: campaign.collection_scope,
        search_mode: target.search_mode, source_type: target.source_type, source_id: target.source_id, keyword: proposal.text, filters,
        priority: ordered.length * targets.length - decisions.length, budget: { max_candidates: candidateAllocation } };
      // A fixed internal sentinel checks contract shape only. It is never returned as a run binding.
      const check: AdapterRequest = { query: { ...query, run_id: 'planner:shape-check-only' }, access_context: target.access_context };
      if (validateAdapterRequest(capability, check)) fail('PLANNER_INPUT_INVALID');
      const job: PlannedQueryJob = { job_id: 'job:' + id + ':t' + targetIndex + ':' + proposal.id, lineage_id: lineageId(proposal.id), target_index: targetIndex,
        request_template: { query, access_context: structuredClone(target.access_context) },
        reservation: { candidates: candidateAllocation, request_units: budget.per_job.request_units!, cost_units: budget.per_job.cost_units! },
        geography_handling: campaign.workload.geography.mode === 'INCLUDE' ? 'POST_VALIDATE' : 'NO_REQUIRED_FILTER', expected_capture_mode: context.mode };
      jobs.push(job); decision.job_id = job.job_id;
      allocation.jobs++; allocation.candidates += candidateAllocation; allocation.request_units += job.reservation.request_units; allocation.cost_units += job.reservation.cost_units;
    }
    decisions.push(decision);
  }
  const plannedTypes = SOURCE_TYPES.filter(type => jobs.some(job => job.request_template.query.source_type === type));
  return freeze({ version: QUERY_PLANNER_VERSION, plan_id: 'plan:' + id, execution_authorized: false,
    planning_status: jobs.length ? 'PLANNED' : 'NO_JOBS', context, binding, campaign_snapshot: campaign, capability_snapshot: capability,
    budget_configuration: budget, targets, effective_budget: effective, allocation, lineage_catalog: lineage, jobs, decisions,
    source_coverage: { planned_types: plannedTypes, required_without_jobs: SOURCE_TYPES.filter(type => campaign.source_requirements[type].in_scope === true
      && typeof campaign.source_requirements[type].minimum_valid_unique_posts === 'number'
      && campaign.source_requirements[type].minimum_valid_unique_posts! > 0 && !plannedTypes.includes(type)),
      unresolved_requirements: SOURCE_TYPES.filter(type => campaign.source_requirements[type].in_scope === null || campaign.source_requirements[type].minimum_valid_unique_posts === null),
      valid_source_mix_proven: false }, validation_policy: 'ALL_CAMPAIGN_CONDITIONS_BEFORE_VALID_UNIQUE_COUNT',
    unallocated_dimensions: ['WALL_TIME', 'OPERATOR_TIME', 'STORAGE'],
    warnings: ['PLAN_IS_NOT_EXECUTION_AUTHORIZATION', 'REQUEST_UNITS_ARE_NOT_POST_COUNTS',
      ...(context.mode === 'FIXTURE' && targets.some(target => target.access_context.source_permission === 'UNKNOWN') ? ['FIXTURE_SOURCE_PERMISSION_REMAINS_UNKNOWN'] : [])] });
}
