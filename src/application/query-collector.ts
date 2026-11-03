import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CollectorInput, CollectorReceipt } from './production-service.js';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { createFacebookCollectorStore } from '../infrastructure/browser/facebook-collector-store.js';
import { createThreadsCollectorStore } from '../infrastructure/browser/threads-collector-store.js';
import { sharedWindows, type createWindowScheduler } from './window-scheduler.js';
type Task = { id: string; worker: number; query: string; state: string; reason: string | null; slices: number; newRecords: number; attempts: number; };
const code = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(e.message) ? e.message : 'QUERY_FAILED';

export async function runQueryCollectors(input: CollectorInput, collect: (input: CollectorInput, worker: string | null) => Promise<CollectorReceipt>,
  windows: ReturnType<typeof createWindowScheduler> = sharedWindows): Promise<CollectorReceipt> {
  const queries = input.config.queries as string[], output = String(input.config.output), runId = String(input.config.runId);
  if (!Array.isArray(queries) || !queries.length || new Set(queries).size !== queries.length) throw Error('CONFIG_INVALID');
  const directory = join(output, 'runs', runId), file = join(directory, 'query-tasks.json'); mkdirSync(directory, { recursive: true });
  const fingerprint = createHash('sha256').update(JSON.stringify(input.config)).digest('hex');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; startedAt: string; tasks: Task[] } : null;
  if (saved && (saved.fingerprint !== fingerprint || saved.tasks.length < queries.length || queries.some((q, i) => saved.tasks[i]?.query !== q))) throw Error('RUN_CONFIG_CHANGED');
  const startedAt = saved?.startedAt ?? new Date().toISOString();
  const tasks = saved?.tasks ?? queries.map((query, i) => ({ id: createHash('sha256').update(input.platform + ':' + input.profileId + ':' + query).digest('hex').slice(0, 16),
    worker: i + 1, query, state: 'QUEUED', reason: null, slices: 0, newRecords: 0, attempts: 0 }));
  for (const task of tasks) if (!['COMPLETED'].includes(task.state)) { task.state = 'QUEUED'; task.reason = null; }
  const deadline = Date.parse(startedAt) + Number(input.config.maxMinutes) * 60000;
  const store = input.platform === 'facebook' ? createFacebookCollectorStore(output) : createThreadsCollectorStore(output);
  let barrier: string | null = null, ingestion: Promise<unknown> = Promise.resolve();
  const stopReason = () => input.shouldStop() ? 'USER_STOP' : barrier ?? input.collectionLimitReason?.() ?? (Date.now() >= deadline ? 'RUN_DEADLINE' : null);
  function publish() { atomicJson(file, { fingerprint, startedAt, tasks, resources: windows.status() }); input.onProgress({ total: store.count, workers: structuredClone(tasks) }); }
  publish();
  // Every task gets its first bounded slice before any task receives a deeper slice.
  while (tasks.some(t => t.state === 'QUEUED') && !stopReason()) {
    const round = Math.min(...tasks.filter(t => t.state === 'QUEUED').map(t => t.slices));
    const pending = tasks.filter(t => t.state === 'QUEUED' && t.slices === round).sort((a, b) =>
      (input.queryPriority?.(b.query) ?? 0) - (input.queryPriority?.(a.query) ?? 0) || b.newRecords - a.newRecords || a.worker - b.worker);
    await Promise.all(pending.map(async task => {
      let lease: Awaited<ReturnType<typeof windows.acquire>> | undefined;
      try {
        lease = await windows.acquire(input.platform, input.config.windowMode === 'ALL', () => !!stopReason());
        task.state = 'RUNNING'; task.attempts++; publish();
        const childId = runId + '-q' + task.id;
        const child = { ...input.config, queryTaskPolicy: undefined, parallelWorkers: 1, runId: childId,
          output: join(output, 'queries', task.id), queries: [task.query], maxScrollsPerQuery: 3, includeContextCandidates: true };
        const receipt = await collect({ ...input, config: child, resume: input.resume || task.attempts > 1,
          shouldStop: () => !!stopReason(), collectionLimitReason: () => stopReason() ?? (lease!.shouldYield() ? 'RESOURCE_YIELD' : null),
          onRecords(rows, provenance) {
            const work = ingestion.then(async () => {
              await input.onRecords?.(rows, provenance);
              const result = input.platform === 'facebook' ? (store as ReturnType<typeof createFacebookCollectorStore>).persist(rows as never, provenance as never)
                : (store as ReturnType<typeof createThreadsCollectorStore>).persist(rows as never, provenance as never);
              task.newRecords += result.new_records; publish();
            }); ingestion = work.catch(error => { barrier = code(error); }); return work;
          },
          onProgress(value) { if (['BARRIER', 'HTTP_BARRIER', 'GRAPHQL_BARRIER'].includes(value.event ?? '')) barrier = 'ACCOUNT_BARRIER'; },
        }, input.platform + '-' + task.id);
        task.reason = receipt.stop_reason;
        if (receipt.session_flush && receipt.session_flush !== 'OK') { task.state = 'FAILED'; task.reason = 'SESSION_SAVE_FAILED'; barrier = task.reason; }
        else if (receipt.stop_reason === 'ACCOUNT_BARRIER') { barrier = receipt.stop_reason; task.state = 'STOPPED'; }
        else if (['QUERY_BUDGET_COMPLETE', 'RESOURCE_YIELD'].includes(receipt.stop_reason)) {
          task.slices++; task.state = task.slices < 36 ? 'QUEUED' : 'STOPPED';
          if (task.slices >= 36) task.reason = 'REPLAY_BUDGET_REACHED';
        } else task.state = ['SOURCE_EXHAUSTED', 'NO_PROGRESS'].includes(receipt.stop_reason) ? 'COMPLETED' : 'STOPPED';
      } catch (error) { task.state = 'FAILED'; task.reason = stopReason() ?? code(error); }
      finally { lease?.release(); publish(); }
    }));
    if (!stopReason() && round === 0 && input.expandQueries) {
      for (const query of await input.expandQueries()) if (tasks.length < 100 && !tasks.some(t => t.query === query)) tasks.push({
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
  const receipt = { stop_reason: reason, summary: store.export(), workers: tasks, session_flush: barrier === 'SESSION_SAVE_FAILED' ? 'FAILED' : 'OK' };
  atomicJson(join(directory, 'receipt.json'), receipt); return receipt;
}
