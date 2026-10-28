import type { CampaignSpec } from './campaign.js';

export const INTENT_MODEL_VERSION = '1.0.0' as const;
export const INTENT_NORMALIZATION_VERSION = 'nfc-space-case-vi-alias-v1' as const;
export type Immutable<T> = T extends readonly (infer U)[] ? readonly Immutable<U>[]
  : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

export interface IntentText {
  raw: string;
  nfc: string;
  canonical: string;
  case_key: string;
  accent_alias: { value: string; purpose: 'COMPARISON_ONLY'; policy: 'VIETNAMESE_DIACRITICS_V1' };
  trace: { nfc_changed: boolean; whitespace_changed: boolean; case_changed: boolean; accent_alias_changed: boolean };
}
export interface IntentOrigin { source_path: string; declaration_ref: string | null; }
export interface KeywordDeclaration {
  keyword_index: number;
  kind: 'EXACT_PHRASE' | 'BRAND';
  declaration_ref: string;
}
export interface IntentKeyword {
  id: string;
  kind: 'KEYWORD' | 'EXACT_PHRASE' | 'BRAND';
  text: IntentText;
  origin: IntentOrigin;
  declaration_status: 'CAMPAIGN_KEYWORD' | 'EXPLICIT_DECLARATION';
  entity_verification: 'NOT_PERFORMED';
}
export interface IntentCondition {
  kind: 'INTENT' | 'EXCLUSION';
  text: IntentText;
  origin: IntentOrigin;
  evaluation: 'NOT_EVALUATED';
}
export interface IntentPlace {
  kind: 'PLACE';
  role: 'REQUIRED_LOCATION' | 'PREFERRED_LOCATION';
  text: IntentText;
  origin: IntentOrigin;
  entity_verification: 'NOT_PERFORMED';
}
export interface CampaignIntent {
  model_version: typeof INTENT_MODEL_VERSION;
  normalization_version: typeof INTENT_NORMALIZATION_VERSION;
  interpretation: 'EXPLICIT_STRUCTURE_ONLY';
  provenance: {
    kind: 'CAMPAIGN_SPEC'; campaign_id: string;
    schema_version: CampaignSpec['schema_version']; contract_version: CampaignSpec['contract_version'];
  };
  source_snapshot: CampaignSpec;
  keywords: IntentKeyword[];
  intent: IntentCondition | null;
  exclusions: IntentCondition[];
  geography: {
    mode: CampaignSpec['workload']['geography']['mode'];
    required_places: IntentPlace[];
    preferred_places: IntentPlace[];
    evidence_rule: string | null;
  };
  accent_alias_collisions: { alias: string; keyword_ids: string[]; canonical_forms: string[] }[];
}

export type IntentErrorCode = 'INTENT_TEXT_INVALID' | 'INTENT_CAMPAIGN_INVALID'
  | 'INTENT_KEYWORDS_EMPTY' | 'INTENT_DUPLICATE_KEYWORD' | 'INTENT_DECLARATION_INVALID';
