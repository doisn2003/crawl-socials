import { createHash } from 'node:crypto';
import type { ObserverEvent } from '../application/ports/response-observer.js';

export const PROBE_QUERIES = ['quán cà phê', 'cafe Hà Nội', 'Tiny Cafe'] as const;
export const PROBE_LIMITS = Object.freeze({ wallMs: 1800000, actions: 20, batchesPerQuery: 5,
  candidates: 100, storageBytes: 50 * 1024 * 1024, operatorMs: 600000, retriesPerBatch: 1,
  noProgressBatches: 2, segmentMs: 30000, diagnosticRecords: 2000 });
export type ProbeLimits = typeof PROBE_LIMITS;
export type ProbeReason = 'COMPLETED_FIXTURE' | 'OPERATOR_STOP' | 'DEADLINE_REACHED' | 'CLOCK_UNCERTAIN'
  | 'ACTION_LIMIT' | 'BATCH_LIMIT' | 'CANDIDATE_LIMIT' | 'STORAGE_LIMIT' | 'DIAGNOSTIC_LIMIT'
  | 'OPERATOR_LIMIT' | 'NO_PROGRESS' | 'AUTH_REQUIRED' | 'CHALLENGE' | 'ACCESS_DENIED'
  | 'SCHEMA_FAILURE' | 'COVERAGE_LOST' | 'TARGET_CLOSED' | 'DEVTOOLS_OPENED' | 'SUSPENDED'
  | 'OBSERVER_ERROR' | 'READ_TIMEOUT' | 'DRIVER_ERROR' | 'WRITE_FAILED' | 'START_FAILED' | 'SHUTDOWN';
export interface ProbeCounters {
  actions: number; batches: number[]; retries: number; segments: number;
  diagnosticCaptures: number; capturedBodyBytes: number; candidates: number | null;
  operatorMs: number; externalCostVnd: 0;
}
export interface ProbeStatus {
  state: 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED'; runId: string | null;
  captureMode: 'FIXTURE' | null; startedAt: string | null; deadlineAt: string | null;
  reason: ProbeReason | null; counters: ProbeCounters; persistedBytes: number;
  verifiedValidUniquePosts: 0; sourceCounts: { PAGE: null; PUBLIC_GROUP: null; PUBLIC_PERSONAL: null };
  outputRef: string | null;
}
export const emptyCounters = (): ProbeCounters => ({ actions: 0, batches: [0, 0, 0], retries: 0, segments: 0,
  diagnosticCaptures: 0, capturedBodyBytes: 0, candidates: null, operatorMs: 0, externalCostVnd: 0 });
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error('PROBE_CANONICAL_INVALID'); return encoded;
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export const isRunId = (value: unknown): value is string => typeof value === 'string' && /^probe-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

// Deliberately no body/hash/URL/headers/free text/schema keys in persisted diagnostics.
export function sanitizeProbeCapture(event: ObserverEvent): { observed_at: string; method: 'GET' | 'POST';
  status: number; mime: 'JSON' | 'TEXT' | 'OTHER'; body_bytes: number; response_origin: 'NETWORK' | 'BROWSER_CACHE' | 'SERVICE_WORKER';
  content_disposition: 'OMITTED_UNTRUSTED_CONTENT'; candidate_status: 'UNKNOWN'; source_type: 'UNKNOWN'; relevance: 'UNVERIFIED' } | null {
  if (event.kind !== 'BODY' || !(event.body instanceof Uint8Array) || !Number.isSafeInteger(event.status) || event.status < 100 || event.status > 599 ||
    !['GET', 'POST'].includes(event.method) || !['NETWORK', 'BROWSER_CACHE', 'SERVICE_WORKER'].includes(event.responseOrigin) ||
    typeof event.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.observedAt) || !Number.isFinite(Date.parse(event.observedAt))) return null;
  return { observed_at: event.observedAt, method: event.method, status: event.status,
    mime: event.mimeType === 'application/json' ? 'JSON' : event.mimeType === 'text/plain' ? 'TEXT' : 'OTHER',
    body_bytes: event.body.byteLength, response_origin: event.responseOrigin, content_disposition: 'OMITTED_UNTRUSTED_CONTENT',
    candidate_status: 'UNKNOWN', source_type: 'UNKNOWN', relevance: 'UNVERIFIED' };
}
