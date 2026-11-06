import type { IntentSource } from './semantic-intent.js';
export type DiscoveryFamily = 'TOPIC' | 'PROVIDER_SEARCH' | 'RECOMMENDATION' | 'PROBLEM' | 'FEELING' | 'ASPIRATION' | 'CAUSE' | 'SOLUTION'
  | 'DIY' | 'FAILED_ATTEMPT' | 'DISSATISFACTION' | 'POSITIVE_EXPERIENCE' | 'REVIEW' | 'COMPARISON' | 'PRICE' | 'CONVENIENCE'
  | 'OBJECTION' | 'BEGINNER' | 'RETURN_SWITCH' | 'OCCASION' | 'LIFESTYLE' | 'PROXY' | 'DEBATE' | 'COMMUNITY';
export interface RequestFacet {
  id: string; source: IntentSource; source_index: number; quote: string; start: number; end: number;
  kind: 'SEARCH' | 'CONSTRAINT' | 'EXCLUSION' | 'BUSINESS_CONTEXT'; literal_query: string | null;
}
export interface FacetCoverage { facet_id: string; disposition: 'SEARCH' | 'CONSTRAINT' | 'EXCLUSION' | 'BUSINESS_CONTEXT' | 'SUPERSEDED'; branch_ids: string[]; reason: string; superseded_by: string | null }
export interface DiscoveryQuery { query_id: string; text: string; family_id: DiscoveryFamily; facet_ids: string[]; wave: number; origin: 'MODEL' | 'LITERAL_INPUT'; rationale: string }
export interface DiscoveryPlan { version: '2.0.0'; evidence_scope: 'POST_ONLY'; facets: RequestFacet[]; coverage: FacetCoverage[]; queries: DiscoveryQuery[]; max_queries: number; initial_wave: 0 }
