import type { OpportunityConfig } from './production-api.js';

/** Type-only contracts: renderer callers never receive a filesystem path or model credentials. */
export interface CampaignCriteria {
  topic: string; audience: string[]; needs: string[]; participation_intents: string[];
  research_intents: string[]; inclusions: string[]; exclusions: string[]; brand_context: string | null;
  required_geographies: string[]; preferred_geographies: string[]; languages: string[];
  source_priority: ('PROFILE' | 'GROUP' | 'PAGE' | 'UNKNOWN')[];
  queries: { text: string; family: 'REQUEST' | 'EXPERIENCE' | 'COMPARISON' | 'PROBLEM' | 'USE_CASE' | 'BROAD'; platforms: ('facebook' | 'threads')[] }[];
  assumptions: string[]; max_age_days: number | null;
  watch: { enabled: boolean; revisit_hours: number[]; ttl_hours: number; max_attempts: number };
}
/** Structurally equal to the domain plan, without importing its Node hashing implementation. */
export interface CampaignDraftPlan extends CampaignCriteria {
  filter_mode?: import('./filter-policy.js').FilterMode;
  result_policy?: 'GLOBAL_FIRST_QUALIFIED';
  schema_version: '1.0.0'; campaign_id: string; version: string; created_at: string; prompt: string;
  suitable_target: number; target_scope: 'TOTAL_ACROSS_PLATFORMS';
  desired_platform_weights: Record<'facebook' | 'threads', number>;
  budget: { raw_cap: number; model_usd: number; max_run_minutes: number; comments_per_capture: number; comment_pages: number };
  filter_version: string;
  intent_resolution?: import('./semantic-intent.js').IntentResolution;
  planner_policy?: 'legacy-short-v1' | 'grounded-constraints-v1' | 'controlled-semantic-dialogue-v1';
  constraint_provenance?: {
    schema_version: 1; sources: Record<'PROMPT' | 'BRAND_CONTEXT', string>;
    compiled_values: Pick<CampaignCriteria, 'required_geographies' | 'preferred_geographies' | 'languages' | 'max_age_days' | 'source_priority'>;
    entries: { field: 'required_geographies' | 'preferred_geographies' | 'languages' | 'max_age_days' | 'source_priority'; value: string[] | number | null;
      source: 'PROMPT' | 'BRAND_CONTEXT' | 'EXPLICIT_FIELD' | 'DEFAULT'; quote: string | null; start: number | null; end: number | null;
      interpretation: 'REQUIRED' | 'PREFERRED' | 'ORDER' | 'UNSET' }[];
    unresolved: { field: 'required_geographies' | 'preferred_geographies' | 'languages' | 'max_age_days' | 'source_priority'; source: 'PROMPT' | 'BRAND_CONTEXT';
      quote: string; start: number; end: number; reason: 'AMBIGUOUS_SCOPE' | 'MENTION_NOT_CONSTRAINT' | 'STRENGTH_MISMATCH' | 'SOFT_CONSTRAINT_UNREPRESENTED' | 'UNSUPPORTED_FORMAT' | 'CONFLICTING_INSTRUCTIONS' }[];
  };
}
export type CampaignCriteriaPatch = Partial<CampaignCriteria>;
export type CampaignPresetRuntime = Pick<OpportunityConfig, 'filterMode' | 'languageScope' | 'totalTarget' | 'threadsShare' | 'rawCap' | 'budgetUsd' | 'commentsEnabled'>;
export interface CampaignDraftCost {
  /** Persisted cost receipt; live collection spend may be newer than this timestamp. */
  capturedAt: string;
  model: string; budgetUsd: number; measuredUsd: number; unknownUpperUsd: number;
  reservedUsd: number; remainingUsd: number; billableAttempts: number; cacheHits: number;
  basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE';
}
export interface CampaignDraftSource {
  kind: 'PLANNER' | 'PRESET';
  sourceCampaignVersion: string;
  presetId?: string; presetVersion?: string; sourceRunId?: string;
  plannerRequestHash?: string; plannerInvocationId?: string;
  /** The referenced model attempt failed; the runnable plan came from literal user keywords. */
  plannerRecovery?: 'EXPLICIT_USER_TOPIC_LIST';
  plannerPolicy?: 'legacy-short-v1' | 'grounded-constraints-v1' | 'controlled-semantic-dialogue-v1'; plannerRecipeHash?: string;
}
export interface CampaignCriteriaOverride {
  at: string; previousRevision: string; patch: CampaignCriteriaPatch;
}
export interface CampaignDraftView {
  runId: string; revision: string; status: 'DRAFT' | 'STARTED';
  /** Unsupported archived recipes remain inspectable, but cannot start without an explicit upgrade. */
  supported: boolean;
  /** Derived from the exact installed recipe; never persisted as campaign criteria. */
  criteriaCapabilities: { extendedClassificationCriteria: boolean };
  config: OpportunityConfig; configHash: string; campaign: CampaignDraftPlan; criteria: CampaignCriteria;
  recipeHash: string; source: CampaignDraftSource; sourceHash: string;
  cost: CampaignDraftCost; createdAt: string; updatedAt: string;
  userOverrides: CampaignCriteriaOverride[];
}
export interface CampaignPresetView {
  presetId: string; version: string; name: string; createdAt: string;
  prompt: string; brandContext: string; criteria: CampaignCriteria;
  runtimeDefaults: CampaignPresetRuntime; filterVersion: string; recipeHash: string;
  sourceRunId: string; sourceCampaignVersion: string; sourceHash: string;
  supported: boolean;
}
export interface CampaignDraftReference { runId: string; revision: string; configHash: string }
export interface UpdateCampaignDraftRequest {
  runId: string; expectedRevision: string; criteriaPatch: CampaignCriteriaPatch;
}
export interface SaveCampaignPresetRequest {
  name: string;
  source: { kind: 'DRAFT'; runId: string; revision: string } | { kind: 'RUN'; runId: string };
}
export interface ApplyCampaignPresetRequest {
  presetId: string; presetVersion: string; runtime: CampaignPresetRuntime;
}
