import { campaignFromModel, plannerRecipeHash, literalCampaign } from './compile-campaign.js';
import { campaignVersion, INTENT_OPPORTUNITY_FILTER_VERSION, SEMANTIC_PLANNER_POLICY, validateCampaignPlan } from '../domain/campaign-plan.js';
import type { CampaignPlan, CampaignPlanInput } from '../domain/campaign-plan.js';
import { modelRequest, validateResult } from '../domain/semantic-keywords.mjs';
import type { IntentInput, IntentPlan } from '../shared/semantic-intent.js';
import type { JsonModelResult, ModelGateway } from './ports/model-gateway.js';
import { GOAL_FILTER_VERSION } from '../domain/goal-filter.js';
import { literalTopicPlan } from './literal-topic-plan.js';
import { OPPORTUNITY_PLANNER_POLICY, DISCOVERY_FAMILIES, DISCOVERY_VERSION, MAX_DISCOVERY_QUERIES, discoveryWaves } from '../domain/discovery-contract.js';
import { modelRequest as discoveryRequest, validateResult as validateDiscoveryResult } from '../domain/opportunity-keywords.mjs';
import { MAX_RESULT_TARGET, MAX_RAW_POSTS } from '../shared/collection-limits.js';

/** Project a validated intent into the CSD campaign/storage contract. */
export function semanticCampaign(input: CampaignPlanInput, intent: IntentInput, plan: IntentPlan): CampaignPlan {
  if (plan.state !== 'READY' || plan.unresolved_fields.length || plan.uncovered.length) throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  const field = (name: string) => plan.intent.filter(item => item.field === name && item.status === 'CONFIRMED').map(item => item.value);
  const discovery = input.planner_policy === OPPORTUNITY_PLANNER_POLICY;
  if (discovery && ((input.suitable_target ?? 1000) > MAX_RESULT_TARGET || (input.raw_cap ?? 20000) > MAX_RAW_POSTS)) throw Error('DISCOVERY_LIMIT_INVALID');
  const limits = plan.intent.filter(item => ['geography', 'time'].includes(item.field) && item.status === 'CONFIRMED')
    .filter(item => !discovery || item.evidence.some(e => /(?:\b(?:only|must)\b|(?:^|\s)chỉ\s|bắt buộc)/iu.test(e.quote)
      && !/không chỉ|not only/iu.test(e.quote)))
    .filter(item => !item.evidence.some(evidence => plan.constraints.some(constraint => constraint.source === evidence.source && constraint.quote === evidence.quote)))
    .map(item => item.value);
  const campaign = campaignFromModel({ ...input, planner_policy: 'legacy-short-v1' }, {
    topic: plan.understanding.slice(0, 300), audience: field('target_roles'), needs: field('purpose'),
    participation_intents: field('purpose'), research_intents: [],
    // Keep natural-language limits intact; do not guess numeric dates or split place names.
    inclusions: [...field('include'), ...field('topics'), ...limits,
      ...plan.constraints.map(item => item.strength === 'PREFERRED' ? 'Ưu tiên, không bắt buộc: ' + item.text : item.text)],
    exclusions: field('exclude'), assumptions: [...plan.caveats, ...plan.unconfirmed_assumptions].slice(0, 20),
    queries: plan.queries.filter(query => !query.rejection).map(query => ({ text: query.text, family: 'BROAD' })),
  }, undefined, true);
  campaign.planner_policy = discovery ? OPPORTUNITY_PLANNER_POLICY : SEMANTIC_PLANNER_POLICY;
  campaign.filter_version = GOAL_FILTER_VERSION;
  campaign.intent_resolution = { schema_version: 1, input: structuredClone(intent), plan: structuredClone(plan), recipe_hash: plannerRecipeHash(campaign.planner_policy) };
  if (discovery) {
    if (!plan.original_facets || !plan.coverage) throw Error('DISCOVERY_COVERAGE_REQUIRED');
    const queries = discoveryWaves(plan.queries.filter(q => !q.rejection).map(q => {
      if (!q.family_id || !q.facet_ids?.length) throw Error('DISCOVERY_QUERY_LINEAGE_REQUIRED');
      return { text: q.text, family_id: q.family_id, facet_ids: q.facet_ids, origin: q.origin ?? 'MODEL', rationale: q.rationale };
    }));
    campaign.discovery_plan = { version: DISCOVERY_VERSION, evidence_scope: 'POST_ONLY', facets: structuredClone(plan.original_facets),
      coverage: structuredClone(plan.coverage), queries, max_queries: MAX_DISCOVERY_QUERIES, initial_wave: 0 };
    campaign.queries = queries.map(q => ({ text: q.text, family: DISCOVERY_FAMILIES.find(f => f[0] === q.family_id)![2],
      platforms: ['threads', 'facebook'], query_id: q.query_id, family_id: q.family_id, facet_ids: q.facet_ids, wave: q.wave }));
    campaign.budget = { ...campaign.budget, raw_cap: input.raw_cap ?? Math.max(20000, campaign.suitable_target * 4),
      max_run_minutes: input.max_run_minutes ?? 720, comments_per_capture: 0, comment_pages: 0 };
    campaign.watch = { enabled: false, revisit_hours: [], ttl_hours: 72, max_attempts: 0 };
    campaign.languages = input.languages ?? ['vi'];
    const geography = plan.intent.find(f => f.field === 'geography' && f.status === 'CONFIRMED');
    if (geography && !/không giới hạn|không xác định|unspecified|unrestricted/iu.test(geography.value)) {
      const hard = geography.evidence.some(e => /(?:\b(?:only|must)\b|(?:^|\s)chỉ\s|bắt buộc)/iu.test(e.quote)
        && !/không chỉ|not only/iu.test(e.quote));
      if (input.required_geographies === undefined && hard) campaign.required_geographies = [geography.value];
      else if (input.preferred_geographies === undefined && !hard) campaign.preferred_geographies = [geography.value];
    }
    campaign.max_age_days = input.max_age_days ?? null;
    const time = plan.intent.find(f => f.field === 'time' && f.status === 'CONFIRMED');
    if (input.max_age_days === undefined && time) for (const e of time.evidence) {
      if (/ưu tiên|prefer|không giới hạn|no age limit|ngày tới|tuần tới|\bnext\b/iu.test(e.quote)) continue;
      // A consumer's schedule is not a publication-age limit. Only explicit post-age wording can narrow it.
      const age = /(?:bài\s+(?:viết|đăng)|posts?)\s+(?:(?:được\s+)?đăng\s+|published\s+|from\s+|in\s+|the\s+)*(?:trong\s+(?:vòng\s+)?|last\s+|past\s+)(\d+)\s*(ngày|tuần|days?|weeks?)/iu.exec(e.quote);
      if (age) campaign.max_age_days = Number(age[1]) * (/tuần|week/iu.test(age[2]!) ? 7 : 1);
    }
  }
  const { version: _version, created_at: _created, ...base } = campaign;
  campaign.version = campaignVersion(base); validateCampaignPlan(campaign); return campaign;
}

