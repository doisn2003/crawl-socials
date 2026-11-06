import type { CampaignDraftCost } from './campaign-drafts.js';
import type { OpportunityConfig } from './production-api.js';
export type IntentField = 'target_roles' | 'purpose' | 'include' | 'exclude' | 'topics' | 'geography' | 'time';
export type IntentSource = 'PROMPT' | 'CONTEXT' | 'ANSWER' | 'EDIT' | 'SEED';
export interface IntentQuestion { id: string; target_field: IntentField; type: 'single_select' | 'multi_select' | 'free_text'; prompt: string; options: { id: string; label: string }[]; required: boolean; reason: string }
export interface IntentAnswer { answer_id: string; question_id: string; target_field: IntentField; type: IntentQuestion['type']; question: string; question_snapshot: IntentQuestion; selected_option_ids: string[]; raw_text: string; answer: string; source: 'ANSWER'; source_run_id: string; source_revision: number; revision: number }
export interface IntentEdit { field: IntentField; value: string; source: 'EDIT'; revision: number; source_revision: number; source_run_id: string }
export interface IntentInput { stage: 'S2'; prompt: string; context: string; seeds: string[]; revision: number; answers: IntentAnswer[]; edits: IntentEdit[]; previous_candidate?: IntentPlan; previous_run_id?: string; validation_repair?: unknown; discovery_target?: number }
export interface IntentPlan {
  original_facets?: import('./discovery-plan.js').RequestFacet[];
  coverage?: import('./discovery-plan.js').FacetCoverage[];
  state: 'READY' | 'NEEDS_CLARIFICATION'; intent_revision: number; understanding: string; target_roles: string[];
  intent: { field: IntentField; value: string; status: 'CONFIRMED' | 'UNSPECIFIED' | 'PROPOSED' | 'UNRESOLVED'; evidence: { source: IntentSource; quote: string }[] }[];
  constraints: { text: string; strength: 'REQUIRED' | 'PREFERRED'; source: IntentSource; quote: string }[];
  branches: { id: string; label: string; anchor: string; source: IntentSource; quote: string; scope: 'CORE' | 'OPTIONAL'; reason: string; facet_ids?: string[] }[];
  questions: IntentQuestion[]; unresolved_fields: IntentField[]; unconfirmed_assumptions: string[];
  queries: { id: string; text: string; branch_id: string; kind: 'EXACT' | 'PARAPHRASE'; anchor: string; rationale: string; risk: string; rejection: string | null;
    family_id?: import('./discovery-plan.js').DiscoveryFamily; facet_ids?: string[]; origin?: 'MODEL' | 'LITERAL_INPUT' | 'BARE_ANCHOR' }[];
  caveats: string[]; improvements: string[]; uncovered: string[];
}
export interface IntentResolution { schema_version: 1; input: IntentInput; plan: IntentPlan; recipe_hash: string }
export interface CampaignDialogueView { runId: string; revision: string; config: OpportunityConfig; configHash: string; input: IntentInput; plan: IntentPlan; cost: CampaignDraftCost; createdAt: string; updatedAt: string }
export interface ContinueCampaignRequest {
  runId: string; expectedRevision: string;
  answers?: { question_id: string; selected_option_ids: string[]; raw_text: string }[];
  editAnswerId?: string;
  edits?: { field: IntentField; value: string }[];
}
