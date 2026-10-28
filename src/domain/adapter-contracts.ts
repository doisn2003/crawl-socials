import type { SourceType } from './campaign.js';

export type CaptureMode = 'LIVE' | 'FIXTURE' | 'REPLAY' | 'IMPORT' | 'CACHE';
export type CollectionScope = 'PUBLIC_DISCOVERY' | 'JOINED_GROUPS';
export type SearchMode = 'POST_SEARCH' | 'SOURCE_DISCOVERY' | 'SOURCE_FEED' | 'GROUP_POST_SEARCH';
export type FilterName = 'published_from' | 'published_to' | 'language';
export type CapabilityVerification = 'UNKNOWN' | 'FIXTURE_ONLY' | 'LIVE_VERIFIED';
export type SourcePermission = 'UNKNOWN' | 'ALLOWED' | 'DENIED';
export type CandidateField = 'POST_ID' | 'PERMALINK' | 'TEXT' | 'SOURCE_CONTEXT' | 'PUBLISHED_AT';

export interface AdapterCapabilities {
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly contract_version: '1.0.0';
  readonly platform: 'FACEBOOK';
  readonly collection_scopes: readonly CollectionScope[];
  readonly search_modes: readonly SearchMode[];
  readonly source_types: readonly SourceType[];
  readonly filters_by_mode: Readonly<Partial<Record<SearchMode, readonly FilterName[]>>>;
  readonly pagination: 'CURSOR' | 'NONE';
  readonly authentication: 'ANONYMOUS' | 'USER_SESSION';
  readonly readable_fields: readonly CandidateField[];
  readonly permalink_verification: boolean;
  readonly checkpoint_resumption: 'SAME_INSTANCE' | 'DURABLE' | 'NONE';
  readonly verification: CapabilityVerification;
}

// References only. Credentials and platform account names do not belong in this contract.
export interface AdapterAccessContext {
  readonly access_context_id: string;
  readonly profile_id: string | null;
  readonly account_id: string | null;
  readonly account_binding: 'ANONYMOUS' | 'UNVERIFIED' | 'VERIFIED';
  readonly source_permission: SourcePermission;
}

export interface QueryPlan {
  readonly run_id: string;
  readonly query_id: string;
  readonly parent_query_id: string | null;
  readonly expansion_reason: string | null;
  readonly policy_version: string;
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly collection_scope: CollectionScope;
  readonly search_mode: SearchMode;
  readonly source_type: SourceType;
  readonly source_id: string | null;
  readonly keyword: string;
  readonly filters: {
    readonly published_from?: string;
    readonly published_to?: string;
    readonly language?: string;
  };
  readonly priority: number;
  readonly budget: { readonly max_candidates: number };
}

export interface AdapterRequest {
  readonly query: QueryPlan;
  readonly access_context: AdapterAccessContext;
}

// Opaque cursor is protected runtime state, never a public evidence/log field.
export interface AdapterCheckpoint {
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly checkpoint_version: '1';
  readonly opaque_cursor: string;
}

export interface CandidateProvenance {
  readonly run_id: string;
  readonly query_id: string;
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly parser_version: string;
  readonly observed_at: string;
  readonly capture_mode: CaptureMode;
  readonly access_context: AdapterAccessContext;
  readonly evidence_ref: string;
}

export interface PostCandidate {
  readonly platform: 'FACEBOOK';
  readonly post_id: string | null;
  readonly canonical_url: string;
  readonly text: string | null;
  readonly source_type: SourceType | 'UNKNOWN';
  readonly source_id: string | null;
  readonly author_type: 'PAGE' | 'PERSON' | 'UNKNOWN';
  readonly visibility_at_observation: 'PUBLIC' | 'PRIVATE' | 'UNKNOWN';
  readonly content_type: 'TEXT_POST' | 'PHOTO_POST' | 'VIDEO_POST' | 'LINK_POST' | 'SHARED_POST';
  readonly published_at: string | null;
  readonly language: string | null;
  readonly provenance: CandidateProvenance;
}

export interface SourceCandidate {
  readonly source_id: string;
  readonly source_type: SourceType;
  readonly url: string;
  readonly name: string;
  readonly visibility_at_observation: 'PUBLIC' | 'PRIVATE' | 'UNKNOWN';
  readonly provenance: CandidateProvenance;
}

