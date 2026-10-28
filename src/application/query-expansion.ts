import { normalizeIntentText } from './campaign-intent.js';
import { INTENT_MODEL_VERSION, INTENT_NORMALIZATION_VERSION } from '../domain/campaign-intent.js';
import type { CampaignIntent, Immutable, IntentKeyword } from '../domain/campaign-intent.js';

export const QUERY_EXPANSION_VERSION = 'coffee-query-expansion-v1' as const;
export const QUERY_EXPANSION_LIMITS = Object.freeze({ queries: 512, depth: 3, candidate_checks: 10000,
  keywords: 128, places: 32, allowlist: 256, text_length: 1024 });
export const EXPANSION_STRATEGIES = ['COFFEE_SPELLING', 'INTENT_PHRASING', 'CONFIGURED_PLACE'] as const;
export type ExpansionStrategy = typeof EXPANSION_STRATEGIES[number];
export interface QueryExpansionOptions {
  max_queries: number; max_depth: number; max_candidate_checks: number;
  strategies: Record<ExpansionStrategy, boolean>;
}
export interface ExpandedQuery {
  /** IDs are local to this expansion result, not global post or query identities. */
  id: string; text: string; case_key: string; depth: number;
  keyword_kind: IntentKeyword['kind']; raw_keyword: string;
  provenance: {
    root_keyword_id: string; parent_query_id: string | null;
    strategy: ExpansionStrategy | 'ORIGINAL'; strategy_version: string;
    reason: 'CAMPAIGN_KEYWORD' | 'COFFEE_SPELLING_VARIANT' | 'INTENT_PHRASE_VARIANT' | 'CONFIGURED_PLACE_ADDED';
    rule_id: string; source_refs: string[]; declaration_ref: string | null;
  };
}
export interface QueryExpansionResult {
  version: typeof QUERY_EXPANSION_VERSION;
  campaign_id: string; contract_version: string; intent_model_version: string; normalization_version: string;
  mode: CampaignIntent['source_snapshot']['discovery_policy']['expansion'];
  policy_version: string | null;
  options: QueryExpansionOptions;
  queries: ExpandedQuery[];
  report: {
    stop_reason: 'DISABLED' | 'STRATEGIES_DISABLED' | 'UNEVALUATED_EXCLUSIONS' | 'GEOGRAPHY_UNRESOLVED'
      | 'QUERY_LIMIT' | 'DEPTH_LIMIT' | 'CANDIDATE_LIMIT' | 'EXHAUSTED';
    candidate_checks: number; duplicate_candidates: number; allowlist_filtered: number; oversize_candidates: number;
    protected_keyword_ids: string[]; unrecognized_keyword_ids: string[];
    unemitted_allowlist_refs: string[];
  };
  /** Query proposals do not implement post filters, source access or a run budget. */
  filter_semantics: 'UNCHANGED_USE_CAMPAIGN_SNAPSHOT';
  external_services_used: false;
}
type ErrorCode = 'EXPANSION_OPTIONS_INVALID' | 'EXPANSION_INTENT_INVALID' | 'EXPANSION_INPUT_LIMIT'
  | 'EXPANSION_SEEDS_EXCEED_QUERY_LIMIT';
