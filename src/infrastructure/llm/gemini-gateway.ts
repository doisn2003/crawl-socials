import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequestScheduler, retryDelayMs, type RequestScheduler } from './request-scheduler.js';
import { ModelGatewayError } from '../../application/ports/model-gateway.js';
import type { JsonModelRequest, JsonModelResult, ModelGateway, ModelLedgerSummary, ModelPrice, ModelUsage } from '../../application/ports/model-gateway.js';
import type { SharedModelBudget } from './shared-model-budget.js';

export const GEMINI_FLASH_LITE_PRICE: ModelPrice = Object.freeze({
  input_per_million: 0.25, output_per_million: 1.50, cached_input_per_million: 0.025,
  observed_at: '2026-10-30', source: 'https://ai.google.dev/gemini-api/docs/pricing',
});

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v)).join(',') + '}';
}
export const modelHash = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');

/** Gemini's constrained decoder rejects some otherwise valid schemas with many bounded arrays.
 * Keep type/enum/required structure in the wire schema; application validators enforce size limits. */
export function geminiWireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiWireSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['minItems', 'maxItems', 'additionalProperties'].includes(key))
    .map(([key, child]) => [key, key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).map(([property, definition]) => [property, geminiWireSchema(definition)]))
      : geminiWireSchema(child)]));
}

/** Read locally configured key without displaying it or storing it in application data. */
export function resolveGeminiApiKey(): string | null {
  if (process.platform === 'win32') {
    try {
      const configured = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'User')"],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (configured) return configured;
    } catch { /* Process environment remains a supported deployment route. */ }
  }
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export function parseGeminiUsage(value: unknown): ModelUsage | null {
  if (!value || typeof value !== 'object') return null;
  const u = value as Record<string, unknown>;
  const input = u.promptTokenCount, cached = u.cachedContentTokenCount ?? 0;
  const generated = u.candidatesTokenCount ?? 0, thinking = u.thoughtsTokenCount ?? 0;
  if (![input, cached, generated, thinking].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  const inputNumber = input as number, thinkingNumber = thinking as number;
  const total = typeof u.totalTokenCount === 'number' && Number.isFinite(u.totalTokenCount) ? u.totalTokenCount : inputNumber;
  return { input_tokens: inputNumber, cached_input_tokens: Math.min(inputNumber, cached as number),
    output_tokens: Math.max((generated as number) + thinkingNumber, total - inputNumber), thinking_tokens: thinkingNumber };
}

export function pricedUsage(usage: ModelUsage, price: ModelPrice): number {
  return ((usage.input_tokens - usage.cached_input_tokens) * price.input_per_million
    + usage.cached_input_tokens * price.cached_input_per_million + usage.output_tokens * price.output_per_million) / 1_000_000;
}

interface StartEvent {
  type: 'START'; invocation_id: string; request_hash: string; purpose: string; model: string;
  started_at: string; reserved_usd: number; price: ModelPrice;
}
interface FinishEvent {
  type: 'FINISH'; invocation_id: string; request_hash: string; model: string; finished_at: string;
  result: JsonModelResult | null; cost_usd: number | null; unmetered_cost_upper_usd: number;
  error_code: string | null; http_status: number | null;
}
type LedgerEvent = StartEvent | FinishEvent;

export interface GeminiGatewayOptions {
  directory: string;
  budgetUsd: number;
  sharedBudget?: SharedModelBudget;
  scheduler?: RequestScheduler;
  model?: string;
  price?: ModelPrice;
  apiKey?: string | (() => string | null);
  minRequestIntervalMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  fetch?: typeof globalThis.fetch;
}

function permanentFailure(status: number, payload: Record<string, unknown> | null): string | null {
  if (status === 401) return 'MODEL_AUTHENTICATION_FAILED';
  if (status === 402) return 'MODEL_BILLING_EMPTY';
  if (status === 403) return 'MODEL_PERMISSION_DENIED';
  if (status === 404) return 'MODEL_NOT_AVAILABLE';
  if (status === 400) return 'MODEL_REQUEST_INVALID';
  if (status !== 429) return null;
  const error = payload?.error as Record<string, unknown> | undefined;
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (/(?:credit|balance).*(?:depleted|exhausted|insufficient|zero)|payment required/u.test(message)) return 'MODEL_BILLING_EMPTY';
  const details = Array.isArray(error?.details) ? error.details : [];
  const violations = details.flatMap(d => d && typeof d === 'object' && Array.isArray(d.violations) ? d.violations : []);
  if (violations.some(v => Number(v.quotaValue ?? v.quota_value ?? -1) === 0
    || /per.?day|daily/u.test(JSON.stringify(v).toLowerCase()))) return 'MODEL_DAILY_QUOTA_EXHAUSTED';
  return null;
}

function readLedger(file: string): LedgerEvent[] {
  if (!existsSync(file)) return [];
  const bytes = readFileSync(file), text = bytes.toString('utf8');
  const lines = text.split('\n'), result: LedgerEvent[] = [];
  let validBytes = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) { validBytes += Buffer.byteLength(line) + (i < lines.length - 1 ? 1 : 0); continue; }
    try {
      const value = JSON.parse(line) as LedgerEvent;
      if (value.type !== 'START' && value.type !== 'FINISH') throw new Error('Invalid event');
      result.push(value);
      validBytes += Buffer.byteLength(line) + (i < lines.length - 1 ? 1 : 0);
    } catch {
      if (i !== lines.length - 1) throw new ModelGatewayError('MODEL_LEDGER_CORRUPT');
      truncateSync(file, validBytes);
    }
  }
  // A complete JSON event without final newline must not concatenate with the next append.
  if (result.length && validBytes === bytes.length && !text.endsWith('\n')) appendFileSync(file, '\n');
  return result;
}

