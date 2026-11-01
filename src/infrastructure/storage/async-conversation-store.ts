import { Worker } from 'node:worker_threads';
import type { ConversationStore } from './conversation-store.js';
import type { StoreMethodName, StoreWorkerResponse } from './conversation-store-worker.js';

export type AsyncConversationStore = {
  [K in StoreMethodName]: ConversationStore[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never
};

/** All SQLite/journal work runs outside Electron's main/renderer event loops. */
export async function createAsyncConversationStore(directory: string): Promise<AsyncConversationStore> {
  const worker = new Worker(new URL('./conversation-store-worker.js', import.meta.url), { workerData: { directory } });
  let sequence = 0, closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let resolveReady: () => void, rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = (error: Error) => { rejectReady(error); for (const entry of pending.values()) entry.reject(error); pending.clear(); closed = true; };
  worker.on('message', (message: StoreWorkerResponse) => {
    if (message.ready === true) { resolveReady(); return; }
    if (message.ready === false) { fail(Error(message.error ?? 'STORE_STARTUP_FAILED')); return; }
    if (message.id === undefined) return;
    const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id);
    if (message.error) entry.reject(Error(message.error)); else entry.resolve(message.value);
  });
  worker.on('error', fail);
  worker.on('exit', code => { if (!closed || pending.size) fail(Error(`STORE_WORKER_EXITED_${code}`)); });
  await ready;
  const invoke = async (method: StoreMethodName, args: unknown[]): Promise<unknown> => {
    if (closed) { if (method === 'close') return; throw Error('CONVERSATION_STORE_CLOSED'); }
    const id = ++sequence;
    const result = new Promise<unknown>((resolve, reject) => { pending.set(id, { resolve, reject }); });
    if (method === 'close') closed = true;
    try { worker.postMessage({ id, method, args }); }
    catch (error) { const entry = pending.get(id); pending.delete(id); if (method === 'close') closed = false; entry?.reject(error instanceof Error ? error : Error('STORE_REQUEST_NOT_CLONEABLE')); }
    return result;
  };
  return new Proxy({}, {
    get(_target, property) {
      // Prevent Promise resolution from treating the RPC proxy as a thenable.
      if (property === 'then' || typeof property !== 'string') return undefined;
      return (...args: unknown[]) => invoke(property as StoreMethodName, args);
    },
  }) as AsyncConversationStore;
}
