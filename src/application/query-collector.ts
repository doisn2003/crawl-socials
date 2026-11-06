import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CollectorInput, CollectorReceipt } from './production-service.js';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { createFacebookCollectorStore } from '../infrastructure/browser/facebook-collector-store.js';
import { createThreadsCollectorStore } from '../infrastructure/browser/threads-collector-store.js';
import { sharedWindows, type createWindowScheduler } from './window-scheduler.js';
import { MAX_SEARCH_QUERIES } from '../shared/collection-limits.js';
type Task = { id: string; worker: number; query: string; state: string; reason: string | null; slices: number; newRecords: number; attempts: number;
  observed?: number; duplicates?: number; elapsedMs?: number; pages?: number; replayPages?: number; warmExtensions?: number; };
const code = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(e.message) ? e.message : 'QUERY_FAILED';

export async function runQueryCollectors(input: CollectorInput, collect: (input: CollectorInput, worker: string | null) => Promise<CollectorReceipt>,
  windows: ReturnType<typeof createWindowScheduler> = sharedWindows): Promise<CollectorReceipt> {
  const queries = input.config.queries as string[], output = String(input.config.output), runId = String(input.config.runId);
  if (!Array.isArray(queries) || !queries.length || queries.length > MAX_SEARCH_QUERIES || queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 200)
    || new Set(queries).size !== queries.length || !Number.isSafeInteger(input.config.maxMinutes) || Number(input.config.maxMinutes) < 1 || Number(input.config.maxMinutes) > 1440) throw Error('CONFIG_INVALID');
  const directory = join(output, 'runs', runId), file = join(directory, 'query-tasks.json'); mkdirSync(directory, { recursive: true });
  const fingerprint = createHash('sha256').update(JSON.stringify(input.config)).digest('hex');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; startedAt: string; tasks: Task[]; expansionExhausted?: boolean } : null;
  if (saved && (saved.fingerprint !== fingerprint || saved.tasks.length < queries.length || queries.some((q, i) => saved.tasks[i]?.query !== q))) throw Error('RUN_CONFIG_CHANGED');
  const startedAt = saved?.startedAt ?? new Date().toISOString();
  const manifestFile = join(directory, 'manifest.json');
  if (!existsSync(manifestFile)) atomicJson(manifestFile, { run_id: runId, started_at: startedAt, config_sha256: fingerprint, config: input.config });
  const tasks: Task[] = saved?.tasks ?? queries.map((query, i) => ({ id: createHash('sha256').update(input.platform + ':' + input.profileId + ':' + query).digest('hex').slice(0, 16),
    worker: i + 1, query, state: 'QUEUED', reason: null, slices: 0, newRecords: 0, attempts: 0 }));
  for (const task of tasks) if (!['COMPLETED'].includes(task.state)) { task.state = 'QUEUED'; task.reason = null; }
  const deadline = Date.parse(startedAt) + Number(input.config.maxMinutes) * 60000;
  const store = input.platform === 'facebook' ? createFacebookCollectorStore(output) : createThreadsCollectorStore(output);
  let barrier: string | null = null, ingestion: Promise<unknown> = Promise.resolve(), expansionExhausted = saved?.expansionExhausted ?? false, expansionError: string | null = null;
  const stopReason = () => input.shouldStop() ? 'USER_STOP' : barrier ?? input.collectionLimitReason?.() ?? (Date.now() >= deadline ? 'RUN_DEADLINE' : null);
  function publish() { atomicJson(file, { fingerprint, startedAt, tasks, resources: windows.status(), expansionError, expansionExhausted }); input.onProgress({ total: store.count, workers: structuredClone(tasks) }); }
  publish();
  // Every task gets its first bounded slice before any task receives a deeper slice.
  while (tasks.some(t => t.state === 'QUEUED') && !stopReason()) {
    const round = Math.min(...tasks.filter(t => t.state === 'QUEUED').map(t => t.slices));
    const pending = tasks.filter(t => t.state === 'QUEUED' && t.slices === round).sort((a, b) =>
      (input.queryPriority?.(b.query) ?? 0) - (input.queryPriority?.(a.query) ?? 0) || b.newRecords - a.newRecords || a.worker - b.worker);
    await Promise.all(pending.map(async task => {
      let lease: Awaited<ReturnType<typeof windows.acquire>> | undefined, taskStarted = 0, freshPage = false;
      const resourceYield = () => {
        if (!lease?.shouldYield()) return false;
        if (windows.status().freeBytes < 512 * 1024 * 1024) return true;
        // CPU pressure limits new admissions; a resumed window must reach new depth first.
        return freshPage || Date.now() - taskStarted >= 120000;
      };
      try {
        lease = await windows.acquire(input.platform, input.config.windowMode === 'ALL', () => !!stopReason(), input.profileId);
        taskStarted = Date.now();
        task.state = 'RUNNING'; task.attempts++; publish();
        const childId = runId.slice(0, 61) + '-q' + task.id;
        const child = { ...input.config, queryTaskPolicy: undefined, parallelWorkers: 1, runId: childId,
          output: join(output, 'queries', task.id), queries: [task.query], maxScrollsPerQuery: 3, includeContextCandidates: true };
        const receipt = await collect({ ...input, config: child, resume: input.resume || task.attempts > 1,
          shouldStop: () => !!stopReason(), collectionLimitReason: () => stopReason() ?? (resourceYield() ? 'RESOURCE_YIELD' : null),
          continueQuerySlice: () => !!input.config.warmPageLimit && !stopReason() && !resourceYield()
            && !tasks.some(t => t.state === 'QUEUED' && t.slices === 0)
            && Date.now() - taskStarted < 120000,
          onRecords(rows, provenance) {
            const work = ingestion.then(async () => {
              await input.onRecords?.(rows, provenance);
              const result = input.platform === 'facebook' ? (store as ReturnType<typeof createFacebookCollectorStore>).persist(rows as never, provenance as never)
                : (store as ReturnType<typeof createThreadsCollectorStore>).persist(rows as never, provenance as never);
              task.newRecords += result.new_records; task.observed = (task.observed ?? 0) + rows.length;
              task.duplicates = (task.duplicates ?? 0) + rows.length - result.new_records; publish();
            }); ingestion = work.catch(error => { barrier = code(error); }); return work;
          },
          onProgress(value) {
            if (['BARRIER', 'HTTP_BARRIER', 'GRAPHQL_BARRIER'].includes(value.event ?? '')) barrier = 'ACCOUNT_BARRIER';
            const details = value as typeof value & { replaying?: boolean };
            if (value.event === 'YIELD' && details.replaying === false) freshPage = true;
            if (value.event === 'YIELD') { task.pages = (task.pages ?? 0) + 1; if (details.replaying) task.replayPages = (task.replayPages ?? 0) + 1; }
            if (value.event === 'WARM_SLICE') task.warmExtensions = (task.warmExtensions ?? 0) + 1;
          },
        }, input.platform + '-' + task.id);
        task.reason = receipt.stop_reason;
        if (receipt.session_flush && receipt.session_flush !== 'OK') { task.state = 'FAILED'; task.reason = 'SESSION_SAVE_FAILED'; barrier = task.reason; }
        else if (receipt.stop_reason === 'ACCOUNT_BARRIER') { barrier = receipt.stop_reason; task.state = 'STOPPED'; }
        else if (['QUERY_BUDGET_COMPLETE', 'RESOURCE_YIELD'].includes(receipt.stop_reason)) {
          const maxSlices = Math.ceil(Number(input.config.maxReplayPages ?? 100) / 3) + 2;
          task.slices++; task.state = task.slices < maxSlices ? 'QUEUED' : 'STOPPED';
          if (task.slices >= maxSlices) task.reason = 'REPLAY_BUDGET_REACHED';
        } else task.state = ['SOURCE_EXHAUSTED', 'NO_PROGRESS'].includes(receipt.stop_reason) ? 'COMPLETED' : 'STOPPED';
      } catch (error) { task.state = 'FAILED'; task.reason = stopReason() ?? code(error); }
      finally { if (taskStarted) task.elapsedMs = (task.elapsedMs ?? 0) + Date.now() - taskStarted; lease?.release(); publish(); }
    }));
    // Resume can begin at slice > 0; still consult the persisted once-per-campaign expansion.
    if (!stopReason() && !expansionExhausted && tasks.length < MAX_SEARCH_QUERIES && input.expandQueries) {
      let expanded: string[] = [];
      try { expanded = await input.expandQueries(); }
      catch (error) { expansionError = code(error); expansionExhausted = true; input.onProgress({ event: 'QUERY_EXPANSION_FAILED' }); }
      if (!expanded.length) expansionExhausted = true;
      for (const query of expanded) if (tasks.length < MAX_SEARCH_QUERIES && typeof query === 'string' && query.trim() && query.length <= 200 && !tasks.some(t => t.query === query)) tasks.push({
        id: createHash('sha256').update(input.platform + ':' + input.profileId + ':' + query).digest('hex').slice(0, 16),
        worker: tasks.length + 1, query, state: 'QUEUED', reason: null, slices: 0, newRecords: 0, attempts: 0 });
      publish();
    }
  }
  await ingestion;
  for (const task of tasks) if (task.state === 'QUEUED') { task.state = 'STOPPED'; task.reason = stopReason() ?? 'QUERY_NOT_RUN'; }
  publish();
  const reason = stopReason() ?? (tasks.every(t => t.reason === 'SOURCE_EXHAUSTED') ? 'SOURCE_EXHAUSTED'
    : tasks.some(t => t.state === 'FAILED') ? 'QUERY_WORKER_FAILED' : 'QUERY_BUDGET_COMPLETE');
  const receipt = { stop_reason: reason, summary: store.export(), workers: tasks, expansion_error: expansionError, session_flush: barrier === 'SESSION_SAVE_FAILED' ? 'FAILED' : 'OK' };
  atomicJson(join(directory, 'receipt.json'), receipt); return receipt;
}
