import { parentPort, workerData } from 'node:worker_threads';
import { createConversationStore, type ConversationStore } from './conversation-store.js';

export interface StoreWorkerRequest { id: number; method: string; args: unknown[] }
export interface StoreWorkerResponse { id?: number; ready?: boolean; value?: unknown; error?: string }
export const STORE_METHOD_NAMES = ['queryYield', 'selectTarget', 'ingest', 'ingestImported', 'snapshot', 'getSnapshot', 'snapshots', 'observations', 'rootCandidates', 'requestAssessment', 'assessmentsDue', 'assessmentSummary', 'recordDecision', 'results', 'decisionHistory', 'exportSnapshot', 'stats', 'enqueue', 'getJob', 'getJobByKey', 'jobs', 'backlogBytes', 'watchSummary', 'coalesceRevisits', 'enrichmentQueries', 'claim', 'complete', 'heartbeat', 'retry', 'pause', 'resume', 'reserveInvocation', 'finishInvocation', 'cached', 'costSummary', 'invocationHistory', 'close'] as const;
export type StoreMethodName = typeof STORE_METHOD_NAMES[number];

if (parentPort) {
  const port = parentPort;
  let store: ConversationStore;
  try {
    store = createConversationStore(String((workerData as { directory: string }).directory));
    port.postMessage({ ready: true } satisfies StoreWorkerResponse);
    port.on('message', (request: StoreWorkerRequest) => {
      try {
        if (!Number.isInteger(request.id) || !STORE_METHOD_NAMES.includes(request.method as StoreMethodName) || !Array.isArray(request.args)) throw Error('INVALID_STORE_WORKER_REQUEST');
        const method = store[request.method as StoreMethodName] as (...args: unknown[]) => unknown;
        const value = method.apply(store, request.args);
        port.postMessage({ id: request.id, value } satisfies StoreWorkerResponse);
        if (request.method === 'close') port.close();
      } catch (error) { port.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'STORE_OPERATION_FAILED' } satisfies StoreWorkerResponse); }
    });
  } catch (error) { port.postMessage({ ready: false, error: error instanceof Error ? error.message : 'STORE_STARTUP_FAILED' } satisfies StoreWorkerResponse); port.close(); }
}
