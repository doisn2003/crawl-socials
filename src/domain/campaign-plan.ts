import { contentHash } from './conversation.js';
import type { SocialPlatform, SourceKind } from './conversation.js';

export const CAMPAIGN_PLAN_VERSION = '1.0.0';
export const OPPORTUNITY_FILTER_VERSION = 'conversation-opportunity-v2.0.3';
/** Opt-in policy until its semantic evaluation is complete; legacy recipes stay immutable. */
export const TEMPORAL_OPPORTUNITY_FILTER_VERSION = 'conversation-opportunity-v2.1.0';
export const GROUNDED_CONSTRAINT_PLANNER_POLICY = 'grounded-constraints-v1';
export type CampaignPlannerPolicy = 'legacy-short-v1' | typeof GROUNDED_CONSTRAINT_PLANNER_POLICY;
export type CampaignConstraintField = 'required_geographies' | 'preferred_geographies' | 'languages' | 'max_age_days' | 'source_priority';
export type CampaignConstraintSource = 'PROMPT' | 'BRAND_CONTEXT';
export type CampaignConstraintIssue = 'AMBIGUOUS_SCOPE' | 'MENTION_NOT_CONSTRAINT' | 'STRENGTH_MISMATCH' |
  'SOFT_CONSTRAINT_UNREPRESENTED' | 'UNSUPPORTED_FORMAT' | 'CONFLICTING_INSTRUCTIONS';
export interface CampaignConstraintEvidence {
  field: CampaignConstraintField; value: string[] | number | null;
  source: CampaignConstraintSource | 'EXPLICIT_FIELD' | 'DEFAULT';
  quote: string | null; start: number | null; end: number | null;
  interpretation: 'REQUIRED' | 'PREFERRED' | 'ORDER' | 'UNSET';
}
export interface CampaignConstraintUnresolved {
  field: CampaignConstraintField; source: CampaignConstraintSource; quote: string; start: number; end: number; reason: CampaignConstraintIssue;
}
export interface CampaignConstraintValues {
  required_geographies: string[]; preferred_geographies: string[]; languages: string[];
  max_age_days: number | null; source_priority: SourceKind[];
}
/** Historical compiler evidence, independent of later explicit draft userOverrides. */
export interface CampaignConstraintProvenance {
  schema_version: 1;
  sources: Record<CampaignConstraintSource, string>;
  compiled_values: CampaignConstraintValues;
  entries: CampaignConstraintEvidence[];
  unresolved: CampaignConstraintUnresolved[];
}
export type QueryFamily = 'REQUEST' | 'EXPERIENCE' | 'COMPARISON' | 'PROBLEM' | 'USE_CASE' | 'BROAD';
export interface CampaignQuery { text: string; family: QueryFamily; platforms: SocialPlatform[] }
export interface CampaignPlan {
  schema_version: typeof CAMPAIGN_PLAN_VERSION;
  campaign_id: string;
  version: string;
  created_at: string;
  prompt: string;
  topic: string;
  audience: string[];
  needs: string[];
  participation_intents: string[];
  research_intents: string[];
  inclusions: string[];
  exclusions: string[];
  brand_context: string | null;
  required_geographies: string[];
  preferred_geographies: string[];
  languages: string[];
  source_priority: SourceKind[];
  queries: CampaignQuery[];
  assumptions: string[];
  suitable_target: number;
  target_scope: 'TOTAL_ACROSS_PLATFORMS';
  desired_platform_weights: Record<SocialPlatform, number>;
  budget: { raw_cap: number; model_usd: number; max_run_minutes: number; comments_per_capture: number; comment_pages: number };
  watch: { enabled: boolean; revisit_hours: number[]; ttl_hours: number; max_attempts: number };
  max_age_days: number | null;
  filter_version: string;
  planner_policy?: CampaignPlannerPolicy;
  constraint_provenance?: CampaignConstraintProvenance;
}

export interface CampaignPlanInput {
  prompt: string;
  brand_context?: string | null;
  campaign_id?: string;
  suitable_target?: number;
  desired_platform_weights?: Record<SocialPlatform, number>;
  raw_cap?: number;
  model_usd?: number;
  max_run_minutes?: number;
  max_age_days?: number | null;
  required_geographies?: string[];
  preferred_geographies?: string[];
  languages?: string[];
  source_priority?: SourceKind[];
  planner_policy?: CampaignPlannerPolicy;
  seed_queries?: string[];
  filter_version?: typeof OPPORTUNITY_FILTER_VERSION | typeof TEMPORAL_OPPORTUNITY_FILTER_VERSION;
}

