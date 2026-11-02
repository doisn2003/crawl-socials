import { campaignFromModel, plannerRecipeHash, literalCampaign } from './compile-campaign.js';
import { campaignVersion, INTENT_OPPORTUNITY_FILTER_VERSION, SEMANTIC_PLANNER_POLICY, validateCampaignPlan } from '../domain/campaign-plan.js';
import type { CampaignPlan, CampaignPlanInput } from '../domain/campaign-plan.js';
import { modelRequest, validateResult } from '../domain/semantic-keywords.mjs';
import type { IntentInput, IntentPlan } from '../shared/semantic-intent.js';
import type { JsonModelResult, ModelGateway } from './ports/model-gateway.js';
import { GOAL_FILTER_VERSION } from '../domain/goal-filter.js';

/** The approved lab engine is used unchanged; only the CSD campaign/storage adapter lives here. */
export function semanticCampaign(input: CampaignPlanInput, intent: IntentInput, plan: IntentPlan): CampaignPlan {
  if (plan.state !== 'READY' || plan.unresolved_fields.length || plan.uncovered.length) throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  const field = (name: string) => plan.intent.filter(item => item.field === name && item.status === 'CONFIRMED').map(item => item.value);
  const limits = plan.intent.filter(item => ['geography', 'time'].includes(item.field) && item.status === 'CONFIRMED')
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
  campaign.planner_policy = SEMANTIC_PLANNER_POLICY;
  campaign.filter_version = GOAL_FILTER_VERSION;
  campaign.intent_resolution = { schema_version: 1, input: structuredClone(intent), plan: structuredClone(plan), recipe_hash: plannerRecipeHash(SEMANTIC_PLANNER_POLICY) };
  const { version: _version, created_at: _created, ...base } = campaign;
  campaign.version = campaignVersion(base); validateCampaignPlan(campaign); return campaign;
}

export async function compileSemanticTurn(input: CampaignPlanInput, intent: IntentInput, gateway: ModelGateway,
  options: { signal?: AbortSignal; cacheNamespace?: string; onAttempt?: (attempt: { result: JsonModelResult; validation: string | null; requestInput: unknown }) => void } = {}) {
  literalCampaign({ ...input, planner_policy: 'legacy-short-v1' }); // Validate local limits before billing.
  let repair: unknown;
  for (let round = 0; round < 2; round++) {
    const request = modelRequest('B', { ...intent, ...(repair ? { validation_repair: repair } : {}) }, {});
    // Transport/auth/budget failures are not semantic retries.
    const result = await gateway.generateJson({ purpose: 'campaign-planner-v2.0.0-semantic-dialogue', system: request.system,
      schema: request.schema, input: request.input, max_output_tokens: request.maxOutputTokens,
      ...(options.cacheNamespace ? { cache_namespace: options.cacheNamespace } : {}),
      ...(options.signal ? { signal: options.signal } : {}) });
    let plan: IntentPlan, campaign: CampaignPlan | null;
    try {
      plan = validateResult(result.value, 'B', intent, {});
      campaign = plan.state === 'READY' ? semanticCampaign(input, intent, plan) : null;
    } catch (error) {
      const detail = error as Error & { details?: unknown };
      options.onAttempt?.({ result, validation: detail.message, requestInput: request.input });
      repair = { previous_response: result.value, error: detail.message, details: detail.details ?? null,
        instruction: 'Repair only schema/evidence/coverage. Preserve the same user intent and revision. Every CORE branch needs a valid query. Do not invent user answers.' };
      if (round === 1) throw Error('CAMPAIGN_SEMANTIC_VALIDATION_FAILED');
      continue;
    }
    options.onAttempt?.({ result, validation: null, requestInput: request.input });
    return { plan, campaign, model_result: result };
  }
  throw Error('CAMPAIGN_SEMANTIC_VALIDATION_FAILED');
}