function fail(code: ErrorCode): never { throw new Error(code); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as Immutable<T>;
}
function optionsFrom(value: unknown): QueryExpansionOptions {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'max_candidate_checks,max_depth,max_queries,strategies') fail('EXPANSION_OPTIONS_INVALID');
  const strategies = value.strategies;
  if (!object(strategies) || Object.keys(strategies).sort().join(',') !== [...EXPANSION_STRATEGIES].sort().join(',')
    || EXPANSION_STRATEGIES.some(key => typeof strategies[key] !== 'boolean')) fail('EXPANSION_OPTIONS_INVALID');
  for (const [key, min, max] of [['max_queries', 1, QUERY_EXPANSION_LIMITS.queries],
    ['max_depth', 0, QUERY_EXPANSION_LIMITS.depth], ['max_candidate_checks', 0, QUERY_EXPANSION_LIMITS.candidate_checks]] as const) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max) fail('EXPANSION_OPTIONS_INVALID');
  }
  return { max_queries: value.max_queries as number, max_depth: value.max_depth as number,
    max_candidate_checks: value.max_candidate_checks as number,
    strategies: { COFFEE_SPELLING: strategies.COFFEE_SPELLING as boolean,
      INTENT_PHRASING: strategies.INTENT_PHRASING as boolean, CONFIGURED_PLACE: strategies.CONFIGURED_PLACE as boolean } };
}
function text(raw: string) {
  if (typeof raw !== 'string') fail('EXPANSION_INTENT_INVALID');
  if (raw.length > QUERY_EXPANSION_LIMITS.text_length) fail('EXPANSION_INPUT_LIMIT');
  const normalized = normalizeIntentText(raw);
  if (normalized.canonical.length > QUERY_EXPANSION_LIMITS.text_length) fail('EXPANSION_INPUT_LIMIT');
  return normalized;
}
interface Place { text: string; key: string; source_ref: string; }
interface Allowlisted { text: string; key: string; source_ref: string; }
function inspect(model: Immutable<CampaignIntent>) {
  try {
    const campaign = model.source_snapshot, policy = campaign.discovery_policy, geo = campaign.workload.geography;
    if (model.model_version !== INTENT_MODEL_VERSION || model.normalization_version !== INTENT_NORMALIZATION_VERSION
      || model.interpretation !== 'EXPLICIT_STRUCTURE_ONLY' || model.provenance.kind !== 'CAMPAIGN_SPEC'
      || model.provenance.campaign_id !== campaign.campaign_id || model.provenance.contract_version !== campaign.contract_version
      || campaign.platform !== 'FACEBOOK' || campaign.collection_scope !== 'PUBLIC_DISCOVERY'
      || !['DISABLED', 'FROZEN_ALLOWLIST', 'BOUNDED_INTENT'].includes(policy.expansion)
      || (policy.expansion === 'BOUNDED_INTENT' ? policy.expansion_rule_version !== 'coffee-intent-v1' : policy.expansion_rule_version !== null)
      || !['ANY', 'INCLUDE', 'UNRESOLVED'].includes(geo.mode) || model.geography.mode !== geo.mode
      || !Array.isArray(model.keywords) || !model.keywords.length || !Array.isArray(campaign.workload.keywords)
      || model.keywords.length !== campaign.workload.keywords.length
      || !Array.isArray(geo.places) || !Array.isArray(geo.preferred_places) || !Array.isArray(policy.allowed_expansions)
      || !Array.isArray(campaign.workload.exclusions)) fail('EXPANSION_INTENT_INVALID');
    if (model.keywords.length > QUERY_EXPANSION_LIMITS.keywords || geo.places.length + geo.preferred_places.length > QUERY_EXPANSION_LIMITS.places
      || policy.allowed_expansions.length > QUERY_EXPANSION_LIMITS.allowlist) fail('EXPANSION_INPUT_LIMIT');
    const seen = new Set<string>();
    for (const [index, keyword] of model.keywords.entries()) {
      const normalized = text(campaign.workload.keywords[index]!);
      const path = 'workload.keywords[' + index + ']';
      if (keyword.id !== path || keyword.origin.source_path !== path || !['KEYWORD', 'BRAND', 'EXACT_PHRASE'].includes(keyword.kind)
        || keyword.text.raw !== normalized.raw || keyword.text.canonical !== normalized.canonical || keyword.text.case_key !== normalized.case_key
        || seen.has(normalized.case_key)) fail('EXPANSION_INTENT_INVALID');
      seen.add(normalized.case_key);
    }
    // INCLUDE never borrows preferred places outside the actual required locations.
    const field = geo.mode === 'INCLUDE' ? 'places' : 'preferred_places';
    const configuredPlaces: Place[] = geo[field].map((raw, index) => {
      const normalized = text(raw);
      return { text: normalized.canonical, key: normalized.case_key, source_ref: 'workload.geography.' + field + '[' + index + ']' };
    });
    const uniquePlaces = configuredPlaces.filter((place, index) => configuredPlaces.findIndex(other => other.key === place.key) === index);
    const allowed: Allowlisted[] = policy.allowed_expansions.map((raw, index) => {
      const normalized = text(raw);
      return { text: normalized.canonical, key: normalized.case_key, source_ref: 'discovery_policy.allowed_expansions[' + index + ']' };
    });
    if ((policy.expansion === 'FROZEN_ALLOWLIST') !== (allowed.length > 0)) fail('EXPANSION_INTENT_INVALID');
    return { campaign, policy, places: uniquePlaces, allowed };
  } catch (error) {
    if (error instanceof Error && ['EXPANSION_INPUT_LIMIT', 'EXPANSION_INTENT_INVALID'].includes(error.message)) throw error;
    fail('EXPANSION_INTENT_INVALID');
  }
}

