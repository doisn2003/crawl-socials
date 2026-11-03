import { campaignVersion, validateCampaignPlan, type CampaignPlan } from '../domain/campaign-plan.js';
import { FILTER_VERSIONS, GLOBAL_RESULT_POLICY, type FilterMode } from '../shared/filter-policy.js';
import { literalCampaign } from './compile-campaign.js';
import type { OpportunityConfig } from '../shared/production-api.js';
import type { ModelGateway } from './ports/model-gateway.js';

export function withFilterPolicy(plan: CampaignPlan, mode?: FilterMode): CampaignPlan {
  if (!mode) return plan;
  const next = structuredClone(plan);
  next.filter_mode = mode; next.result_policy = GLOBAL_RESULT_POLICY; next.filter_version = FILTER_VERSIONS[mode];
  // Legacy schema field is retained for reading old drafts; the global policy never allocates these weights.
  next.desired_platform_weights = { threads: 0.5, facebook: 0.5 };
  next.watch = { enabled: false, revisit_hours: [], ttl_hours: 72, max_attempts: 0 };
  if (mode === 'OFF') next.budget.model_usd = 0;
  const { version: _, created_at: __, ...base } = next; next.version = campaignVersion(base);
  validateCampaignPlan(next); return next;
}
export function manualCollectionPlan(runId: string, config: OpportunityConfig, keywords: string[]): CampaignPlan {
  if (!keywords.length) throw Error('KEYWORDS_REQUIRED');
  return withFilterPolicy(literalCampaign({ campaign_id: runId, prompt: config.prompt || keywords.join(', '),
    seed_queries: keywords, suitable_target: config.totalTarget, raw_cap: config.rawCap, model_usd: 1 }), 'OFF');
}
/** OFF never constructs a transport, reads credentials or compiles a prompt. */
export const unassessedGateway: ModelGateway = {
  generateJson: async () => { throw Error('OFF_MODEL_CALL_FORBIDDEN'); },
  summary: () => ({ model: 'NONE', budget_usd: 0, measured_cost_usd: 0, unmetered_cost_upper_usd: 0, reserved_usd: 0,
    remaining_usd: 0, billable_attempts: 0, cache_hits: 0, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' }),
};
