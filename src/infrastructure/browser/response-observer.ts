import { createHash } from 'node:crypto';
import { isBrowserProfileId } from '../../domain/browser-profile.js';
import type { CaptureMetadata, ObserverCaptureMode, ObserverCode, ObserverEvent, ObserverLimits,
  ObserverOwner, ObserverRead, ObserverSnapshot, ResponseObserver } from '../../application/ports/response-observer.js';
import type { ObserverTarget } from './observer-target.js';

export const DEFAULT_OBSERVER_LIMITS: ObserverLimits = {
  maxPendingRequests: 32, maxConcurrentReads: 2, maxBodyBytes: 128 * 1024,
  maxBufferedBytes: 512 * 1024, maxResults: 32, maxCapturedResponses: 100,
  maxTotalCapturedBytes: 2 * 1024 * 1024, commandTimeoutMs: 2000,
  requestTimeoutMs: 10000, maxRunMs: 30000, maxObservers: 4,
};
interface Pending {
  id: string; key: number; generation: number; fingerprint: string; method: 'GET' | 'POST';
  received: boolean; finished: boolean; reading: boolean; status: number; mimeType: string;
  origin: 'NETWORK' | 'BROWSER_CACHE' | 'SERVICE_WORKER'; timer: ReturnType<typeof setTimeout>;
  cancel?: () => void;
}
type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {};
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');

