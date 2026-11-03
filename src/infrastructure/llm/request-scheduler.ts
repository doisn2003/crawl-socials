import { existsSync, readFileSync } from 'node:fs';
import { atomicJson } from '../config/user-config.js';
import { ModelGatewayError } from '../../application/ports/model-gateway.js';

export interface RequestLimits { concurrency: number; rpm: number; inputTpm: number; rpd: number; utilization?: number; minIntervalMs?: number; }
import type { RequestScheduleStatus } from '../../shared/throughput.js';
export interface RequestScheduler {
  acquire(inputTokens: number, signal?: AbortSignal): Promise<{ finish(actualInputTokens?: number): void }>;
  cooldown(ms: number): void;
  configure(limits: RequestLimits): void;
  status(): RequestScheduleStatus;
}
const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** One process/project/model coordinator, shared by planner, classifiers and reviews.
 * Charges admission before transport. Persisted counters survive Stop/Resume/restart;
 * they cover this app only, so provider 429 remains authoritative for project-wide usage. */
export function createRequestScheduler(initial: RequestLimits, options: { stateFile?: string; now?: () => number; windowMs?: number } = {}): RequestScheduler {
  const now = options.now ?? Date.now, windowMs = options.windowMs ?? 60_000;
  let limits: RequestLimits, adaptive = 1, active = 0, blockedUntil = 0, nextStart = 0, successes = 0;
  let minute: Array<{ at: number; tokens: number }> = [], day = pacificDay(now()), daily = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  type Waiting = { tokens: number; signal: AbortSignal | undefined; abort: () => void; resolve: (lease: { finish(tokens?: number): void }) => void; reject: (error: Error) => void };
  const queue: Waiting[] = [];
  function configure(value: RequestLimits) {
    if (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 64
      || ![value.rpm, value.inputTpm, value.rpd].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isFinite(value.utilization ?? 1) || (value.utilization ?? 1) <= 0 || (value.utilization ?? 1) > 1
      || !Number.isFinite(value.minIntervalMs ?? 0) || (value.minIntervalMs ?? 0) < 0) throw new ModelGatewayError('MODEL_RATE_CONFIG_INVALID');
    limits = { ...value }; adaptive = value.concurrency;
  }
  configure(initial);
  if (options.stateFile && existsSync(options.stateFile)) {
    const saved = JSON.parse(readFileSync(options.stateFile, 'utf8')) as { day: string; daily: number; minute: typeof minute; blockedUntil: number; nextStart: number };
    if (typeof saved.day !== 'string' || !Number.isSafeInteger(saved.daily) || saved.daily < 0 || !Array.isArray(saved.minute)
      || !saved.minute.every(v => Number.isFinite(v.at) && Number.isFinite(v.tokens) && v.tokens >= 0)
      || !Number.isFinite(saved.blockedUntil) || !Number.isFinite(saved.nextStart)) throw new ModelGatewayError('MODEL_RATE_STATE_INVALID');
    ({ day, daily, minute, blockedUntil, nextStart } = saved);
  }
  const save = () => { if (options.stateFile) atomicJson(options.stateFile, { day, daily, minute, blockedUntil, nextStart }); };
  function prune() {
    const t = now(); minute = minute.filter(v => v.at > t - windowMs);
    const current = pacificDay(t); if (current !== day) { day = current; daily = 0; }
  }
  function drain() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    prune();
    while (queue.length && active < adaptive) {
      const pending = queue[0]!, t = now(), factor = limits.utilization ?? 1;
      const rpm = Math.max(1, Math.floor(limits.rpm * factor)), tpm = Math.max(1, Math.floor(limits.inputTpm * factor));
      const fail = (code: string) => { queue.shift(); pending.signal?.removeEventListener('abort', pending.abort); pending.reject(new ModelGatewayError(code)); };
      if (pending.signal?.aborted) { fail('MODEL_ABORTED'); continue; }
      if (daily >= Math.max(1, Math.floor(limits.rpd * factor))) { fail('MODEL_DAILY_QUOTA_EXHAUSTED'); continue; }
      if (pending.tokens > tpm) { fail('MODEL_REQUEST_EXCEEDS_TOKEN_RATE_LIMIT'); continue; }
      let waitMs = Math.max(0, blockedUntil - t, nextStart - t);
      if (minute.length >= rpm || minute.reduce((sum, v) => sum + v.tokens, 0) + pending.tokens > tpm)
        waitMs = Math.max(waitMs, (minute[0]?.at ?? t) + windowMs - t);
      if (waitMs > 0) { timer = setTimeout(drain, Math.min(waitMs, 60_000)); return; }
      queue.shift(); pending.signal?.removeEventListener('abort', pending.abort);
      const admission = { at: t, tokens: pending.tokens }; minute.push(admission); daily++;
      nextStart = t + (limits.minIntervalMs ?? 0);
      try { save(); } catch { pending.reject(new ModelGatewayError('MODEL_RATE_PERSIST_FAILED')); continue; }
      active++; let finished = false;
      pending.resolve({ finish(actualTokens) {
        if (finished) return; finished = true; active--;
        if (actualTokens !== undefined && Number.isFinite(actualTokens) && actualTokens >= 0) admission.tokens = actualTokens;
        if (now() >= blockedUntil && ++successes >= 20) { adaptive = Math.min(limits.concurrency, adaptive + 1); successes = 0; }
        try { save(); } finally { drain(); }
      } });
    }
  }
  return {
    configure(value) { configure(value); drain(); },
    acquire(tokens, signal) {
      if (!Number.isSafeInteger(tokens) || tokens < 0) return Promise.reject(new ModelGatewayError('MODEL_RATE_TOKENS_INVALID'));
      if (signal?.aborted) return Promise.reject(new ModelGatewayError('MODEL_ABORTED'));
      if (queue.length >= 512) return Promise.reject(new ModelGatewayError('MODEL_QUEUE_FULL'));
      return new Promise((resolve, reject) => {
        const pending: Waiting = { tokens, signal, resolve, reject, abort: () => {
          const index = queue.indexOf(pending); if (index < 0) return;
          queue.splice(index, 1); signal?.removeEventListener('abort', pending.abort);
          reject(new ModelGatewayError('MODEL_ABORTED')); drain();
        } };
        queue.push(pending); signal?.addEventListener('abort', pending.abort, { once: true }); drain();
      });
    },
    cooldown(ms) {
      blockedUntil = Math.max(blockedUntil, now() + Math.max(1000, Math.min(ms, 86_400_000)));
      adaptive = Math.max(1, Math.floor(adaptive / 2)); successes = 0; save(); drain();
    },
    status() { prune(); return { active, queued: queue.length, concurrency: adaptive, configuredConcurrency: limits.concurrency,
      requestsLastMinute: minute.length, inputTokensLastMinute: minute.reduce((s, v) => s + v.tokens, 0), requestsToday: daily,
      cooldownUntil: blockedUntil > now() ? new Date(blockedUntil).toISOString() : null }; },
  };
}

/** Retry-After supports seconds/date; Gemini also returns google.rpc.RetryInfo. */
export function retryDelayMs(response: Response | null, payload: Record<string, unknown> | null, fallback: number, now = Date.now()): number {
  const header = response?.headers.get('retry-after');
  const headerMs = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now : 0;
  const error = payload?.error as { details?: Array<{ retryDelay?: string }> } | undefined;
  const delays = Array.isArray(error?.details) ? error.details.map(d => /^\d+(?:\.\d+)?s$/.test(d?.retryDelay ?? '') ? parseFloat(d.retryDelay!) * 1000 : 0) : [];
  return Math.max(fallback, Number.isFinite(headerMs) ? headerMs : 0, ...delays);
}