// Closed full-query grammar: never rewrite an arbitrary substring inside a brand,
// negative condition, URL or a keyword merely containing "cafe".
const COFFEE = ['cà phê', 'cafe', 'café', 'coffee'] as const;
const PHRASES = [
  { id: 'bare', group: 'bare', value: '{coffee}' },
  { id: 'venue', group: 'venue', value: 'quán {coffee}' }, { id: 'shop', group: 'venue', value: 'tiệm {coffee}' },
  { id: 'find', group: 'find', value: 'tìm quán {coffee}' }, { id: 'suggest', group: 'find', value: 'gợi ý quán {coffee}' },
  { id: 'review', group: 'review', value: 'review quán {coffee}' }, { id: 'assess', group: 'review', value: 'đánh giá quán {coffee}' },
  { id: 'place', group: 'place', value: 'địa điểm đi {coffee}' }, { id: 'where', group: 'place', value: 'đi {coffee} ở đâu' },
  { id: 'date', group: 'date', value: 'quán {coffee} hẹn hò' }, { id: 'dating', group: 'date', value: 'hẹn hò tại quán {coffee}' },
  { id: 'event', group: 'event', value: 'sự kiện tại quán {coffee}' }, { id: 'events', group: 'event', value: 'sự kiện ở quán {coffee}' },
] as const;
interface Grammar { phrase: number; spelling: number; place: Place | null; }
const render = (state: Grammar) => PHRASES[state.phrase]!.value.replace('{coffee}', COFFEE[state.spelling]!) + (state.place ? ' ' + state.place.text : '');
function grammar(places: Place[]): Map<string, Grammar> {
  const map = new Map<string, Grammar>();
  for (let phrase = 0; phrase < PHRASES.length; phrase++) for (let spelling = 0; spelling < COFFEE.length; spelling++) {
    for (const place of [null, ...places]) {
      const state = { phrase, spelling, place }, rendered = render(state);
      // An input place can fit the text cap while the composed query does not.
      // It cannot match an admissible seed; do not let it break disabled fallback.
      if (rendered.length > QUERY_EXPANSION_LIMITS.text_length) continue;
      const key = text(rendered).case_key;
      if (!map.has(key)) map.set(key, state);
    }
  }
  return map;
}
interface Proposal { state: Grammar; strategy: ExpansionStrategy; reason: ExpandedQuery['provenance']['reason']; rule: string; refs: string[]; }
function* propose(state: Grammar, options: QueryExpansionOptions, places: Place[]): Generator<Proposal> {
  if (options.strategies.COFFEE_SPELLING) for (let spelling = 0; spelling < COFFEE.length; spelling++) {
    if (spelling !== state.spelling) yield { state: { ...state, spelling }, strategy: 'COFFEE_SPELLING', reason: 'COFFEE_SPELLING_VARIANT',
      rule: COFFEE[state.spelling] + '->' + COFFEE[spelling], refs: [] };
  }
  if (options.strategies.INTENT_PHRASING) for (let phrase = 0; phrase < PHRASES.length; phrase++) {
    if (phrase !== state.phrase && PHRASES[phrase]!.group === PHRASES[state.phrase]!.group) yield { state: { ...state, phrase },
      strategy: 'INTENT_PHRASING', reason: 'INTENT_PHRASE_VARIANT', rule: PHRASES[state.phrase]!.id + '->' + PHRASES[phrase]!.id, refs: [] };
  }
  if (options.strategies.CONFIGURED_PLACE && state.place === null) for (const place of places) {
    yield { state: { ...state, place }, strategy: 'CONFIGURED_PLACE', reason: 'CONFIGURED_PLACE_ADDED', rule: 'append-configured-place', refs: [place.source_ref] };
  }
}

