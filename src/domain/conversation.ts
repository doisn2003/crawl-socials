import { createHash } from 'node:crypto';

export type SocialPlatform = 'facebook' | 'threads';
export type ConversationEntityType = 'POST' | 'COMMENT';
export type ObservationEntityType = ConversationEntityType | 'CAPTURE' | 'CANDIDATE';
export type AuthorRole = 'CONSUMER' | 'BUSINESS' | 'CREATOR' | 'UNKNOWN';
export type SourceKind = 'PROFILE' | 'GROUP' | 'PAGE' | 'UNKNOWN';
export interface ConversationAuthor { id?: string | null; name?: string | null; role?: AuthorRole }
export interface ConversationSource { kind: SourceKind; id?: string | null; name?: string | null; url?: string | null }
export interface ConversationMedia { type: 'IMAGE' | 'VIDEO' | 'UNKNOWN'; url: string }
export type CoverageStatus = 'NOT_ATTEMPTED' | 'OBSERVED_EMPTY' | 'PARTIAL' | 'EXHAUSTED_VISIBLE' | 'INACCESSIBLE' | 'RETRYABLE_ERROR';
export interface ConversationCoverage {
  status: CoverageStatus;
  advertised_count?: number | null;
  observed_count?: number;
  has_more?: boolean | null;
  sort_mode?: string | null;
  stop_reason?: string | null;
  pages?: number;
  cursor?: string | null;
  observed_at?: string;
}
export interface ObservationProvenance {
  run_id: string;
  method: string;
  url?: string;
  query?: string;
  response_sha256?: string;
  locator?: string;
}
/** Content observations only. Never pass browser cookies, headers, or authentication payloads. */
export interface ConversationObservation {
  platform: SocialPlatform;
  entity_type: ObservationEntityType;
  entity_id: string | null;
  root_post_id: string | null;
  parent_id: string | null;
  text: string;
  like_count?: number | null;
  observed_at: string;
  published_at?: string | null;
  permalink?: string | null;
  author?: ConversationAuthor;
  source?: ConversationSource;
  media?: ConversationMedia[];
  coverage?: ConversationCoverage;
  provenance: ObservationProvenance;
}
export interface ConversationEntity {
  entity_id: string;
  entity_type: ConversationEntityType;
  root_post_id: string;
  parent_id: string | null;
  text: string;
  observed_at: string;
  published_at: string | null;
  permalink: string | null;
  author: ConversationAuthor;
  source: ConversationSource;
  media: ConversationMedia[];
  content_hash: string;
}
export interface EvidenceSpan {
  id: string;
  entity_id: string;
  entity_type: ConversationEntityType;
  start: number;
  end: number;
  text: string;
}
export interface ConversationSnapshot {
  id: string;
  platform: SocialPlatform;
  root_post_id: string;
  revision: number;
  content_hash: string;
  observed_at: string;
  post: ConversationEntity | null;
  comments: ConversationEntity[];
  coverage: ConversationCoverage;
  spans: EvidenceSpan[];
}
export interface EvaluationContext {
  campaign_id: string;
  campaign_version: string;
  filter_version: string;
}

export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
    return input;
  };
  return JSON.stringify(normalize(value));
}
export function contentHash(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
export function contextKey(context: EvaluationContext): string { return stableJson([context.campaign_id, context.campaign_version, context.filter_version]); }
export function assertEvaluationContext(context: EvaluationContext): void {
  for (const key of ['campaign_id', 'campaign_version', 'filter_version'] as const) if (typeof context[key] !== 'string' || !context[key].trim()) throw Error(`INVALID_${key.toUpperCase()}`);
}
export function validateObservation(observation: ConversationObservation): void {
  if (!['facebook', 'threads'].includes(observation.platform)) throw Error('INVALID_PLATFORM');
  if (!['POST', 'COMMENT', 'CAPTURE', 'CANDIDATE'].includes(observation.entity_type)) throw Error('INVALID_ENTITY_TYPE');
  if (typeof observation.text !== 'string') throw Error('INVALID_OBSERVATION_TEXT');
  if (typeof observation.observed_at !== 'string' || !Number.isFinite(Date.parse(observation.observed_at))) throw Error('INVALID_OBSERVED_AT');
  if (!observation.provenance || typeof observation.provenance.run_id !== 'string' || typeof observation.provenance.method !== 'string') throw Error('INVALID_PROVENANCE');
  for (const key of ['entity_id', 'root_post_id', 'parent_id'] as const) if (observation[key] !== null && (typeof observation[key] !== 'string' || !observation[key]?.trim())) throw Error(`INVALID_${key.toUpperCase()}`);
  if (observation.entity_type === 'POST' && observation.entity_id && observation.root_post_id && observation.entity_id !== observation.root_post_id) throw Error('POST_ROOT_MISMATCH');
  if (observation.coverage) {
    const coverage = observation.coverage;
    if (!['NOT_ATTEMPTED', 'OBSERVED_EMPTY', 'PARTIAL', 'EXHAUSTED_VISIBLE', 'INACCESSIBLE', 'RETRYABLE_ERROR'].includes(coverage.status)) throw Error('INVALID_COVERAGE');
    for (const value of [coverage.advertised_count, coverage.observed_count, coverage.pages]) if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) throw Error('INVALID_COVERAGE_COUNT');
    if (coverage.status === 'OBSERVED_EMPTY' && ((coverage.observed_count ?? 0) > 0 || coverage.has_more === true)) throw Error('EMPTY_COVERAGE_CONTRADICTION');
  }
}

/** Keep original offsets. Segment rather than truncate text so evidence always maps to stored content. */
export function evidenceSpans(entity: ConversationEntity, segmentLength = 1200): EvidenceSpan[] {
  if (!Number.isInteger(segmentLength) || segmentLength < 1) throw Error('INVALID_SEGMENT_LENGTH');
  const spans: EvidenceSpan[] = [];
  for (let start = 0; start < entity.text.length; start += segmentLength) {
    const end = Math.min(start + segmentLength, entity.text.length);
    spans.push({ id: `${entity.entity_type.toLowerCase()}:${entity.entity_id}:${entity.content_hash.slice(0, 16)}:${start}:${end}`, entity_id: entity.entity_id, entity_type: entity.entity_type, start, end, text: entity.text.slice(start, end) });
  }
  return spans;
}