export function createGeminiGateway(options: GeminiGatewayOptions): ModelGateway {
  const model = options.model ?? 'gemini-3.1-flash-lite';
  if (!/^[a-z0-9][a-z0-9.-]{2,100}$/u.test(model)) throw new ModelGatewayError('MODEL_ID_INVALID');
  if (!Number.isFinite(options.budgetUsd) || options.budgetUsd <= 0) throw new ModelGatewayError('MODEL_BUDGET_INVALID');
  if (model !== 'gemini-3.1-flash-lite' && !options.price) throw new ModelGatewayError('MODEL_EXPLICIT_PRICE_REQUIRED');
  const price = options.price ?? GEMINI_FLASH_LITE_PRICE;
  if (![price.input_per_million, price.output_per_million, price.cached_input_per_million].every(n => Number.isFinite(n) && n >= 0)) {
    throw new ModelGatewayError('MODEL_PRICE_INVALID');
  }
  const minInterval = options.minRequestIntervalMs ?? 4500, timeout = options.timeoutMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isFinite(minInterval) || minInterval < 0 || !Number.isFinite(timeout) || timeout <= 0
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new ModelGatewayError('MODEL_LIMIT_INVALID');
  mkdirSync(options.directory, { recursive: true });
  const file = join(options.directory, 'model-ledger.jsonl');
  const starts = new Map<string, StartEvent>(), finishes = new Set<string>(), cache = new Map<string, JsonModelResult>();
  let spent = 0, unknownUpper = 0, reserved = 0, attempts = 0, cacheHits = 0;
  let fatalCode: string | null = null;
  for (const event of readLedger(file)) {
    if (event.type === 'START') { starts.set(event.invocation_id, event); attempts++; }
    else if (!finishes.has(event.invocation_id)) {
      finishes.add(event.invocation_id);
      spent += event.cost_usd ?? 0; unknownUpper += event.unmetered_cost_upper_usd;
      if (event.result) cache.set(event.request_hash, event.result);
    }
  }
  for (const start of starts.values()) if (!finishes.has(start.invocation_id)) unknownUpper += start.reserved_usd;
  const accountBudget = () => options.sharedBudget?.setAccounted(file, spent + unknownUpper + reserved);
  accountBudget();
  const append = (event: LedgerEvent): void => {
    const fd = openSync(file, 'a');
    try { appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  };
  const transport = options.fetch ?? globalThis.fetch;
  const inFlight = new Map<string, Promise<JsonModelResult>>();
  const scheduler = options.scheduler ?? createRequestScheduler({ concurrency: 1, rpm: 1_000_000,
    inputTpm: 1_000_000_000, rpd: 1_000_000_000, minIntervalMs: minInterval });

  const summary = (): ModelLedgerSummary => ({ model, budget_usd: options.budgetUsd, measured_cost_usd: spent,
    unmetered_cost_upper_usd: unknownUpper, reserved_usd: reserved,
    remaining_usd: Math.min(Math.max(0, options.budgetUsd - spent - unknownUpper - reserved), options.sharedBudget?.remaining() ?? Infinity),
    billable_attempts: attempts, cache_hits: cacheHits, scheduling: scheduler.status(), cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' });

  async function perform(request: JsonModelRequest, hash: string): Promise<JsonModelResult> {
    request.signal?.throwIfAborted();
    if (fatalCode) throw new ModelGatewayError(fatalCode);
    const key = typeof options.apiKey === 'function' ? options.apiKey() : options.apiKey ?? resolveGeminiApiKey();
    if (!key) throw new ModelGatewayError('GEMINI_API_KEY_MISSING');
    if (!Number.isInteger(request.max_output_tokens) || request.max_output_tokens < 1 || request.max_output_tokens > 32768) {
      throw new ModelGatewayError('MODEL_OUTPUT_LIMIT_INVALID');
    }
    const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json',
      responseJsonSchema: geminiWireSchema(request.schema), maxOutputTokens: request.max_output_tokens };
    // 3.8 rejects minimal thinking and deprecated sampling parameters; 3.1/3.5 Lite
    // retain the tested compact configuration. Thinking tokens are metered as output.
    if (/^gemini-3\.8-flash(?:$|-)/u.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    else generationConfig.temperature = 0;
    if (/^gemini-3/u.test(model) && !generationConfig.thinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
    else if (/^gemini-2\.5/u.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: stableJson(request.input) }] }], generationConfig });
    const upper = ((Buffer.byteLength(body) + 1024) * price.input_per_million
      + request.max_output_tokens * price.output_per_million) / 1_000_000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      request.signal?.throwIfAborted();
      // UTF-8 bytes + envelope allowance is a conservative input-token reservation.
      const lease = await scheduler.acquire(Buffer.byteLength(body) + 1024, request.signal);
      let actualInputTokens: number | undefined;
      try {
      request.signal?.throwIfAborted();
      if (fatalCode) throw new ModelGatewayError(fatalCode);
      if (spent + unknownUpper + reserved + upper > options.budgetUsd || options.sharedBudget?.canReserve(upper) === false) throw new ModelGatewayError('MODEL_BUDGET_EXHAUSTED');
      const invocation = randomUUID(), started = Date.now();
      append({ type: 'START', invocation_id: invocation, request_hash: hash, purpose: request.purpose, model,
        started_at: new Date(started).toISOString(), reserved_usd: upper, price });
      reserved += upper; attempts++;
      accountBudget();
      let response: Response | null = null, payload: Record<string, unknown> | null = null;
      let errorCode: string | null = null, usage: ModelUsage | null = null, value: unknown;
      let valid = false;
      try {
        response = await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
          signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        });
        const responseText = await response.text();
        try { payload = JSON.parse(responseText) as Record<string, unknown>; } catch { errorCode = 'MODEL_RESPONSE_NOT_JSON'; }
        usage = parseGeminiUsage(payload?.usageMetadata);
        if (!response.ok) errorCode = permanentFailure(response.status, payload) ?? `MODEL_HTTP_${response.status}`;
        else if (payload) {
          const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }> | undefined;
          const candidate = candidates?.[0];
          if (candidate?.finishReason !== 'STOP') errorCode = 'MODEL_INCOMPLETE_RESPONSE';
          else {
            const output = (candidate.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
            try { value = JSON.parse(output); valid = true; }
            catch { errorCode = 'MODEL_OUTPUT_NOT_JSON'; }
          }
        }
      } catch {
        errorCode = request.signal?.aborted ? 'MODEL_ABORTED_USAGE_UNKNOWN' : 'MODEL_NETWORK_USAGE_UNKNOWN';
      }
      actualInputTokens = usage?.input_tokens;
      const cost = usage ? pricedUsage(usage, price) : response && !response.ok && response.status < 500 ? 0 : null;
      const unknown = cost === null ? upper : 0;
      const result: JsonModelResult | null = valid ? { value, invocation_id: invocation, request_hash: hash, model,
        model_version: typeof payload?.modelVersion === 'string' ? payload.modelVersion : null, usage, cost_usd: cost,
        unmetered_cost_upper_usd: unknown, cache_hit: false, elapsed_ms: Date.now() - started, price } : null;
      // A failed disk write leaves START unresolved; restart reserves its full cost conservatively.
      append({ type: 'FINISH', invocation_id: invocation, request_hash: hash, model, finished_at: new Date().toISOString(),
        result, cost_usd: cost, unmetered_cost_upper_usd: unknown, error_code: errorCode, http_status: response?.status ?? null });
      reserved -= upper; spent += cost ?? 0; unknownUpper += unknown;
      accountBudget();
      if (response?.status === 429 || response?.status === 503) scheduler.cooldown(retryDelayMs(response, payload, 5000 * attempt));
      if (result) { cache.set(hash, result); return result; }
      const permanent = response ? permanentFailure(response.status, payload) : null;
      if (permanent) { fatalCode = permanent; throw new ModelGatewayError(permanent, false, invocation); }
      const retryable = !request.signal?.aborted && (response?.status === 429 || (response?.status ?? 0) >= 500 || response === null);
      if (retryable && attempt < maxAttempts) {
        if (response?.status !== 429 && response?.status !== 503) scheduler.cooldown(5000 * attempt);
        continue;
      }
      throw new ModelGatewayError(errorCode ?? 'MODEL_UNKNOWN_FAILURE', retryable, invocation);
      } finally { lease.finish(actualInputTokens); }
    }
    throw new ModelGatewayError('MODEL_ATTEMPTS_EXHAUSTED');
  }

  return { summary, generateJson(request) {
    if (request.signal?.aborted) return Promise.reject(new ModelGatewayError('MODEL_ABORTED'));
    const hash = modelHash({ model, price, purpose: request.purpose, system: request.system, input: request.input,
      schema: request.schema, max_output_tokens: request.max_output_tokens, cache_namespace: request.cache_namespace ?? '' });
    const cached = cache.get(hash);
    if (cached) { cacheHits++; return Promise.resolve({ ...cached, cache_hit: true, elapsed_ms: 0 }); }
    const existing = inFlight.get(hash);
    if (existing) return existing.then(result => { cacheHits++; return { ...result, cache_hit: true }; });
    const operation = perform(request, hash);
    inFlight.set(hash, operation);
    void operation.finally(() => inFlight.delete(hash)).catch(() => undefined);
    return operation;
  } };
}
