export const SOURCE_TYPES = ['PAGE', 'PUBLIC_GROUP', 'PUBLIC_PERSONAL'] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export interface CampaignSpec {
  schema_version: '1.0.0';
  contract_version: '1.0.0';
  campaign_id: string;
  name: string;
  mode: 'DRAFT' | 'BENCHMARK';
  platform: 'FACEBOOK';
  collection_scope: 'PUBLIC_DISCOVERY';
  workload: {
    confirmation: 'EXAMPLE_ONLY' | 'USER_CONFIRMED';
    keywords: string[];
    intent: string | null;
    exclusions: string[];
    language: string | null;
    display_timezone: 'Asia/Bangkok';
    geography: { mode: 'UNRESOLVED' | 'ANY' | 'INCLUDE'; places: string[]; preferred_places: string[]; evidence_rule: string | null };
    content_types: string[];
  };
  source_requirements: Record<SourceType, { in_scope: boolean | null; minimum_valid_unique_posts: number | null }>;
  historical_window: { mode: 'UNBOUNDED' | 'RANGE'; from_utc: string | null; to_utc: string | null };
  target: {
    valid_unique_posts: 1000;
    max_wall_time_seconds: 86400;
    clock_policy: 'INCLUDES_PAUSE_SLEEP_RETRY_RELOGIN_RESTART';
    after_target_policy: 'CONTINUE_WHILE_PRODUCTIVE_WITHIN_BUDGET';
  };
  identity_policy: { unique_key: string; shares: string; same_text_different_ids: string };
  discovery_policy: { seed_policy: string; source_seeds: string[]; expansion: 'DISABLED' | 'FROZEN_ALLOWLIST' | 'BOUNDED_INTENT'; allowed_expansions: string[]; expansion_rule_version: 'coffee-intent-v1' | null };
  budgets: { currency: string; max_cost: number | null; max_requests: number | null; max_operator_minutes: number | null; max_storage_mb: number | null };
  open_questions: string[];
}