export async function compileSemanticTurn(input: CampaignPlanInput, intent: IntentInput, gateway: ModelGateway,
  options: { signal?: AbortSignal; cacheNamespace?: string;
    recordedAttempts?: { result: JsonModelResult; requestInput: unknown }[];
    onAttempt?: (attempt: { result: JsonModelResult; validation: string | null; validationDetails?: unknown; recovery?: string; requestInput: unknown }) => void } = {}) {
  literalCampaign({ ...input, planner_policy: 'legacy-short-v1' }); // Validate local limits before billing.
  const discovery = input.planner_policy === OPPORTUNITY_PLANNER_POLICY;
  if (discovery && ((input.suitable_target ?? 1000) > MAX_RESULT_TARGET || (input.raw_cap ?? 20000) > MAX_RAW_POSTS)) throw Error('DISCOVERY_LIMIT_INVALID');
  const validate = discovery ? validateDiscoveryResult : validateResult;
  for (const recorded of options.recordedAttempts ?? []) {
    let plan: IntentPlan, campaign: CampaignPlan | null;
    try { plan = validate(recorded.result.value, 'B', intent, {}); campaign = plan.state === 'READY' ? semanticCampaign(input, intent, plan) : null; }
    catch { continue; } // Invalid saved responses still require bounded repair.
    const result = { ...recorded.result, cache_hit: true, elapsed_ms: 0 };
    options.onAttempt?.({ result, validation: null, recovery: 'RECORDED_VALIDATED_RESPONSE', requestInput: recorded.requestInput });
    return { plan, campaign, model_result: result, recovery: 'RECORDED_VALIDATED_RESPONSE' as const };
  }
  let repair: unknown;
  for (let round = 0; round < 2; round++) {
    const request = (discovery ? discoveryRequest : modelRequest)('B', { ...intent,
      ...(discovery ? { discovery_target: input.suitable_target ?? 1000 } : {}), ...(repair ? { validation_repair: repair } : {}) }, {});
    // Transport/auth/budget failures are not semantic retries.
    const result = await gateway.generateJson({ purpose: discovery ? 'campaign-planner-v3.0.0-opportunity-coverage' : 'campaign-planner-v2.0.0-semantic-dialogue', system: request.system,
      schema: request.schema, input: request.input, max_output_tokens: request.maxOutputTokens,
      ...(options.cacheNamespace ? { cache_namespace: options.cacheNamespace } : {}),
      ...(options.signal ? { signal: options.signal } : {}) });
    let plan: IntentPlan, campaign: CampaignPlan | null;
    try {
      plan = validate(result.value, 'B', intent, {});
      campaign = plan.state === 'READY' ? semanticCampaign(input, intent, plan) : null;
    } catch (error) {
      const detail = error as Error & { details?: unknown };
      const diagnostic = detail.details as { code?: string; fields?: { field: string }[] } | undefined;
      // Preserve strict evidence validation. An explicit topic list can be rebuilt from
      // user text instead of accepting invented author roles or charging for that repair.
      const local = !discovery && diagnostic?.code === 'INTENT_FIELD_EVIDENCE' && diagnostic.fields?.length
        && diagnostic.fields.every(field => field.field === 'target_roles') ? literalTopicPlan(intent) : null;
      if (local) {
        const campaign = semanticCampaign(input, intent, local);
        options.onAttempt?.({ result, validation: detail.message, validationDetails: detail.details,
          recovery: 'EXPLICIT_USER_TOPIC_LIST', requestInput: request.input });
        return { plan: local, campaign, model_result: result, recovery: 'EXPLICIT_USER_TOPIC_LIST' as const };
      }
      options.onAttempt?.({ result, validation: detail.message, validationDetails: detail.details ?? null, requestInput: request.input });
      repair = { previous_response: result.value, error: detail.message, details: detail.details ?? null,
        instruction: 'Repair only schema/evidence/coverage. Preserve the same user intent and revision. Every CORE branch needs a valid query. Do not invent user answers. Copy quotes as exact contiguous source text; never omit intervening words or list items. For broad searches for posts related to topics, do not invent a service-seeking author role: use target_roles UNSPECIFIED, a nonempty unrestricted summary, evidence [], and top-level target_roles []. Keep every explicitly requested topic.' };
      if (round === 1) throw Error('CAMPAIGN_SEMANTIC_VALIDATION_FAILED');
      continue;
    }
    options.onAttempt?.({ result, validation: null, requestInput: request.input });
    return { plan, campaign, model_result: result };
  }
  throw Error('CAMPAIGN_SEMANTIC_VALIDATION_FAILED');
}