export function validateCampaignPlan(plan: CampaignPlan): void {
  if (plan.schema_version !== CAMPAIGN_PLAN_VERSION || plan.target_scope !== 'TOTAL_ACROSS_PLATFORMS') throw Error('CAMPAIGN_SCHEMA_INVALID');
  for (const key of ['campaign_id', 'version', 'prompt', 'topic', 'filter_version'] as const) {
    if (typeof plan[key] !== 'string' || !plan[key].trim()) throw Error('CAMPAIGN_TEXT_REQUIRED');
  }
  if (!Number.isInteger(plan.suitable_target) || plan.suitable_target < 1 || plan.suitable_target > 100_000) throw Error('CAMPAIGN_TARGET_INVALID');
  const w = plan.desired_platform_weights;
  if (!w || !Number.isFinite(w.facebook) || !Number.isFinite(w.threads) || w.facebook < 0 || w.threads < 0
    || Math.abs(w.facebook + w.threads - 1) > 1e-9) throw Error('CAMPAIGN_WEIGHTS_INVALID');
  if (!Number.isInteger(plan.budget.raw_cap) || plan.budget.raw_cap < plan.suitable_target
    || !Number.isFinite(plan.budget.model_usd) || plan.budget.model_usd <= 0
    || !Number.isFinite(plan.budget.max_run_minutes) || plan.budget.max_run_minutes <= 0) throw Error('CAMPAIGN_BUDGET_INVALID');
  if (plan.max_age_days !== null && (!Number.isFinite(plan.max_age_days) || plan.max_age_days <= 0)) throw Error('CAMPAIGN_AGE_INVALID');
  if (!plan.queries.length || plan.queries.length > 100) throw Error('CAMPAIGN_QUERIES_INVALID');
  for (const query of plan.queries) {
    if (!query.text.trim() || query.text.length > 200 || !['REQUEST', 'EXPERIENCE', 'COMPARISON', 'PROBLEM', 'USE_CASE', 'BROAD'].includes(query.family)
      || !query.platforms.length || query.platforms.some(p => p !== 'facebook' && p !== 'threads')) throw Error('CAMPAIGN_QUERY_INVALID');
  }
  if (plan.planner_policy !== undefined && !['legacy-short-v1', GROUNDED_CONSTRAINT_PLANNER_POLICY].includes(plan.planner_policy)) throw Error('CAMPAIGN_PLANNER_POLICY_INVALID');
  if (plan.constraint_provenance !== undefined) {
    const provenance = plan.constraint_provenance;
    if (plan.planner_policy !== GROUNDED_CONSTRAINT_PLANNER_POLICY || !provenance || provenance.schema_version !== 1
      || !provenance.sources || typeof provenance.sources.PROMPT !== 'string' || provenance.sources.PROMPT.length > 12000
      || typeof provenance.sources.BRAND_CONTEXT !== 'string' || provenance.sources.BRAND_CONTEXT.length > 12000
      || !Array.isArray(provenance.entries) || provenance.entries.length > 100 || !Array.isArray(provenance.unresolved) || provenance.unresolved.length > 80) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
    const fields = ['required_geographies', 'preferred_geographies', 'languages', 'max_age_days', 'source_priority'];
    const validValue = (field: string, value: unknown) => field === 'max_age_days' ? value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 36500)
      : Array.isArray(value) && value.length <= 20 && value.every(v => typeof v === 'string' && !!v.trim() && v.length <= 600);
    if (!provenance.compiled_values || fields.some(field => !validValue(field, provenance.compiled_values[field as CampaignConstraintField]))) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
    const quoteValid = (value: { source: string; quote: string | null; start: number | null; end: number | null }) => {
      if (value.source !== 'PROMPT' && value.source !== 'BRAND_CONTEXT') return false;
      const source = provenance.sources[value.source];
      return typeof value.quote === 'string' && value.quote.length > 0 && value.quote.length <= 600 && Number.isInteger(value.start)
        && Number.isInteger(value.end) && Number(value.start) >= 0 && Number(value.end) <= source.length
        && Number(value.end) > Number(value.start) && source.slice(Number(value.start), Number(value.end)) === value.quote;
    };
    for (const entry of provenance.entries) {
      if (!entry || !fields.includes(entry.field) || !validValue(entry.field, entry.value) || !['REQUIRED', 'PREFERRED', 'ORDER', 'UNSET'].includes(entry.interpretation)
        || (entry.source === 'DEFAULT' || entry.source === 'EXPLICIT_FIELD' ? entry.quote !== null || entry.start !== null || entry.end !== null : !quoteValid(entry))) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
    }
    for (const entry of provenance.unresolved) if (!entry || !fields.includes(entry.field) || !quoteValid(entry)
      || !['AMBIGUOUS_SCOPE', 'MENTION_NOT_CONSTRAINT', 'STRENGTH_MISMATCH', 'SOFT_CONSTRAINT_UNREPRESENTED', 'UNSUPPORTED_FORMAT', 'CONFLICTING_INSTRUCTIONS'].includes(entry.reason)) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
    for (const field of fields as CampaignConstraintField[]) {
      const entries = provenance.entries.filter(entry => entry.field === field);
      if (!entries.length || (field === 'max_age_days' && entries.length !== 1)) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
      const reconstructed = field === 'max_age_days' ? entries[0]!.value : [...new Set(entries.flatMap(entry => entry.value as string[]))];
      if (contentHash(reconstructed) !== contentHash(provenance.compiled_values[field])) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
    }
    if (provenance.compiled_values.source_priority.length > 4 || provenance.compiled_values.source_priority.some(kind => !['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'].includes(kind))) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
  } else if (plan.planner_policy === GROUNDED_CONSTRAINT_PLANNER_POLICY) throw Error('CAMPAIGN_CONSTRAINT_PROVENANCE_INVALID');
}

export function campaignVersion(plan: Omit<CampaignPlan, 'version' | 'created_at'>): string {
  return contentHash(plan).slice(0, 24);
}
