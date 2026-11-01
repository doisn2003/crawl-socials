import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Platform } from '../shared/production-api.js';

export interface DiscoveryAttemptRecord {
  schema_version: '1.0.0';
  platform: Platform;
  run_id: string;
  previous_run_id: string;
  reason: 'PREVIOUS_ATTEMPT_DEADLINE_EXPIRED';
  prepared_at: string;
  previous_started_at: string;
  previous_deadline_at: string;
  previous_config_sha256: string;
  allocation_total: number;
  cumulative_raw_before: number;
  remaining_raw_allocation: number;
  attempt_target: number;
  checkpoint_policy: 'FRESH_SEARCH_WITH_GLOBAL_DEDUP';
}
export interface DiscoveryAttemptInput {
  config: Record<string, unknown>;
  platform: Platform;
  cumulativeRawCount: number;
  /** The production campaign's cumulative allocation, not a renewed quota per attempt. */
  allocationTotal?: number;
  now?: Date;
}
export interface PreparedDiscoveryAttempt {
  kind: 'RESUME_EXISTING' | 'NEW_ATTEMPT' | 'ALLOCATION_COMPLETE';
  config: Record<string, unknown>;
  resume: boolean;
  attempt: DiscoveryAttemptRecord | null;
  recordPath: string | null;
}
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Read-only preparation for an explicit Resume. Never edits a previous manifest or resets campaign cost.
 * The caller persists `attempt` at `recordPath`, then invokes the collector with returned config/resume.
 * Search restarts at query zero; the shared output store still deduplicates all prior attempts.
 */
export function prepareDiscoveryAttempt(input: DiscoveryAttemptInput): PreparedDiscoveryAttempt {
  const config = structuredClone(input.config), runId = config.runId, output = config.output, minutes = config.maxMinutes;
  if (!['facebook', 'threads'].includes(input.platform) || typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(runId)
    || typeof output !== 'string' || !isAbsolute(output) || !positiveInteger(minutes) || minutes > 240
    || !Number.isSafeInteger(input.cumulativeRawCount) || input.cumulativeRawCount < 0
    || (input.allocationTotal !== undefined && !positiveInteger(input.allocationTotal))) throw Error('DISCOVERY_ATTEMPT_INPUT_INVALID');
  const target = input.platform === 'facebook' ? config.targetNewRecords : config.targetTotal;
  if (!positiveInteger(target)) throw Error('DISCOVERY_ATTEMPT_TARGET_INVALID');
  const now = input.now ?? new Date(); if (!Number.isFinite(now.getTime())) throw Error('DISCOVERY_ATTEMPT_TIME_INVALID');
  const existing: PreparedDiscoveryAttempt = { kind: 'RESUME_EXISTING', config, resume: true, attempt: null, recordPath: null };
  const manifestPath = join(output, 'runs', runId, 'manifest.json');
  if (!existsSync(manifestPath)) return existing;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { run_id?: string; started_at?: string; config_sha256?: string };
  const started = Date.parse(manifest.started_at ?? '');
  if (manifest.run_id !== runId || !Number.isFinite(started)) throw Error('DISCOVERY_ATTEMPT_MANIFEST_INVALID');
  const fingerprint = hash(config);
  if (manifest.config_sha256 !== fingerprint) throw Error('DISCOVERY_ATTEMPT_CONFIG_MISMATCH');
  const deadline = started + minutes * 60000;
  // A completed query *slice* is not a completed source. Intent collectors keep
  // their durable frontier beside this manifest and can resume it immediately.
  // Never renew the attempt merely because its old receipt says query budget
  // complete: reuse this identity and the original remaining wall-clock budget.
  if (now.getTime() <= deadline) return existing;

  const priorRecordPath = join(output, 'runs', runId, 'discovery-attempt.json');
  let priorRecord: DiscoveryAttemptRecord | null = null;
  if (existsSync(priorRecordPath)) {
    priorRecord = JSON.parse(readFileSync(priorRecordPath, 'utf8')) as DiscoveryAttemptRecord;
    if (priorRecord.schema_version !== '1.0.0' || priorRecord.run_id !== runId || priorRecord.platform !== input.platform || !positiveInteger(priorRecord.allocation_total)) throw Error('DISCOVERY_ATTEMPT_RECORD_INVALID');
  }
  const allocation = input.allocationTotal ?? priorRecord?.allocation_total ?? target;
  // Explicit Resume extends wall-clock opportunity only. It cannot silently increase the raw allocation.
  if (priorRecord && allocation > priorRecord.allocation_total) throw Error('DISCOVERY_ATTEMPT_ALLOCATION_INCREASE');
  if (input.platform === 'threads' && allocation !== target) throw Error('DISCOVERY_ATTEMPT_CUMULATIVE_TARGET_MISMATCH');
  const remaining = allocation - input.cumulativeRawCount;
  if (remaining <= 0) return { ...existing, kind: 'ALLOCATION_COMPLETE', resume: false };

  const base = runId.replace(/-a[0-9a-f]{12}$/, '');
  const suffix = '-a' + randomUUID().replaceAll('-', '').slice(0, 12);
  const nextId = base.slice(0, 80 - suffix.length) + suffix;
  const recordPath = join(output, 'runs', nextId, 'discovery-attempt.json');
  if (existsSync(recordPath) || existsSync(join(output, 'runs', nextId, 'manifest.json'))) throw Error('DISCOVERY_ATTEMPT_ID_COLLISION');
  const attemptTarget = input.platform === 'facebook' ? Math.min(remaining, 3000) : target;
  const nextConfig: Record<string, unknown> = { ...config, runId: nextId, ...(input.platform === 'facebook' ? { targetNewRecords: attemptTarget } : {}) };
  const attempt: DiscoveryAttemptRecord = {
    schema_version: '1.0.0', platform: input.platform, run_id: nextId, previous_run_id: runId,
    reason: 'PREVIOUS_ATTEMPT_DEADLINE_EXPIRED', prepared_at: now.toISOString(), previous_started_at: new Date(started).toISOString(), previous_deadline_at: new Date(deadline).toISOString(),
    previous_config_sha256: fingerprint, allocation_total: allocation, cumulative_raw_before: input.cumulativeRawCount,
    remaining_raw_allocation: remaining, attempt_target: attemptTarget, checkpoint_policy: 'FRESH_SEARCH_WITH_GLOBAL_DEDUP',
  };
  return { kind: 'NEW_ATTEMPT', config: nextConfig, resume: false, attempt, recordPath };
}
