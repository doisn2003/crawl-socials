import type {
  AdapterAccessContext, AdapterCapabilities, AdapterErrorCode, AdapterFailure,
  FilterName, SearchMode,
} from '../domain/adapter-contracts.js';

export function adapterFailure(code: AdapterErrorCode, retryAfter: number | null = null): AdapterFailure {
  return { status: 'ERROR', code, retryable: code === 'RATE_LIMITED' || code === 'NETWORK_ERROR', retry_after_seconds: retryAfter };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function stringEnum(value: unknown, allowed: readonly string[]): boolean { return typeof value === 'string' && allowed.includes(value); }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  return instant.toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => '.' + (fraction ?? '').padEnd(3, '0') + 'Z');
}

export function validateAccessContext(context: unknown): context is AdapterAccessContext {
  if (!object(context) || !exactKeys(context, ['access_context_id', 'profile_id', 'account_id', 'account_binding', 'source_permission'])
    || !text(context.access_context_id) || !nullableText(context.profile_id) || !nullableText(context.account_id)
    || !stringEnum(context.account_binding, ['ANONYMOUS', 'UNVERIFIED', 'VERIFIED'])
    || !stringEnum(context.source_permission, ['UNKNOWN', 'ALLOWED', 'DENIED'])) return false;
  if (context.account_binding === 'ANONYMOUS') return context.account_id === null;
  if (context.account_binding === 'VERIFIED') return text(context.profile_id) && text(context.account_id);
  return text(context.profile_id) && context.account_id === null;
}

// Structural validation and declared capability are separate from live source authorization.
export function validateAdapterRequest(capabilities: AdapterCapabilities, request: unknown): AdapterFailure | null {
  if (!object(request) || !exactKeys(request, ['query', 'access_context']) || !object(request.query)
    || !validateAccessContext(request.access_context)) return adapterFailure('INVALID_REQUEST');
  const query = request.query;
  if (!exactKeys(query, ['run_id', 'query_id', 'parent_query_id', 'expansion_reason', 'policy_version',
    'adapter_id', 'adapter_version', 'collection_scope', 'search_mode', 'source_type', 'source_id',
    'keyword', 'filters', 'priority', 'budget'])
    || !['run_id', 'query_id', 'policy_version', 'adapter_id', 'adapter_version', 'keyword'].every(key => text(query[key]))
    || !nullableText(query.parent_query_id) || !nullableText(query.expansion_reason) || !nullableText(query.source_id)
    || !Number.isFinite(query.priority) || !object(query.budget) || !exactKeys(query.budget, ['max_candidates'])
    || !Number.isSafeInteger(query.budget.max_candidates) || Number(query.budget.max_candidates) < 1
    || !object(query.filters)) return adapterFailure('INVALID_REQUEST');
  if (query.adapter_id !== capabilities.adapter_id || query.adapter_version !== capabilities.adapter_version) return adapterFailure('ADAPTER_VERSION_MISMATCH');
  if (!(capabilities.collection_scopes as readonly unknown[]).includes(query.collection_scope)) return adapterFailure('UNSUPPORTED_SCOPE');
  if (!(capabilities.search_modes as readonly unknown[]).includes(query.search_mode)) return adapterFailure('UNSUPPORTED_MODE');
  if (!(capabilities.source_types as readonly unknown[]).includes(query.source_type)) return adapterFailure('UNSUPPORTED_SOURCE');
  for (const [key, value] of Object.entries(query.filters)) {
    if (!(capabilities.filters_by_mode[query.search_mode as SearchMode] ?? []).includes(key as FilterName)) return adapterFailure('UNSUPPORTED_FILTER');
    if (key === 'language' ? !text(value) : !timestamp(value)) return adapterFailure('INVALID_REQUEST');
  }
  const { published_from: from, published_to: to } = query.filters;
  if (typeof from === 'string' && typeof to === 'string' && Date.parse(from) >= Date.parse(to)) return adapterFailure('INVALID_REQUEST');
  if ((query.search_mode === 'SOURCE_FEED' || query.search_mode === 'GROUP_POST_SEARCH') && !text(query.source_id)) return adapterFailure('INVALID_REQUEST');
  if (request.access_context.source_permission === 'DENIED') return adapterFailure('ACCESS_DENIED');
  if (capabilities.authentication === 'USER_SESSION' && request.access_context.account_binding !== 'VERIFIED') return adapterFailure('LOGIN_REQUIRED');
  return null;
}

export class AdapterCapabilityRegistry {
  readonly #entries = new Map<string, AdapterCapabilities>();

  register(capabilities: AdapterCapabilities): void {
    if (!text(capabilities.adapter_id) || !text(capabilities.adapter_version)) throw new Error('CAPABILITY_ID_INVALID');
    if (this.#entries.has(capabilities.adapter_id)) throw new Error('CAPABILITY_ALREADY_REGISTERED');
    this.#entries.set(capabilities.adapter_id, structuredClone(capabilities));
  }

  get(adapterId: string): AdapterCapabilities | null {
    const entry = this.#entries.get(adapterId);
    return entry ? structuredClone(entry) : null;
  }

  validate(request: unknown): AdapterFailure | null {
    if (!object(request) || !object(request.query) || !text(request.query.adapter_id)) return adapterFailure('INVALID_REQUEST');
    const capabilities = this.#entries.get(request.query.adapter_id);
    return capabilities ? validateAdapterRequest(capabilities, request) : adapterFailure('UNSUPPORTED_OPERATION');
  }
}