export type AdapterErrorCode =
  | 'NOT_INITIALIZED' | 'STOPPED' | 'INVALID_REQUEST' | 'ADAPTER_VERSION_MISMATCH'
  | 'UNSUPPORTED_SCOPE' | 'UNSUPPORTED_MODE' | 'UNSUPPORTED_SOURCE' | 'UNSUPPORTED_FILTER'
  | 'LOGIN_REQUIRED' | 'ACCESS_DENIED' | 'RATE_LIMITED' | 'CHALLENGE'
  | 'INVALID_CURSOR' | 'CHECKPOINT_MISMATCH' | 'SCHEMA_CHANGED'
  | 'NETWORK_ERROR' | 'DEADLINE_REACHED' | 'UNSUPPORTED_OPERATION';

export interface AdapterFailure {
  readonly status: 'ERROR';
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;
  readonly retry_after_seconds: number | null;
}
export type AdapterResult<T> = { readonly status: 'OK'; readonly value: T } | AdapterFailure;
export type Continuation =
  | { readonly status: 'MORE'; readonly checkpoint: AdapterCheckpoint }
  | { readonly status: 'END'; readonly reason: 'SOURCE_EXHAUSTED' }
  | { readonly status: 'STOP'; readonly reason: 'BUDGET_REACHED' | 'NO_PROGRESS' | 'PROVIDER_LIMIT' };

export interface PageResult<T> {
  readonly candidates: readonly T[];
  readonly observed_at: string;
  readonly capture_mode: CaptureMode;
  readonly evidence_ref: string;
  readonly continuation: Continuation;
}
export type AdapterPage =
  | { readonly kind: 'POSTS'; readonly page: PageResult<PostCandidate> }
  | { readonly kind: 'SOURCES'; readonly page: PageResult<SourceCandidate> };

export interface AccessCheck {
  readonly session: 'ANONYMOUS' | 'AUTHENTICATED' | 'UNVERIFIED';
  readonly source_permission: SourcePermission;
  readonly verification: CapabilityVerification;
}

export interface PermalinkCheck {
  readonly url: string;
  readonly result: 'MATCHED_FIXTURE' | 'UNVERIFIED';
  readonly post_id: string | null;
  readonly capture_mode: CaptureMode;
}

// Forward contracts only; P02.01 does not implement durable scheduling or snapshot storage.
export interface CollectionJob {
  readonly job_id: string;
  readonly request: AdapterRequest;
  readonly status: 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly attempt: number;
  readonly lease: { readonly owner_id: string; readonly token: string; readonly expires_at: string } | null;
  readonly next_eligible_at: string | null;
  readonly checkpoint: AdapterCheckpoint | null;
  readonly deadline_at: string;
  readonly remaining_budget: { readonly requests: number; readonly candidates: number; readonly cost: number; readonly currency: string };
}

export type ValidationReason =
  | 'CONTENT_MATCH' | 'NOT_FACEBOOK_POST' | 'NOT_POST' | 'IDENTITY_UNVERIFIED' | 'PERMALINK_UNVERIFIED'
  | 'SOURCE_OUT_OF_SCOPE' | 'NON_PUBLIC_SOURCE' | 'SOURCE_UNVERIFIED' | 'CONTENT_TYPE_EXCLUDED'
  | 'OFF_TOPIC' | 'OUTSIDE_GEOGRAPHY' | 'LANGUAGE_EXCLUDED' | 'OUTSIDE_PUBLISHED_WINDOW' | 'EXCLUSION_MATCH'
  | 'CONTENT_INSUFFICIENT' | 'GEOGRAPHY_UNVERIFIED' | 'LANGUAGE_UNVERIFIED' | 'PUBLISHED_AT_MISSING' | 'EVIDENCE_MISSING';

export interface ValidationDecision {
  readonly decision_id: string;
  readonly observation_id: string;
  readonly record_version: string;
  readonly campaign_id: string;
  readonly contract_version: string;
  readonly result: 'ACCEPT' | 'REJECT' | 'UNVERIFIED';
  readonly reasons: readonly ValidationReason[];
  readonly rule_version: string;
  readonly model_version: string | null;
  readonly evaluator_ref: string;
  readonly decided_at: string;
  readonly evidence_refs: readonly string[];
  readonly previous_decision_id: string | null;
}

export interface RunSnapshot {
  readonly snapshot_id: string;
  readonly run_id: string;
  readonly spec_hash: string;
  readonly configuration_hash: string;
  readonly code_version: string;
  readonly cutoff_at: string;
  readonly membership_hash: string;
  readonly members: readonly {
    readonly identity: string;
    readonly observation_id: string;
    readonly record_version: string;
    readonly record_hash: string;
    readonly evidence_refs: readonly { readonly ref: string; readonly hash: string }[];
    readonly validation_decision_id: string;
  }[];
  readonly audit_outcome: 'NOT_AUDITED' | 'PASS' | 'FAIL';
}
