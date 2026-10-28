import { randomUUID } from 'node:crypto';
import type {
  AccessCheck, AdapterAccessContext, AdapterCapabilities, AdapterCheckpoint, AdapterErrorCode,
  AdapterFailure, AdapterPage, AdapterRequest, AdapterResult, CandidateProvenance, Continuation,
  PermalinkCheck, PostCandidate, SourceCandidate,
} from '../../domain/adapter-contracts.js';
import { SOURCE_TYPES } from '../../domain/campaign.js';
import type { SocialAdapter } from '../../application/ports/social-adapter.js';
import { adapterFailure, validateAccessContext, validateAdapterRequest } from '../../application/adapter-capabilities.js';

export interface FakeAdapterFixture {
  readonly posts: readonly unknown[];
  readonly sources: readonly unknown[];
  readonly page_size: number;
  readonly faults?: readonly {
    readonly batch_index: number;
    readonly code: Extract<AdapterErrorCode, 'RATE_LIMITED' | 'LOGIN_REQUIRED' | 'CHALLENGE' | 'SCHEMA_CHANGED' | 'NETWORK_ERROR'>;
    readonly once: boolean;
  }[];
}

const CAPABILITIES: AdapterCapabilities = {
  adapter_id: 'facebook-fixture', adapter_version: '1.0.0', contract_version: '1.0.0', platform: 'FACEBOOK',
  collection_scopes: ['PUBLIC_DISCOVERY'], search_modes: ['POST_SEARCH', 'SOURCE_DISCOVERY', 'SOURCE_FEED'],
  source_types: SOURCE_TYPES, filters_by_mode: {
    POST_SEARCH: ['published_from', 'published_to', 'language'],
    SOURCE_FEED: ['published_from', 'published_to', 'language'], SOURCE_DISCOVERY: [],
  }, pagination: 'CURSOR',
  authentication: 'ANONYMOUS', readable_fields: ['POST_ID', 'PERMALINK', 'TEXT', 'SOURCE_CONTEXT', 'PUBLISHED_AT'],
  permalink_verification: true, checkpoint_resumption: 'SAME_INSTANCE', verification: 'FIXTURE_ONLY',
};
type RawPost = Omit<PostCandidate, 'provenance'>;
type RawSource = Omit<SourceCandidate, 'provenance'>;
type CursorState = { binding: string; offset: number; kind: AdapterPage['kind'] };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function stringEnum(value: unknown, allowed: readonly string[]): boolean { return typeof value === 'string' && allowed.includes(value); }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function sourceType(value: unknown): boolean { return (SOURCE_TYPES as readonly unknown[]).includes(value); }
function facebookUrl(value: unknown): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['facebook.com', 'www.facebook.com'].includes(url.hostname)
      && url.username === '' && url.password === '' && url.port === '';
  } catch { return false; }
}
function utc(value: unknown): boolean {
  if (!text(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function parsePost(raw: unknown): RawPost | null {
  if (!object(raw) || raw.platform !== 'FACEBOOK' || !nullableText(raw.post_id) || !facebookUrl(raw.canonical_url)
    || !nullableText(raw.text) || !(sourceType(raw.source_type) || raw.source_type === 'UNKNOWN')
    || !nullableText(raw.source_id) || !stringEnum(raw.author_type, ['PAGE', 'PERSON', 'UNKNOWN'])
    || !stringEnum(raw.visibility_at_observation, ['PUBLIC', 'PRIVATE', 'UNKNOWN'])
    || !stringEnum(raw.content_type, ['TEXT_POST', 'PHOTO_POST', 'VIDEO_POST', 'LINK_POST', 'SHARED_POST'])
    || !(raw.published_at === null || utc(raw.published_at)) || !nullableText(raw.language)) return null;
  // Build an allowlisted object. Raw capture/provenance fields can never set trusted metadata.
  return {
    platform: 'FACEBOOK', post_id: raw.post_id as string | null, canonical_url: raw.canonical_url,
    text: raw.text as string | null, source_type: raw.source_type as RawPost['source_type'], source_id: raw.source_id as string | null,
    author_type: raw.author_type as RawPost['author_type'], visibility_at_observation: raw.visibility_at_observation as RawPost['visibility_at_observation'],
    content_type: raw.content_type as RawPost['content_type'], published_at: raw.published_at as string | null, language: raw.language as string | null,
  };
}
function parseSource(raw: unknown): RawSource | null {
  if (!object(raw) || !text(raw.source_id) || !sourceType(raw.source_type) || !facebookUrl(raw.url) || !text(raw.name)
    || !stringEnum(raw.visibility_at_observation, ['PUBLIC', 'PRIVATE', 'UNKNOWN'])) return null;
  return { source_id: raw.source_id, source_type: raw.source_type as RawSource['source_type'], url: raw.url,
    name: raw.name, visibility_at_observation: raw.visibility_at_observation as RawSource['visibility_at_observation'] };
}
function binding(request: AdapterRequest): string {
  const query = request.query;
  const filters = Object.entries(query.filters).sort(([a], [b]) => a.localeCompare(b));
  // All identity/selection context is bound, not merely the visible query string.
  return JSON.stringify([query.run_id, query.query_id, query.parent_query_id, query.expansion_reason,
    query.policy_version, query.adapter_id, query.adapter_version, query.collection_scope, query.search_mode,
    query.source_type, query.source_id, query.keyword, filters, query.priority, query.budget.max_candidates,
    request.access_context.access_context_id, request.access_context.profile_id, request.access_context.account_id,
    request.access_context.account_binding, request.access_context.source_permission]);
}

export class FakeSocialAdapter implements SocialAdapter {
  readonly #fixture: FakeAdapterFixture;
  readonly #now: () => string;
  readonly #cursors = new Map<string, CursorState>();
  readonly #cursorKeys = new Map<string, string>();
  readonly #faultsFired = new Set<string>();
  readonly #instanceId = randomUUID();
  #state: 'CREATED' | 'READY' | 'STOPPED' = 'CREATED';
  #cursorSequence = 0;

  constructor(fixture: FakeAdapterFixture, now: () => string = () => '2026-10-27T00:00:00.000Z') {
    if (!Number.isSafeInteger(fixture.page_size) || fixture.page_size < 1) throw new Error('FIXTURE_PAGE_SIZE_INVALID');
    this.#fixture = structuredClone(fixture);
    this.#now = now;
  }
  get capabilities(): AdapterCapabilities { return structuredClone(CAPABILITIES); }
  async initialize(): Promise<AdapterResult<void>> {
    if (this.#state === 'STOPPED') return adapterFailure('STOPPED');
    this.#state = 'READY';
    return { status: 'OK', value: undefined };
  }
  #guard(): AdapterFailure | null {
    return this.#state === 'READY' ? null : adapterFailure(this.#state === 'STOPPED' ? 'STOPPED' : 'NOT_INITIALIZED');
  }
  async checkAccess(context: AdapterAccessContext): Promise<AdapterResult<AccessCheck>> {
    const error = this.#guard();
    if (error) return error;
    if (!validateAccessContext(context)) return adapterFailure('INVALID_REQUEST');
    if (context.source_permission === 'DENIED') return adapterFailure('ACCESS_DENIED');
    return { status: 'OK', value: { session: context.account_binding === 'ANONYMOUS' ? 'ANONYMOUS' : 'UNVERIFIED',
      source_permission: context.source_permission, verification: 'FIXTURE_ONLY' } };
  }
  async discoverSources(request: AdapterRequest): Promise<AdapterResult<AdapterPage>> {
    return this.#batch(request, 'SOURCES', null);
  }
  async searchPosts(request: AdapterRequest): Promise<AdapterResult<AdapterPage>> {
    return this.#batch(request, 'POSTS', null);
  }
  async fetchBatch(request: AdapterRequest, checkpoint: AdapterCheckpoint): Promise<AdapterResult<AdapterPage>> {
    const lifecycle = this.#guard();
    if (lifecycle) return lifecycle;
    // Only initial search methods may use the internal null sentinel. Missing continuation
    // state must never restart collection from page one, even for untyped runtime callers.
    const keys = ['adapter_id', 'adapter_version', 'checkpoint_version', 'opaque_cursor'];
    if (!object(checkpoint) || Object.keys(checkpoint).length !== keys.length
      || !keys.every(key => Object.hasOwn(checkpoint, key) && text(checkpoint[key]))) return adapterFailure('INVALID_CURSOR');
    return this.#batch(request, request?.query?.search_mode === 'SOURCE_DISCOVERY' ? 'SOURCES' : 'POSTS', checkpoint);
  }
  #batch(request: AdapterRequest, kind: AdapterPage['kind'], checkpoint: AdapterCheckpoint | null): AdapterResult<AdapterPage> {
    const lifecycle = this.#guard();
    if (lifecycle) return lifecycle;
    const invalid = validateAdapterRequest(CAPABILITIES, request);
    if (invalid) return invalid;
    if ((kind === 'SOURCES') !== (request.query.search_mode === 'SOURCE_DISCOVERY')) return adapterFailure('UNSUPPORTED_MODE');
    const key = binding(request);
    let offset = 0;
    if (checkpoint !== null) {
      if (!object(checkpoint) || !text(checkpoint.opaque_cursor)) return adapterFailure('INVALID_CURSOR');
      if (checkpoint.adapter_id !== CAPABILITIES.adapter_id || checkpoint.adapter_version !== CAPABILITIES.adapter_version
        || checkpoint.checkpoint_version !== '1') return adapterFailure('CHECKPOINT_MISMATCH');
      const state = this.#cursors.get(checkpoint.opaque_cursor);
      if (!state) return adapterFailure('INVALID_CURSOR');
      if (state.binding !== key || state.kind !== kind) return adapterFailure('CHECKPOINT_MISMATCH');
      offset = state.offset;
    }
    const batchIndex = Math.floor(offset / this.#fixture.page_size);
    for (const [index, fault] of (this.#fixture.faults ?? []).entries()) {
      const faultKey = JSON.stringify([key, kind, index]);
      if (fault.batch_index === batchIndex && (!fault.once || !this.#faultsFired.has(faultKey))) {
        this.#faultsFired.add(faultKey);
        return adapterFailure(fault.code, fault.code === 'RATE_LIMITED' ? 5 : null);
      }
    }
    const observedAt = this.#now();
    if (!utc(observedAt)) return adapterFailure('INVALID_REQUEST');
    const provenance = (index: number): CandidateProvenance => ({
      run_id: request.query.run_id, query_id: request.query.query_id, adapter_id: CAPABILITIES.adapter_id,
      adapter_version: CAPABILITIES.adapter_version, parser_version: 'fixture-parser-1', observed_at: observedAt,
      capture_mode: 'FIXTURE', access_context: structuredClone(request.access_context), evidence_ref: `fixture://${kind.toLowerCase()}/${index}`,
    });
    const metadata = { observed_at: observedAt, capture_mode: 'FIXTURE' as const, evidence_ref: `fixture://batch/${kind.toLowerCase()}/${batchIndex}` };
    if (kind === 'SOURCES') {
      const parsed = this.#fixture.sources.map(parseSource);
      if (parsed.some(item => item === null)) return adapterFailure('SCHEMA_CHANGED');
      const sources = (parsed as RawSource[]).filter(source => source.source_type === request.query.source_type);
      const end = Math.min(offset + this.#fixture.page_size, request.query.budget.max_candidates);
      return { status: 'OK', value: { kind: 'SOURCES', page: { ...metadata,
        candidates: sources.slice(offset, end).map((source, index) => ({ ...source, provenance: provenance(offset + index) })),
        continuation: this.#continuation(key, kind, end, sources.length, request.query.budget.max_candidates) } } };
    }
    const parsed = this.#fixture.posts.map(parsePost);
    if (parsed.some(item => item === null)) return adapterFailure('SCHEMA_CHANGED');
    const posts = (parsed as RawPost[]).filter(post => {
      if (post.source_type !== request.query.source_type) return false;
      if (request.query.source_id !== null && post.source_id !== request.query.source_id) return false;
      const filters = request.query.filters;
      if (filters.language !== undefined && post.language !== filters.language) return false;
      if (filters.published_from !== undefined && (post.published_at === null || Date.parse(post.published_at) < Date.parse(filters.published_from))) return false;
      if (filters.published_to !== undefined && (post.published_at === null || Date.parse(post.published_at) >= Date.parse(filters.published_to))) return false;
      return true;
    });
    const end = Math.min(offset + this.#fixture.page_size, request.query.budget.max_candidates);
    return { status: 'OK', value: { kind: 'POSTS', page: { ...metadata,
      candidates: posts.slice(offset, end).map((post, index) => ({ ...post, provenance: provenance(offset + index) })),
      continuation: this.#continuation(key, kind, end, posts.length, request.query.budget.max_candidates) } } };
  }
  #continuation(bindingKey: string, kind: AdapterPage['kind'], next: number, total: number, limit: number): Continuation {
    if (next >= total) return { status: 'END', reason: 'SOURCE_EXHAUSTED' };
    if (next >= limit) return { status: 'STOP', reason: 'BUDGET_REACHED' };
    const stateKey = JSON.stringify([bindingKey, kind, next]);
    const cursor = this.#cursorKeys.get(stateKey) ?? `fixture-cursor-${this.#instanceId}-${++this.#cursorSequence}`;
    this.#cursors.set(cursor, { binding: bindingKey, kind, offset: next });
    this.#cursorKeys.set(stateKey, cursor);
    return { status: 'MORE', checkpoint: { adapter_id: CAPABILITIES.adapter_id,
      adapter_version: CAPABILITIES.adapter_version, checkpoint_version: '1', opaque_cursor: cursor } };
  }
  async verifyPermalink(url: string, context: AdapterAccessContext): Promise<AdapterResult<PermalinkCheck>> {
    const access = await this.checkAccess(context);
    if (access.status === 'ERROR') return access;
    if (!facebookUrl(url)) return adapterFailure('INVALID_REQUEST');
    const posts = this.#fixture.posts.map(parsePost);
    if (posts.some(post => post === null)) return adapterFailure('SCHEMA_CHANGED');
    const post = posts.find(value => value?.canonical_url === url && value.post_id !== null);
    return { status: 'OK', value: { url, result: post ? 'MATCHED_FIXTURE' : 'UNVERIFIED',
      post_id: post?.post_id ?? null, capture_mode: 'FIXTURE' } };
  }
  async stop(): Promise<void> {
    this.#state = 'STOPPED';
    this.#cursors.clear();
    this.#cursorKeys.clear();
    this.#faultsFired.clear();
  }
}
