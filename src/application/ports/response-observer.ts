// Transport contract, independent of Electron and of social-adapter/parser contracts.
export interface ObserverOwner { profileId: string; webContentsId: number; viewGeneration: number; }
export type ObserverCaptureMode = 'LIVE' | 'FIXTURE' | 'REPLAY';
export type ObserverCode =
  | 'ATTACHED' | 'STOPPED' | 'SUSPENDED' | 'RESUMED' | 'NAVIGATION_RESET'
  | 'DEBUGGER_IN_USE' | 'ATTACH_FAILED' | 'NETWORK_ENABLE_FAILED' | 'DEBUGGER_DETACHED' | 'DEVTOOLS_OPENED'
  | 'OWNER_CHANGED' | 'TARGET_DESTROYED' | 'COMMAND_TIMEOUT' | 'COMMAND_CAPACITY'
  | 'REQUEST_TIMEOUT' | 'NETWORK_FAILED' | 'BODY_UNREADABLE' | 'BODY_DECODE_FAILED' | 'RESPONSE_MISMATCH' | 'RESPONSE_INVALID'
  | 'BODY_TOO_LARGE' | 'PENDING_LIMIT' | 'RESULT_QUEUE_LIMIT' | 'BUFFER_LIMIT'
  | 'TOTAL_BYTES_LIMIT' | 'CAPTURE_LIMIT' | 'RUN_DEADLINE';
export interface ObserverLimits {
  maxPendingRequests: number; maxConcurrentReads: number; maxBodyBytes: number;
  maxBufferedBytes: number; maxResults: number; maxCapturedResponses: number;
  maxTotalCapturedBytes: number; commandTimeoutMs: number; requestTimeoutMs: number;
  maxRunMs: number; maxObservers: number;
}
export interface CaptureMetadata {
  owner: ObserverOwner; captureGeneration: number; captureMode: ObserverCaptureMode;
  observedAt: string;
}
export type ObserverEvent = (CaptureMetadata & { kind: 'STATE' | 'ERROR'; code: ObserverCode; requestKey?: number }) |
  (CaptureMetadata & { kind: 'BODY'; requestKey: number; method: 'GET' | 'POST';
    status: number; mimeType: string; responseOrigin: 'NETWORK' | 'BROWSER_CACHE' | 'SERVICE_WORKER'; body: Uint8Array });
export type ObserverRead = { kind: 'EVENT'; event: ObserverEvent } | { kind: 'TIMEOUT' | 'END' };
export interface ObserverSnapshot {
  state: 'ATTACHING' | 'ATTACHED' | 'SUSPENDED' | 'STOPPED'; captureGeneration: number;
  pendingRequests: number; activeReads: number; queuedResults: number; bufferedBytes: number;
  capturedResponses: number; totalCapturedBytes: number; filtered: Record<string, number>;
  dropped: Record<string, number>; rawCommandsInFlight: number;
}
export interface ResponseObserver {
  readonly owner: ObserverOwner;
  read(timeoutMs?: number): Promise<ObserverRead>;
  snapshot(): ObserverSnapshot;
  suspend(): void;
  resume(): Promise<void>;
  stop(): void;
}
