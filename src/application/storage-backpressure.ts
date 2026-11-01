import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, opendir, realpath, statfs } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { contentHash } from '../domain/conversation.js';

/** Operational limits, pinned separately from the user's semantic CampaignPlan. */
export interface StorageLimits {
  max_run_bytes: number;
  min_free_bytes: number;
  in_flight_reserve_bytes: number;
  max_pending_bytes: number;
  max_scan_entries: number;
  max_scan_depth: number;
}
export const DEFAULT_STORAGE_LIMITS: Readonly<StorageLimits> = Object.freeze({
  max_run_bytes: 1024 * 1024 * 1024,
  min_free_bytes: 512 * 1024 * 1024,
  in_flight_reserve_bytes: 64 * 1024 * 1024,
  max_pending_bytes: 64 * 1024 * 1024,
  max_scan_entries: 25000,
  max_scan_depth: 16,
});
export interface PinnedStoragePolicy {
  schema_version: 1;
  campaign_sha256: string;
  limits: StorageLimits;
  recorded_at: string;
  backfilled_on_resume: boolean;
  policy_sha256: string;
}
export interface StorageUsage {
  run_bytes: number;
  free_bytes: number;
  pending_bytes: number;
  files: number;
  entries: number;
  measured_at: string;
}
export type StoragePressure =
  | { state: 'READY'; reason: null }
  | { state: 'BACKLOG'; reason: 'STORAGE_BACKLOG_BYTES_REACHED' }
  | { state: 'STOP'; reason: 'STORAGE_RUN_BYTES_REACHED' | 'STORAGE_DISK_RESERVE_REACHED' };
const filename = 'storage-policy.json';
const keys = Object.keys(DEFAULT_STORAGE_LIMITS).sort();
const safeNonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function validateStorageLimits(limits: StorageLimits): void {
  if (!limits || Object.keys(limits).sort().join(',') !== keys.join(',')
    || !keys.every(key => safeNonnegative(limits[key as keyof StorageLimits]))
    || limits.max_run_bytes < 1 || limits.in_flight_reserve_bytes < 1 || limits.max_pending_bytes < 1
    || limits.max_run_bytes <= limits.in_flight_reserve_bytes
    || limits.min_free_bytes + limits.in_flight_reserve_bytes > Number.MAX_SAFE_INTEGER
    || limits.max_scan_entries < 1 || limits.max_scan_entries > 1000000
    || limits.max_scan_depth < 1 || limits.max_scan_depth > 64) throw Error('STORAGE_LIMITS_INVALID');
}

