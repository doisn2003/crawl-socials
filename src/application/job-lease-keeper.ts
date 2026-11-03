import type { AsyncConversationStore } from '../infrastructure/storage/async-conversation-store.js';

/** Waiting for a project-wide cooldown must not let another worker reclaim live work. */
export function keepJobLeases(target: AsyncConversationStore, options: {
  onError(error: unknown): void; intervalMs?: number; leaseMs?: number;
}) {
  const owned = new Map<string, string>();
  let work: Promise<void> | null = null, closed = false;
  const timer = setInterval(() => { void refresh(); }, options.intervalMs ?? 30_000);
  timer.unref();
  async function refresh(): Promise<void> {
    if (closed) return;
    if (work) return work;
    work = (async () => {
      for (const [id, token] of owned) {
        if (closed) break;
        const current = await target.getJob(id);
        if (current?.state !== 'RUNNING' || current.lease_token !== token) { owned.delete(id); continue; }
        const renewed = await target.heartbeat(id, token, options.leaseMs ?? 600_000);
        // Completion/pause may have raced the lookup. Only a still-running lost lease is fatal.
        if (!renewed) {
          const latest = await target.getJob(id);
          if (latest?.state === 'RUNNING' && latest.lease_token === token) throw Error('JOB_LEASE_LOST');
          owned.delete(id);
        }
      }
    })().catch(options.onError).finally(() => { work = null; });
    return work;
  }
  const store = new Proxy(target, { get(object, property) {
    if (property === 'claim') return async (...args: Parameters<AsyncConversationStore['claim']>) => {
      const job = await object.claim(...args); if (job?.lease_token) owned.set(job.id, job.lease_token); return job;
    };
    if (property === 'complete' || property === 'retry') return async (id: string, token: string, ...args: unknown[]) => {
      const method = object[property] as (...args: unknown[]) => Promise<boolean>;
      const result = await method(id, token, ...args); if (owned.get(id) === token) owned.delete(id); return result;
    };
    return Reflect.get(object, property);
  } });
  return { store, refresh, async close() { closed = true; clearInterval(timer); await work; owned.clear(); } };
}
