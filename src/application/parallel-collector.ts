import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CollectorInput, CollectorReceipt } from './production-service.js';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { createFacebookCollectorStore } from '../infrastructure/browser/facebook-collector-store.js';
import { createThreadsCollectorStore } from '../infrastructure/browser/threads-collector-store.js';

const safeCode = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(e.message) ? e.message : 'COLLECTOR_WORKER_FAILED';
const completed = new Set(['QUERY_BUDGET_COMPLETE', 'SOURCE_EXHAUSTED', 'NO_PROGRESS', 'REPLAY_BUDGET_REACHED']);

/** Stable round-robin keyword lanes keep each collector's proven frontier and parser.
 * Only this coordinator writes the aggregate store. Child checkpoints/observers never share a file or webContents. */
export async function runParallelCollectors(input: CollectorInput,
  collectWorker: (input: CollectorInput, workerId: string | null) => Promise<CollectorReceipt>): Promise<CollectorReceipt> {
  const workers = input.config.parallelWorkers ?? 1;
  if (!Number.isSafeInteger(workers) || Number(workers) < 1 || Number(workers) > 3) throw Error('COLLECTOR_WORKERS_INVALID');
  const queries = input.config.queries as string[];
  if (!Array.isArray(queries) || !queries.length || queries.some(q => typeof q !== 'string' || !q.trim())) throw Error('CONFIG_INVALID');
  // Existing saved runs without parallelWorkers continue through the original path.
  if (workers === 1 || queries.length === 1) return collectWorker(input, null);
  const count = Math.min(Number(workers), queries.length), output = String(input.config.output), runId = String(input.config.runId);
  const directory = join(output, 'runs', runId), manifestFile = join(directory, 'manifest.json');
  mkdirSync(directory, { recursive: true });
  const fingerprint = createHash('sha256').update(JSON.stringify(input.config)).digest('hex');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) as { config_sha256: string; started_at: string; run_id: string }
    : { run_id: runId, started_at: new Date().toISOString(), config_sha256: fingerprint, config: input.config };
  if (manifest.config_sha256 !== fingerprint || manifest.run_id !== runId || !Number.isFinite(Date.parse(manifest.started_at))) throw Error('RUN_CONFIG_CHANGED');
  if (!existsSync(manifestFile)) atomicJson(manifestFile, manifest);
  const deadline = Date.parse(manifest.started_at) + Number(input.config.maxMinutes) * 60_000;
  const store = input.platform === 'facebook' ? createFacebookCollectorStore(output) : createThreadsCollectorStore(output);
  let stoppedReason: string | null = null, ingestion: Promise<unknown> = Promise.resolve();
  const initialCount = store.records().filter(row => row.first_observation.run_id.startsWith(runId + '-w')).length;
  let added = 0;
  const statuses = Array.from({ length: count }, (_, index) => ({ worker: index + 1, query: '', state: 'QUEUED', reason: null as string | null }));
  function progress(value: { event?: string } = {}) {
    input.onProgress({ ...value, total: store.count, workers: structuredClone(statuses) });
  }
  // Keep grouping explicit: source barriers and campaign stops take precedence over raw targets.
  function limitReason(): string | null {
    if (stoppedReason) return stoppedReason;
    if (Date.now() > deadline) return 'RUN_DEADLINE';
    const external = input.collectionLimitReason?.(); if (external) return external;
    if (input.platform === 'facebook' ? initialCount + added >= Number(input.config.targetNewRecords) : store.count >= Number(input.config.targetTotal)) return 'TARGET_REACHED';
    return null;
  }
  const outcomes = await Promise.allSettled(statuses.map(async (status, index) => {
    if (input.shouldStop() || limitReason()) {
      status.state = 'STOPPED'; status.reason = input.shouldStop() ? 'USER_STOP' : limitReason(); progress();
      return { stop_reason: status.reason!, summary: { unique: 0 } };
    }
    const workerId = input.platform + '-' + status.worker;
    const config = { ...input.config, parallelWorkers: 1, runId: runId + '-w' + status.worker,
      output: join(output, 'workers', 'worker-' + status.worker), queries: queries.filter((_, i) => i % count === index) };
    status.state = 'RUNNING'; progress();
    try {
      const receipt = await collectWorker({ ...input, config,
        shouldStop: () => input.shouldStop() || stoppedReason !== null,
        collectionLimitReason: limitReason,
        onRecords(rows, provenance) {
          const work = ingestion.then(async () => {
            // Ingest all observations, including changed text/comments on a known ID.
            // Only the raw aggregate is deduplicated; later evidence is never discarded.
            await input.onRecords?.(rows, provenance);
            const saved = input.platform === 'facebook'
              ? (store as ReturnType<typeof createFacebookCollectorStore>).persist(rows as never, provenance as never)
              : (store as ReturnType<typeof createThreadsCollectorStore>).persist(rows as never, provenance as never);
            added += saved.new_records; progress({ event: 'BATCH' });
          });
          ingestion = work.catch(error => { stoppedReason = safeCode(error); });
          return work;
        },
        onProgress(value) {
          if (value.query) status.query = value.query;
          if (['BARRIER', 'HTTP_BARRIER', 'GRAPHQL_BARRIER'].includes(value.event ?? '')) stoppedReason = 'ACCOUNT_BARRIER';
          progress(value.event ? { event: value.event } : {});
        },
      }, workerId);
      status.reason = receipt.stop_reason;
      status.state = completed.has(receipt.stop_reason) ? 'COMPLETED' : 'STOPPED';
      if (!completed.has(receipt.stop_reason) && receipt.stop_reason !== 'TARGET_REACHED') stoppedReason ??= receipt.stop_reason;
      if (receipt.session_flush && receipt.session_flush !== 'OK') { status.state = 'FAILED'; stoppedReason = 'SESSION_SAVE_FAILED'; }
      return receipt;
    } catch (error) { status.state = 'FAILED'; status.reason = safeCode(error); stoppedReason ??= status.reason; throw error; }
    finally { progress(); }
  }));
  await ingestion;
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  const receipts = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
  const summary = store.export();
  const receipt = { stop_reason: stoppedReason ?? (input.shouldStop() ? 'USER_STOP' : limitReason()) ??
    (failed?.status === 'rejected' ? safeCode(failed.reason) : receipts.every(r => r.stop_reason === 'SOURCE_EXHAUSTED') ? 'SOURCE_EXHAUSTED' : 'QUERY_BUDGET_COMPLETE'),
    summary, session_flush: receipts.some(r => r.session_flush && r.session_flush !== 'OK') ? 'FAILED' : 'OK',
    workers: statuses, elapsed_ms: Date.now() - Date.parse(manifest.started_at) };
  atomicJson(join(directory, 'receipt.json'), receipt);
  return receipt;
}