export function createResponseObserverManager(input: {
  resolveOwned: (owner: ObserverOwner) => ObserverTarget | null;
  urlAllowed: (url: string) => boolean;
  mimeTypes?: readonly string[]; resourceTypes?: readonly string[];
  limits?: Partial<ObserverLimits>;
}) {
  const limits = { ...DEFAULT_OBSERVER_LIMITS, ...input.limits };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('OBSERVER_LIMITS_INVALID');
  if (limits.maxConcurrentReads > limits.maxPendingRequests || limits.maxBodyBytes > limits.maxBufferedBytes ||
    limits.maxResults < 2 || limits.maxRunMs > 60000 || limits.maxObservers > 16) throw new Error('OBSERVER_LIMITS_INVALID');
  const mimeTypes = new Set(input.mimeTypes || ['application/json', 'text/plain']);
  const resourceTypes = new Set(input.resourceTypes || ['Fetch', 'XHR']);
  const sessions = new Map<string, Capture>();
  // Held until the native promise actually settles, even after our await is cancelled.
  const nativeBudget = { active: 0, max: limits.maxObservers * (limits.maxConcurrentReads + 1) };
  const poisoned = new WeakSet<ObserverTarget>();

  class Capture implements ResponseObserver {
    readonly owner: ObserverOwner;
    readonly captureMode: ObserverCaptureMode;
    readonly target: ObserverTarget;
    private state: ObserverSnapshot['state'] = 'ATTACHING';
    private generation = 1;
    private ownedDebugger = false;
    private acceptingRequests = true;
    private pending = new Map<string, Pending>();
    private queue: ObserverEvent[] = [];
    private buffered = 0;
    private reads = 0;
    private sequence = 0;
    private captures = 0;
    private totalBytes = 0;
    private filtered: Record<string, number> = {};
    private dropped: Record<string, number> = {};
    private unbind: (() => void)[] = [];
    private commands = new Set<() => void>();
    private deadline: ReturnType<typeof setTimeout> | null = null;
    private waiter: { finish: (read: ObserverRead) => void; timer: ReturnType<typeof setTimeout> } | null = null;
    private starting: Promise<void> | null = null;
    readonly deadlineAt = performance.now() + limits.maxRunMs;
    constructor(owner: ObserverOwner, target: ObserverTarget, mode: ObserverCaptureMode) {
      this.owner = Object.freeze({ ...owner }); this.target = target; this.captureMode = mode;
    }
    private count(map: Record<string, number>, reason: string, amount = 1) { if (amount > 0) map[reason] = (map[reason] || 0) + amount; }
    private valid(): boolean {
      try { return !this.target.isDestroyed() && input.resolveOwned(this.owner) === this.target; } catch { return false; }
    }
    private metadata(): CaptureMetadata {
      return { owner: { ...this.owner }, captureGeneration: this.generation, captureMode: this.captureMode, observedAt: new Date().toISOString() };
    }
    private deliver(event: ObserverEvent) {
      if (this.waiter) { const waiter = this.waiter; this.waiter = null; clearTimeout(waiter.timer); waiter.finish({ kind: 'EVENT', event }); return; }
      this.queue.push(event); if (event.kind === 'BODY') this.buffered += event.body.byteLength;
    }
    private emit(event: ObserverEvent) {
      if (this.queue.length >= limits.maxResults - 1) { this.end('RESULT_QUEUE_LIMIT'); return; }
      this.deliver(event);
    }
    private invalidate(reason: string) {
      this.generation++;
      for (const record of this.pending.values()) { clearTimeout(record.timer); record.cancel?.(); }
      this.count(this.dropped, reason, this.pending.size + this.queue.filter(event => event.kind === 'BODY').length);
      this.pending.clear(); this.queue = []; this.buffered = 0;
    }
    private cleanup() {
      for (const remove of this.unbind.splice(0)) { try { remove(); } catch { /* Continue cleanup of remaining owned listeners. */ } }
      for (const cancel of [...this.commands]) cancel();
      if (this.deadline) { clearTimeout(this.deadline); this.deadline = null; }
      if (this.ownedDebugger) {
        this.ownedDebugger = false;
        try { if (this.target.debuggerAttached()) this.target.detachDebugger(); } catch { /* No arbitrary native error text. */ }
      }
    }
    private end(code: ObserverCode, error = true) {
      if (this.state === 'STOPPED') return;
      this.state = 'STOPPED'; this.invalidate(code); this.cleanup();
      // Terminal event has a reserved slot; it cannot silently turn a limit/error into [].
      this.deliver({ ...this.metadata(), kind: error ? 'ERROR' : 'STATE', code });
    }
    private command(method: string, params: Record<string, unknown>, record?: Pending): Promise<unknown> {
      if (nativeBudget.active >= nativeBudget.max) { this.end('COMMAND_CAPACITY'); return Promise.reject(new Error('CANCELLED')); }
      nativeBudget.active++;
      const native = Promise.resolve().then(() => {
        if (this.state === 'STOPPED' || this.state === 'SUSPENDED' || (record && record.generation !== this.generation)) throw new Error('CANCELLED');
        return this.target.command(method, params);
      });
      void native.then(() => { nativeBudget.active--; }, () => { nativeBudget.active--; });
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (result: unknown, failed: boolean) => {
          if (finished) return; finished = true; clearTimeout(timer); this.commands.delete(cancel);
          if (record) delete record.cancel;
          if (failed) reject(result); else resolve(result);
        };
        const cancel = () => finish(new Error('CANCELLED'), true);
        const timer = setTimeout(() => {
          poisoned.add(this.target);
          finish(new Error('TIMEOUT'), true); this.end('COMMAND_TIMEOUT');
        }, limits.commandTimeoutMs);
        this.commands.add(cancel); if (record) record.cancel = cancel;
        void native.then(value => finish(value, false), () => finish(new Error('NATIVE_COMMAND_FAILED'), true));
      });
    }
    start(): Promise<void> {
      if (this.state === 'ATTACHED') return Promise.resolve();
      if (this.starting) return this.starting;
      this.starting = this.startInternal().finally(() => { this.starting = null; });
      return this.starting;
    }
    private async startInternal() {
      if (performance.now() >= this.deadlineAt) { this.end('RUN_DEADLINE'); return; }
      if (!this.valid()) { this.end('OWNER_CHANGED'); return; }
      if (poisoned.has(this.target)) { this.end('COMMAND_TIMEOUT'); return; }
      if (this.target.debuggerAttached() || this.target.devToolsOpened()) { this.end('DEBUGGER_IN_USE'); return; }
      this.state = 'ATTACHING';
      try { this.target.attachDebugger(); this.ownedDebugger = true; }
      catch { this.end('ATTACH_FAILED'); return; }
      try {
        this.unbind.push(this.target.onMessage((method, params, child) => this.message(method, params, child)));
        this.unbind.push(this.target.onDetach(() => { this.ownedDebugger = false; this.end(this.target.isDestroyed() ? 'TARGET_DESTROYED' : 'DEBUGGER_DETACHED'); }));
        this.unbind.push(this.target.onDestroyed(() => this.end('TARGET_DESTROYED')));
        this.unbind.push(this.target.onDevTools(() => this.end('DEVTOOLS_OPENED')));
        this.unbind.push(this.target.onNavigation(() => {
          if (this.state === 'ATTACHED') {
            this.invalidate('NAVIGATION_RESET'); this.emit({ ...this.metadata(), kind: 'STATE', code: 'NAVIGATION_RESET' });
          }
        }));
      } catch { this.end('ATTACH_FAILED'); return; }
      if (this.state !== 'ATTACHING') { this.cleanup(); return; }
      if (!this.valid()) { this.end('OWNER_CHANGED'); return; }
      this.deadline = setTimeout(() => this.end('RUN_DEADLINE'), Math.max(1, this.deadlineAt - performance.now()));
      try {
        await this.command('Network.enable', { maxTotalBufferSize: limits.maxBufferedBytes,
          maxResourceBufferSize: limits.maxBodyBytes, maxPostDataSize: 0 });
        if (this.state !== 'ATTACHING') return;
        if (!this.valid()) { this.end('OWNER_CHANGED'); return; }
        this.state = 'ATTACHED'; this.emit({ ...this.metadata(), kind: 'STATE', code: 'ATTACHED' });
      } catch { if (this.state === 'ATTACHING') this.end('NETWORK_ENABLE_FAILED'); }
    }
    private forget(record: Pending) {
      if (this.pending.get(record.id) !== record) return;
      this.pending.delete(record.id); clearTimeout(record.timer);
    }
    private fail(record: Pending, code: ObserverCode) {
      this.forget(record); record.cancel?.();
      this.emit({ ...this.metadata(), kind: 'ERROR', code, requestKey: record.key });
    }
    private allowed(url: unknown): url is string {
      if (typeof url !== 'string' || url.length > 16384) return false;
      try { return input.urlAllowed(url); } catch { this.count(this.filtered, 'FILTER_FAILED'); return false; }
    }
    private message(method: string, raw: unknown, child: boolean) {
      if (this.state !== 'ATTACHED') return;
      if (!this.valid()) { this.end('OWNER_CHANGED'); return; }
      if (child) { this.count(this.filtered, 'CHILD_TARGET'); return; }
      const params = object(raw), id = params.requestId;
      if (typeof id !== 'string' || id.length > 256) return;
      let record = this.pending.get(id);
      if (method === 'Network.requestWillBeSent') {
        if (!this.acceptingRequests) { this.count(this.filtered, 'ADMISSION_PAUSED'); return; }
        if (record) { this.forget(record); record.cancel?.(); this.count(this.dropped, 'REQUEST_REPLACED'); }
        const request = object(params.request);
        if (params.redirectResponse || (request.method !== 'GET' && request.method !== 'POST') ||
          typeof params.type !== 'string' || !resourceTypes.has(params.type) || !this.allowed(request.url)) { this.count(this.filtered, 'REQUEST_FILTERED'); return; }
        if (this.pending.size >= limits.maxPendingRequests) { this.end('PENDING_LIMIT'); return; }
        const pending: Pending = { id, key: ++this.sequence, generation: this.generation, fingerprint: fingerprint(request.url),
          method: request.method as 'GET' | 'POST', received: false, finished: false, reading: false,
          status: 0, mimeType: '', origin: 'NETWORK',
          timer: setTimeout(() => { if (this.pending.get(id) === pending) this.fail(pending, 'REQUEST_TIMEOUT'); }, limits.requestTimeoutMs) };
        this.pending.set(id, pending); return;
      }
      if (!record) return;
      if (method === 'Network.loadingFailed') { this.fail(record, 'NETWORK_FAILED'); return; }
      if (method === 'Network.requestServedFromCache') { record.origin = 'BROWSER_CACHE'; return; }
      if (method === 'Network.responseReceived') {
        const response = object(params.response);
        const mime = typeof response.mimeType === 'string' && response.mimeType.length <= 128 ? response.mimeType.split(';')[0]!.trim().toLowerCase() : '';
        if (!this.allowed(response.url) || fingerprint(response.url) !== record.fingerprint) { this.fail(record, 'RESPONSE_MISMATCH'); return; }
        if (!mimeTypes.has(mime)) { this.forget(record); this.count(this.filtered, 'MIME_FILTERED'); return; }
        if (!Number.isInteger(response.status) || Number(response.status) < 100 || Number(response.status) > 599) { this.fail(record, 'RESPONSE_INVALID'); return; }
        record.received = true; record.mimeType = mime; record.status = Number(response.status);
        if (response.fromServiceWorker) record.origin = 'SERVICE_WORKER';
        else if (response.fromDiskCache || response.fromPrefetchCache) record.origin = 'BROWSER_CACHE';
      } else if (method === 'Network.loadingFinished') {
        if (typeof params.encodedDataLength === 'number' && params.encodedDataLength > limits.maxBodyBytes) { this.fail(record, 'BODY_TOO_LARGE'); return; }
        record.finished = true;
      } else return;
      this.pump();
    }
    private pump() {
      if (this.state !== 'ATTACHED') return;
      for (const record of this.pending.values()) {
        if (this.reads >= limits.maxConcurrentReads) break;
        if (!record.received || !record.finished || record.reading) continue;
        record.reading = true; clearTimeout(record.timer); this.reads++;
        void this.body(record).finally(() => { this.reads--; this.pump(); });
      }
    }
    private async body(record: Pending) {
      try {
        const raw = object(await this.command('Network.getResponseBody', { requestId: record.id }, record));
        if (this.state !== 'ATTACHED' || this.pending.get(record.id) !== record || record.generation !== this.generation) return;
        if (!this.valid()) { this.end('OWNER_CHANGED'); return; }
        if (typeof raw.body !== 'string' || typeof raw.base64Encoded !== 'boolean') { this.fail(record, 'BODY_DECODE_FAILED'); return; }
        const maxText = raw.base64Encoded ? Math.ceil(limits.maxBodyBytes / 3) * 4 : limits.maxBodyBytes;
        if (raw.body.length > maxText) { this.fail(record, 'BODY_TOO_LARGE'); return; }
        const bytes = Buffer.from(raw.body, raw.base64Encoded ? 'base64' : 'utf8');
        if (raw.base64Encoded && bytes.toString('base64') !== raw.body) { this.fail(record, 'BODY_DECODE_FAILED'); return; }
        if (bytes.length > limits.maxBodyBytes) { this.fail(record, 'BODY_TOO_LARGE'); return; }
        if (this.buffered + bytes.length > limits.maxBufferedBytes) { this.end('BUFFER_LIMIT'); return; }
        if (this.totalBytes + bytes.length > limits.maxTotalCapturedBytes) { this.end('TOTAL_BYTES_LIMIT'); return; }
        if (this.captures >= limits.maxCapturedResponses) { this.end('CAPTURE_LIMIT'); return; }
        this.forget(record); this.captures++; this.totalBytes += bytes.length;
        this.emit({ ...this.metadata(), kind: 'BODY', requestKey: record.key, transportRequestId: record.id, method: record.method, status: record.status,
          mimeType: record.mimeType, responseOrigin: record.origin, body: bytes });
      } catch {
        if (this.state === 'ATTACHED' && this.pending.get(record.id) === record && record.generation === this.generation) this.fail(record, 'BODY_UNREADABLE');
      }
    }
    read(timeoutMs = 1000): Promise<ObserverRead> {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return Promise.reject(new Error('OBSERVER_READ_TIMEOUT_INVALID'));
      if (this.waiter) return Promise.reject(new Error('OBSERVER_READER_BUSY'));
      if ((this.state === 'ATTACHED' || this.state === 'ATTACHING') && !this.valid()) this.end('OWNER_CHANGED');
      const event = this.queue.shift();
      if (event) { if (event.kind === 'BODY') this.buffered -= event.body.byteLength; return Promise.resolve({ kind: 'EVENT', event }); }
      if (this.state === 'STOPPED') return Promise.resolve({ kind: 'END' });
      return new Promise(resolve => {
        const timer = setTimeout(() => { this.waiter = null; resolve({ kind: 'TIMEOUT' }); }, timeoutMs);
        this.waiter = { timer, finish: resolve };
      });
    }
    snapshot(): ObserverSnapshot {
      return { state: this.state, captureGeneration: this.generation, pendingRequests: this.pending.size,
        activeReads: this.reads, queuedResults: this.queue.length, bufferedBytes: this.buffered,
        capturedResponses: this.captures, totalCapturedBytes: this.totalBytes,
        filtered: { ...this.filtered }, dropped: { ...this.dropped }, rawCommandsInFlight: nativeBudget.active };
    }
    pauseRequests() { this.acceptingRequests = false; }
    resumeRequests() { this.acceptingRequests = true; }
    suspend() {
      if (this.state === 'STOPPED' || this.state === 'SUSPENDED') return;
      this.state = 'SUSPENDED'; this.invalidate('SUSPENDED'); this.cleanup();
      this.deliver({ ...this.metadata(), kind: 'STATE', code: 'SUSPENDED' });
    }
    async resume() {
      if (this.state === 'ATTACHED' || this.state === 'ATTACHING') return this.starting || Promise.resolve();
      if (this.state !== 'SUSPENDED') throw new Error('OBSERVER_NOT_RESUMABLE');
      if (this.starting) await this.starting;
      const resumedState = this.snapshot().state; // Lifecycle callbacks may change it across the await above.
      if (resumedState === 'STOPPED') throw new Error('OBSERVER_NOT_RESUMABLE');
      if (resumedState === 'ATTACHED' || resumedState === 'ATTACHING') return this.starting || Promise.resolve();
      if (performance.now() >= this.deadlineAt) { this.end('RUN_DEADLINE'); return; }
      await this.start();
    }
    stop() { this.end('STOPPED', false); }
  }
  return {
    async attach(owner: ObserverOwner, mode: ObserverCaptureMode): Promise<ResponseObserver> {
      if (!isBrowserProfileId(owner.profileId) || !Number.isSafeInteger(owner.webContentsId) || owner.webContentsId < 1 ||
        !Number.isSafeInteger(owner.viewGeneration) || owner.viewGeneration < 1 || !['LIVE', 'FIXTURE', 'REPLAY'].includes(mode)) throw new Error('OBSERVER_OWNER_INVALID');
      const target = input.resolveOwned(owner);
      if (!target || target.id !== owner.webContentsId || target.isDestroyed()) throw new Error('OBSERVER_OWNER_MISMATCH');
      const old = sessions.get(owner.profileId);
      if (old && old.target === target && old.owner.viewGeneration === owner.viewGeneration && old.captureMode === mode && old.snapshot().state !== 'STOPPED') { await old.start(); return old; }
      if (old) old.stop();
      if (!old && sessions.size >= limits.maxObservers) throw new Error('OBSERVER_TARGET_LIMIT');
      const capture = new Capture(owner, target, mode); sessions.set(owner.profileId, capture); await capture.start(); return capture;
    },
    stopAll() { for (const capture of sessions.values()) capture.stop(); sessions.clear(); },
    limits: Object.freeze({ ...limits }),
  };
}
