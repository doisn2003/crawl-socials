import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CollectorInput, CollectorReceipt } from './production-service.js';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { createFacebookCollectorStore } from '../infrastructure/browser/facebook-collector-store.js';
import { createThreadsCollectorStore } from '../infrastructure/browser/threads-collector-store.js';
import { sharedWindows, type createWindowScheduler } from './window-scheduler.js';
import { MAX_SEARCH_QUERIES } from '../shared/collection-limits.js';
import { setTimeout as sleep } from 'node:timers/promises';
type Task = { id: string; worker: number; query: string; state: string; reason: string | null; slices: number; newRecords: number; attempts: number;
  observed?: number; duplicates?: number; elapsedMs?: number; pages?: number; replayPages?: number; warmExtensions?: number;
  stallRecoveries?: number; retryAt?: number | null; recoveryPending?: boolean; diagnostics?: unknown; };
const code = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(e.message) ? e.message : 'QUERY_FAILED';
// Keep aligned with discovery-frontier.mjs; this grants one recovery after the renderer fix, not a budget reset.
const COLLECTOR_REVISION = 'offscreen-rendering-v1';

export async function runQueryCollectors(input: CollectorInput, collect: (input: CollectorInput, worker: string | null) => Promise<CollectorReceipt>,
  windows: ReturnType<typeof createWindowScheduler> = sharedWindows,
  runtime: { now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}): Promise<CollectorReceipt> {
  const now = runtime.now ?? Date.now, wait = runtime.sleep ?? sleep;
  const queries = input.config.queries as string[], output = String(input.config.output), runId = String(input.config.runId);
  if (!Array.isArray(queries) || !queries.length || queries.length > MAX_SEARCH_QUERIES || queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 200)
    || new Set(queries).size !== queries.length || !Number.isSafeInteger(input.config.maxMinutes) || Number(input.config.maxMinutes) < 1 || Number(input.config.maxMinutes) > 1440) throw Error('CONFIG_INVALID');
  const directory = join(output, 'runs', runId), file = join(directory, 'query-tasks.json'); mkdirSync(directory, { recursive: true });
  const fingerprint = createHash('sha256').update(JSON.stringify(input.config)).digest('hex');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; startedAt: string; tasks: Task[]; expansionExhausted?: boolean; collectorRevision?: string; renderingMigration?: unknown } : null;
  if (saved && (saved.fingerprint !== fingerprint || saved.tasks.length < queries.length || queries.some((q, i) => saved.tasks[i]?.query !== q))) throw Error('RUN_CONFIG_CHANGED');
  const startedAt = saved?.startedAt ?? new Date().toISOString();
  const manifestFile = join(directory, 'manifest.json');
  if (!existsSync(manifestFile)) atomicJson(manifestFile, { run_id: runId, started_at: startedAt, config_sha256: fingerprint, config: input.config });
  const tasks: Task[] = saved?.tasks ?? queries.map((query, i) => ({ id: createHash('sha256').update(input.platform + ':' + input.profileId + ':' + query).digest('hex').slice(0, 16),
    worker: i + 1, query, state: 'QUEUED', reason: null, slices: 0, newRecords: 0, attempts: 0 }));
  const renderingMigration = saved && saved.collectorRevision !== COLLECTOR_REVISION
    ? { from: saved.collectorRevision ?? 'hidden-native-v0', to: COLLECTOR_REVISION,
      previous: tasks.map(t => ({ id: t.id, state: t.state, reason: t.reason, stallRecoveries: t.stallRecoveries ?? 0, retryAt: t.retryAt ?? null })) }
    : saved?.renderingMigration;
  for (const task of tasks) {
    if (saved && saved.collectorRevision !== COLLECTOR_REVISION && task.state !== 'COMPLETED' && task.attempts > 0) {
      task.state = 'QUEUED'; task.retryAt = null; task.recoveryPending = true; continue;
    }
    // Resume retains both the cooldown and the campaign's recovery allowance.
    if (task.retryAt) { task.state = 'COOLDOWN'; continue; }
    if (task.state === 'COMPLETED' || task.state === 'COOLDOWN' || (task.reason === 'NO_PROGRESS' && (task.stallRecoveries ?? 0) >= 2)) continue;
    task.state = 'QUEUED'; task.reason = null;
  }
  const deadline = Date.parse(startedAt) + Number(input.config.maxMinutes) * 60000;
  const store = input.platform === 'facebook' ? createFacebookCollectorStore(output) : createThreadsCollectorStore(output);
  let barrier: string | null = null, ingestion: Promise<unknown> = Promise.resolve(), expansionExhausted = saved?.expansionExhausted ?? false, expansionError: string | null = null;
  let expansionFailures = 0, expansionDeferred = false;
  const stopReason = () => input.shouldStop() ? 'USER_STOP' : barrier ?? input.collectionLimitReason?.() ?? (now() >= deadline ? 'RUN_DEADLINE' : null);
  function publish() { atomicJson(file, { fingerprint, startedAt, tasks, resources: windows.status(), expansionError, expansionExhausted,
    expansionDeferred, collectorRevision: COLLECTOR_REVISION, ...(renderingMigration ? { renderingMigration } : {}) }); input.onProgress({ total: store.count, workers: structuredClone(tasks), resources: windows.status() }); }
  async function expand(completeInitial = false) {
    if (stopReason() || !input.expandQueries || tasks.length >= MAX_SEARCH_QUERIES || (!completeInitial && (expansionExhausted || expansionDeferred))) return;
    try {
      const expanded = await input.expandQueries({ knownQueries: tasks.map(t => t.query), completeInitial });
      expansionExhausted = !completeInitial && !expanded.length; expansionError = null;
      for (const query of expanded) if (tasks.length < MAX_SEARCH_QUERIES && typeof query === 'string' && query.trim() && query.length <= 200 && !tasks.some(t => t.query === query)) tasks.push({
        id: createHash('sha256').update(input.platform + ':' + input.profileId + ':' + query).digest('hex').slice(0, 16),
        worker: tasks.length + 1, query, state: 'QUEUED', reason: null, slices: 0, newRecords: 0, attempts: 0 });
    } catch (error) {
      expansionError = code(error);
      const incomplete = ['QUERY_COVERAGE_INCOMPLETE', 'QUERY_EXPANSION_INVALID', 'QUERY_EXPANSION_UNGROUNDED'].includes(expansionError);
      expansionExhausted = !incomplete; expansionDeferred = incomplete && ++expansionFailures >= 3;
      input.onProgress({ event: 'QUERY_EXPANSION_FAILED' });
    }
    publish();
  }
  publish();
  // Even a previously terminal collector must consult the versioned shared portfolio on explicit resume.
  await expand(true);
  // Every task gets a bounded first turn; productive windows may keep one extra warm slice.
  // Keep resource waits visible/durable even when no child has ever been admitted.
  let heartbeatError: unknown;
  const heartbeat = setInterval(() => {
    try { publish(); }
    catch (error) { heartbeatError = error; barrier ??= code(error); }
  }, 2000);
  try {
  while (tasks.some(t => t.state === 'QUEUED' || t.state === 'COOLDOWN') && !stopReason()) {
    for (const task of tasks) if (task.state === 'COOLDOWN' && (task.retryAt ?? 0) <= now()) { task.state = 'QUEUED'; task.retryAt = null; }
    if (!tasks.some(t => t.state === 'QUEUED')) {
      // No Electron window is held while cooling down. Check Stop/deadline every 250 ms.
      await wait(Math.min(250, Math.max(1, Math.min(...tasks.filter(t => t.state === 'COOLDOWN').map(t => t.retryAt ?? now())) - now())));
      continue;
    }
    const round = Math.min(...tasks.filter(t => t.state === 'QUEUED').map(t => t.slices));
    const pending = tasks.filter(t => t.state === 'QUEUED' && t.slices === round).sort((a, b) =>
      (input.queryPriority?.(b.query) ?? 0) - (input.queryPriority?.(a.query) ?? 0) || b.newRecords - a.newRecords || a.worker - b.worker);
    await Promise.all(pending.map(async task => {
      let lease: Awaited<ReturnType<typeof windows.acquire>> | undefined, taskStarted = 0, freshPage = false, freshPages = 0;
      const resourceYield = () => {
        if (!lease?.shouldYield()) return false;
        if (windows.status().freeBytes < 512 * 1024 * 1024) return true;
        // CPU pressure limits new admissions; a resumed window must reach new depth first.
        return freshPage || now() - taskStarted >= 120000;
      };
      try {
        lease = await windows.acquire(input.platform, input.config.windowMode === 'ALL', () => !!stopReason(), input.profileId);
        taskStarted = now();
        task.state = 'RUNNING'; task.attempts++; publish();
        const childId = runId.slice(0, 61) + '-q' + task.id;
        const child = { ...input.config, queryTaskPolicy: undefined, parallelWorkers: 1, runId: childId,
          output: join(output, 'queries', task.id), queries: [task.query], maxScrollsPerQuery: 3, includeContextCandidates: true };
        const receipt = await collect({ ...input, config: child, resume: input.resume || task.attempts > 1,
          recoverStalled: task.recoveryPending === true,
          shouldStop: () => !!stopReason(), collectionLimitReason: () => stopReason() ?? (resourceYield() ? 'RESOURCE_YIELD' : null),
          continueQuerySlice: () => !!input.config.warmPageLimit && !stopReason() && !resourceYield()
            && (freshPages < 6 || !tasks.some(t => t.state === 'QUEUED' && t.attempts === 0))
            && now() - taskStarted < 120000,
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
            if (value.event === 'YIELD' && details.replaying === false) { freshPage = true; freshPages++; }
            if (value.event === 'YIELD') { task.pages = (task.pages ?? 0) + 1; if (details.replaying) task.replayPages = (task.replayPages ?? 0) + 1; }
            if (value.event === 'WARM_SLICE') task.warmExtensions = (task.warmExtensions ?? 0) + 1;
          },
        }, input.platform + '-' + task.id);
        task.recoveryPending = false;
        task.reason = receipt.stop_reason;
        task.diagnostics = (receipt as CollectorReceipt & { diagnostics?: unknown }).diagnostics ?? task.diagnostics;
        const frontier = (receipt as CollectorReceipt & { checkpoint?: { discovery_frontier?: { jobs?: { state: string; reason: string | null }[] } } }).checkpoint?.discovery_frontier?.jobs;
        const stalled = Array.isArray(frontier) && frontier.length > 0
          && frontier.every(job => (job.state === 'STALLED' && job.reason === 'NO_PROGRESS') || (job.state === 'EXHAUSTED' && job.reason === 'NATIVE_END_OBSERVED'))
          && frontier.some(job => job.state === 'STALLED');
        if (receipt.session_flush && receipt.session_flush !== 'OK') { task.state = 'FAILED'; task.reason = 'SESSION_SAVE_FAILED'; barrier = task.reason; }
        else if (receipt.stop_reason === 'ACCOUNT_BARRIER') { barrier = receipt.stop_reason; task.state = 'STOPPED'; }
        else if (stalled || receipt.stop_reason === 'NO_PROGRESS') {
          task.reason = 'NO_PROGRESS';
          if ((task.stallRecoveries ?? 0) < 2 && !stopReason()) {
            task.stallRecoveries = (task.stallRecoveries ?? 0) + 1;
            task.retryAt = now() + (task.stallRecoveries === 1 ? 30000 : 90000);
            task.recoveryPending = true;
            task.state = 'COOLDOWN';
          } else task.state = 'STOPPED';
        }
        else if (['QUERY_BUDGET_COMPLETE', 'RESOURCE_YIELD'].includes(receipt.stop_reason)) {
          const maxSlices = Math.ceil(Number(input.config.maxReplayPages ?? 100) / 3) + 2;
          task.slices++; task.state = task.slices < maxSlices ? 'QUEUED' : 'STOPPED';
          if (task.slices >= maxSlices) task.reason = 'REPLAY_BUDGET_REACHED';
        } else task.state = ['SOURCE_EXHAUSTED', 'NO_PROGRESS'].includes(receipt.stop_reason) ? 'COMPLETED' : 'STOPPED';
      } catch (error) {
        if (code(error) === 'RESOURCE_MEMORY_WAIT') barrier ??= 'RESOURCE_MEMORY_WAIT';
        task.reason = stopReason() ?? code(error);
        task.state = ['USER_STOP', 'RUN_DEADLINE', 'INTENT_TARGET_REACHED', 'RAW_BUDGET_REACHED', 'RESOURCE_MEMORY_WAIT'].includes(task.reason) ? 'STOPPED' : 'FAILED';
      }
      finally { if (taskStarted) task.elapsedMs = (task.elapsedMs ?? 0) + now() - taskStarted; lease?.release(); publish(); }
    }));
    // Each completed round can consume or request the next shared, durably bounded query wave.
    await expand();
  }
  await ingestion;
  if (heartbeatError) throw heartbeatError;
  for (const task of tasks) if (task.state === 'QUEUED' || task.state === 'COOLDOWN') { task.state = 'STOPPED'; task.reason = stopReason() ?? 'QUERY_NOT_RUN'; }
  publish();
  const reason = stopReason() ?? (!expansionError && !expansionDeferred && tasks.every(t => t.reason === 'SOURCE_EXHAUSTED') ? 'SOURCE_EXHAUSTED'
    : tasks.some(t => t.state === 'FAILED') ? 'QUERY_WORKER_FAILED' : 'QUERY_BUDGET_COMPLETE');
  const receipt = { stop_reason: reason, summary: store.export(), workers: tasks, expansion_error: expansionError, session_flush: barrier === 'SESSION_SAVE_FAILED' ? 'FAILED' : 'OK' };
  atomicJson(join(directory, 'receipt.json'), receipt); return receipt;
  } finally { clearInterval(heartbeat); }
}