/** Pure offline proposals. Call with a validated P03.01 model; execution/filtering belong to later tasks. */
export function expandCampaignQueries(model: Immutable<CampaignIntent>, inputOptions: unknown): Immutable<QueryExpansionResult> {
  const options = optionsFrom(inputOptions), { campaign, policy, places, allowed } = inspect(model);
  if (model.keywords.length > options.max_queries) fail('EXPANSION_SEEDS_EXCEED_QUERY_LIMIT');
  const lookup = grammar(places), queries: ExpandedQuery[] = [], states: (Grammar | null)[] = [];
  const keys = new Set<string>(), allowedByKey = new Map<string, Allowlisted>();
  for (const entry of allowed) if (!allowedByKey.has(entry.key)) allowedByKey.set(entry.key, entry);
  const report: QueryExpansionResult['report'] = { stop_reason: 'EXHAUSTED', candidate_checks: 0, duplicate_candidates: 0,
    allowlist_filtered: 0, oversize_candidates: 0, protected_keyword_ids: [], unrecognized_keyword_ids: [], unemitted_allowlist_refs: [] };
  for (const keyword of model.keywords) {
    const state = keyword.kind === 'KEYWORD' ? lookup.get(keyword.text.case_key) ?? null : null;
    if (keyword.kind !== 'KEYWORD') report.protected_keyword_ids.push(keyword.id);
    else if (!state) report.unrecognized_keyword_ids.push(keyword.id);
    states.push(state); keys.add(keyword.text.case_key);
    queries.push({ id: 'q' + queries.length, text: keyword.text.canonical, case_key: keyword.text.case_key, depth: 0,
      keyword_kind: keyword.kind, raw_keyword: keyword.text.raw,
      provenance: { root_keyword_id: keyword.id, parent_query_id: null, strategy: 'ORIGINAL', strategy_version: QUERY_EXPANSION_VERSION,
        reason: 'CAMPAIGN_KEYWORD', rule_id: 'retain-original', source_refs: [keyword.origin.source_path], declaration_ref: keyword.origin.declaration_ref } });
  }
  const finish = (): Immutable<QueryExpansionResult> => {
    report.unemitted_allowlist_refs = allowed.filter(entry => !keys.has(entry.key)).map(entry => entry.source_ref);
    return freeze({ version: QUERY_EXPANSION_VERSION, campaign_id: campaign.campaign_id, contract_version: campaign.contract_version,
      intent_model_version: model.model_version, normalization_version: model.normalization_version,
      mode: policy.expansion, policy_version: policy.expansion_rule_version, options, queries, report,
      filter_semantics: 'UNCHANGED_USE_CAMPAIGN_SNAPSHOT', external_services_used: false });
  };
  if (policy.expansion === 'DISABLED') { report.stop_reason = 'DISABLED'; return finish(); }
  if (!EXPANSION_STRATEGIES.some(key => options.strategies[key])) { report.stop_reason = 'STRATEGIES_DISABLED'; return finish(); }
  // These free-text conditions are NOT_EVALUATED in P03.01; do not pretend to interpret them.
  if (campaign.workload.exclusions.length) { report.stop_reason = 'UNEVALUATED_EXCLUSIONS'; return finish(); }
  if (campaign.workload.geography.mode === 'UNRESOLVED') { report.stop_reason = 'GEOGRAPHY_UNRESOLVED'; return finish(); }
  let depthBoundary = false;
  outer: for (let index = 0; index < queries.length; index++) {
    const parent = queries[index]!, state = states[index];
    if (!state) continue;
    if (parent.depth >= options.max_depth) { depthBoundary = true; continue; }
    for (const candidate of propose(state, options, places)) {
      if (queries.length >= options.max_queries) { report.stop_reason = 'QUERY_LIMIT'; break outer; }
      if (report.candidate_checks >= options.max_candidate_checks) { report.stop_reason = 'CANDIDATE_LIMIT'; break outer; }
      report.candidate_checks++;
      const rendered = render(candidate.state);
      if (rendered.length > QUERY_EXPANSION_LIMITS.text_length) { report.oversize_candidates++; continue; }
      const normalized = text(rendered);
      if (keys.has(normalized.case_key)) { report.duplicate_candidates++; continue; }
      const allowlisted = allowedByKey.get(normalized.case_key);
      if (policy.expansion === 'FROZEN_ALLOWLIST' && !allowlisted) { report.allowlist_filtered++; continue; }
      const sourceRefs = [...parent.provenance.source_refs, ...candidate.refs];
      if (policy.expansion === 'FROZEN_ALLOWLIST') sourceRefs.push(allowlisted!.source_ref);
      const value = policy.expansion === 'FROZEN_ALLOWLIST' ? allowlisted!.text : normalized.canonical;
      queries.push({ id: 'q' + queries.length, text: value, case_key: normalized.case_key, depth: parent.depth + 1,
        keyword_kind: parent.keyword_kind, raw_keyword: parent.raw_keyword,
        provenance: { root_keyword_id: parent.provenance.root_keyword_id, parent_query_id: parent.id, strategy: candidate.strategy,
          strategy_version: QUERY_EXPANSION_VERSION + '/' + candidate.strategy, reason: candidate.reason, rule_id: candidate.rule,
          source_refs: [...new Set(sourceRefs)], declaration_ref: parent.provenance.declaration_ref } });
      states.push(candidate.state); keys.add(normalized.case_key);
    }
  }
  if (report.stop_reason === 'EXHAUSTED' && depthBoundary) report.stop_reason = 'DEPTH_LIMIT';
  return finish();
}