/** Existing pins always win over installed defaults. Corrupt history is never rewritten. */
export function pinStoragePolicy(input: { directory: string; campaignSha256: string; existingRun: boolean; limits?: StorageLimits; now?: Date }): PinnedStoragePolicy {
  if (!/^[a-f0-9]{64}$/.test(input.campaignSha256) || typeof input.existingRun !== 'boolean') throw Error('STORAGE_POLICY_INPUT_INVALID');
  const file = join(input.directory, filename);
  const read = (): PinnedStoragePolicy => {
    if (statSync(file).size > 65536) throw Error('STORAGE_POLICY_INVALID');
    let policy: PinnedStoragePolicy;
    try { policy = JSON.parse(readFileSync(file, 'utf8')) as PinnedStoragePolicy; } catch { throw Error('STORAGE_POLICY_INVALID'); }
    if (!policy || Object.keys(policy).sort().join(',') !== 'backfilled_on_resume,campaign_sha256,limits,policy_sha256,recorded_at,schema_version'
      || policy.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(policy.campaign_sha256)
      || typeof policy.backfilled_on_resume !== 'boolean' || typeof policy.recorded_at !== 'string' || !Number.isFinite(Date.parse(policy.recorded_at))) throw Error('STORAGE_POLICY_INVALID');
    validateStorageLimits(policy.limits);
    const { policy_sha256, ...body } = policy;
    if (policy_sha256 !== contentHash(body)) throw Error('STORAGE_POLICY_INVALID');
    if (policy.campaign_sha256 !== input.campaignSha256) throw Error('STORAGE_POLICY_CAMPAIGN_MISMATCH');
    return policy;
  };
  if (existsSync(file)) return read();
  // An old empty lock has no verifiable owner. Never guess that it is stale or
  // delete it; a published valid pin above remains readable regardless of it.
  const legacyLock = join(input.directory, '.storage-policy.lock');
  if (existsSync(legacyLock)) throw Error('STORAGE_POLICY_LEGACY_LOCK');
  const limits = { ...(input.limits ?? DEFAULT_STORAGE_LIMITS) }; validateStorageLimits(limits);
  const body = { schema_version: 1 as const, campaign_sha256: input.campaignSha256, limits,
    recorded_at: (input.now ?? new Date()).toISOString(), backfilled_on_resume: input.existingRun };
  const policy: PinnedStoragePolicy = { ...body, policy_sha256: contentHash(body) };
  mkdirSync(input.directory, { recursive: true });
  const temporary = join(input.directory, `.storage-policy-${randomUUID()}.tmp`);
  try {
    if (existsSync(file)) return read();
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(policy) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    if (existsSync(legacyLock)) throw Error('STORAGE_POLICY_LEGACY_LOCK');
    // Atomic no-replace publication of already flushed bytes. A competing winner
    // is read below. A process crash can leave only our unique orphan temp, never
    // a partial final pin or a permanent shared lock. Do not fall back to rename:
    // it could replace another process's already-pinned limits.
    try { linkSync(temporary, file); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        if (['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw Error('STORAGE_POLICY_ATOMIC_PUBLISH_UNSUPPORTED');
        throw Error('STORAGE_POLICY_PUBLISH_FAILED');
      }
    }
    return read();
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

const contained = (root: string, path: string) => { const part = relative(root, path); return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../')); };

/**
 * Read-only point-in-time accounting of the whole run, including raw collectors,
 * model ledgers/cache, SQLite, WAL, and journal. No symlinks/junctions are followed.
 * In-flight work may still grow files; reserve headroom is admission control, not
 * a guarantee against unrelated writers exhausting the physical disk.
 */
export async function measureStorageUsage(input: { directory: string; pendingBytes: number; limits: StorageLimits; now?: Date }): Promise<StorageUsage> {
  validateStorageLimits(input.limits);
  if (!safeNonnegative(input.pendingBytes)) throw Error('STORAGE_PENDING_BYTES_INVALID');
  try {
    const root = await realpath(input.directory), rootStat = await lstat(root, { bigint: true });
    if (!rootStat.isDirectory()) throw Error('STORAGE_ROOT_INVALID');
    const scan = async () => {
      const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
      let bytes = 0n, files = 0, entries = 0;
      while (pending.length) {
        const current = pending.pop()!;
        if (current.depth > input.limits.max_scan_depth) throw Error('STORAGE_SCAN_LIMIT');
        if (!contained(root, await realpath(current.path))) throw Error('STORAGE_PATH_CHANGED');
        const currentStat = await lstat(current.path, { bigint: true });
        if (!currentStat.isDirectory() || currentStat.isSymbolicLink() || currentStat.dev !== rootStat.dev) throw Error('STORAGE_PATH_CHANGED');
        const directory = await opendir(current.path);
        for await (const entry of directory) {
          if (++entries > input.limits.max_scan_entries) throw Error('STORAGE_SCAN_LIMIT');
          const path = join(current.path, entry.name), stat = await lstat(path, { bigint: true });
          if (stat.isSymbolicLink()) throw Error('STORAGE_LINK_NOT_ALLOWED');
          if (stat.dev !== rootStat.dev) throw Error('STORAGE_PATH_CHANGED');
          if (stat.isDirectory()) pending.push({ path, depth: current.depth + 1 });
          else if (stat.isFile()) {
            if (!contained(root, await realpath(path))) throw Error('STORAGE_PATH_CHANGED');
            bytes += stat.size; files++;
            if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('STORAGE_SIZE_UNSUPPORTED');
          } else throw Error('STORAGE_ENTRY_UNSUPPORTED');
        }
      }
      return { bytes, files, entries };
    };
    // Atomic JSON replacement and SQLite cleanup can remove a just-enumerated
    // temporary/WAL file. Re-measure the whole tree instead of undercounting it.
    let measured: Awaited<ReturnType<typeof scan>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { measured = await scan(); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (attempt === 2) throw Error('STORAGE_SCAN_UNSTABLE');
        await sleep(5);
      }
    }
    if (!measured) throw Error('STORAGE_SCAN_UNSTABLE');
    const { bytes, files, entries } = measured;
    const rootAfter = await lstat(root, { bigint: true });
    if (!rootAfter.isDirectory() || rootAfter.dev !== rootStat.dev || rootAfter.ino !== rootStat.ino || await realpath(input.directory) !== root) throw Error('STORAGE_PATH_CHANGED');
    const fs = await statfs(root, { bigint: true }), free = fs.bavail * fs.bsize;
    if (free < 0n || fs.bsize < 1n) throw Error('STORAGE_FREE_SPACE_INVALID');
    return { run_bytes: Number(bytes), free_bytes: Number(free > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : free),
      pending_bytes: input.pendingBytes, files, entries, measured_at: (input.now ?? new Date()).toISOString() };
  } catch (error) {
    if (error instanceof Error && /^STORAGE_[A-Z_]+$/.test(error.message)) throw error;
    throw Error('STORAGE_MEASUREMENT_FAILED');
  }
}

/** Check before acquiring more data; NEVER use this to reject an observed batch. */
export function evaluateStoragePressure(limits: StorageLimits, usage: StorageUsage): StoragePressure {
  validateStorageLimits(limits);
  if (!usage || ![usage.run_bytes, usage.free_bytes, usage.pending_bytes, usage.files, usage.entries].every(safeNonnegative)
    || !Number.isFinite(Date.parse(usage.measured_at))) throw Error('STORAGE_USAGE_INVALID');
  if (usage.run_bytes >= limits.max_run_bytes - limits.in_flight_reserve_bytes) return { state: 'STOP', reason: 'STORAGE_RUN_BYTES_REACHED' };
  if (usage.free_bytes <= limits.min_free_bytes + limits.in_flight_reserve_bytes) return { state: 'STOP', reason: 'STORAGE_DISK_RESERVE_REACHED' };
  if (usage.pending_bytes > limits.max_pending_bytes) return { state: 'BACKLOG', reason: 'STORAGE_BACKLOG_BYTES_REACHED' };
  return { state: 'READY', reason: null };
}
