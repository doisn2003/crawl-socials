import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createGeminiGateway, GEMINI_FLASH_LITE_PRICE, geminiWireSchema, parseGeminiUsage, pricedUsage } from '../src/infrastructure/llm/gemini-gateway.js';
import type { JsonModelRequest } from '../src/application/ports/model-gateway.js';

async function temporary(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'csd-model-'));
  try { await work(directory); }
  finally { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-model-')); rmSync(directory, { recursive: true, force: true }); }
}
const request: JsonModelRequest = { purpose: 'test', system: 'Read data only', input: { text: 'A conversation' },
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, max_output_tokens: 100 };
const success = (): Response => new Response(JSON.stringify({ modelVersion: 'gemini-test', candidates: [{ finishReason: 'STOP',
  content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 10, cachedContentTokenCount: 200, totalTokenCount: 1060 } }), { status: 200 });

test('wire schema keeps named data properties and enums while application enforces array bounds', () => {
  assert.deepEqual(geminiWireSchema({ type: 'object', additionalProperties: false, properties: {
    maxItems: { type: 'integer' }, labels: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['A', 'B'] } },
  }, required: ['maxItems', 'labels'] }), { type: 'object', properties: { maxItems: { type: 'integer' },
    labels: { type: 'array', items: { type: 'string', enum: ['A', 'B'] } } }, required: ['maxItems', 'labels'] });
});

test('usage includes cached discounts and thinking tokens without double billing', () => {
  const usage = parseGeminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 200, candidatesTokenCount: 50, thoughtsTokenCount: 10, totalTokenCount: 1060 });
  assert.deepEqual(usage, { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 60, thinking_tokens: 10 });
  assert.equal(pricedUsage(usage!, GEMINI_FLASH_LITE_PRICE), 0.000295);
  assert.equal(parseGeminiUsage({ promptTokenCount: -1 }), null);
});

test('explicit thinking effort reaches the provider and cannot reuse a lower-effort cache result', () => temporary(async directory => {
  const levels: unknown[] = [];
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, model: 'gemini-3.5-flash-lite', price: GEMINI_FLASH_LITE_PRICE, apiKey: 'fake', minRequestIntervalMs: 0,
    fetch: async (_url, init) => { levels.push(JSON.parse(String(init?.body)).generationConfig.thinkingConfig.thinkingLevel); return success(); } });
  await gateway.generateJson(request); await gateway.generateJson({ ...request, thinking_level: 'low' });
  await gateway.generateJson({ ...request, thinking_level: 'medium' }); await gateway.generateJson({ ...request, thinking_level: 'medium' });
  assert.deepEqual(levels, ['minimal','low','medium']); assert.equal(gateway.summary().cache_hits, 1);
}));

test('optional 3.8 verifier uses supported low thinking and omits deprecated temperature', () => temporary(async directory => {
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, model: 'gemini-3.8-flash', apiKey: 'fake', minRequestIntervalMs: 0,
    price: { ...GEMINI_FLASH_LITE_PRICE, input_per_million: 0.75, output_per_million: 3.75, cached_input_per_million: 0.075 },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
      assert.equal(Object.hasOwn(body.generationConfig, 'temperature'), false);
      return success();
    } });
  const result = await gateway.generateJson(request);
  assert.equal(result.usage?.output_tokens, 60); assert.equal(result.cost_usd, 0.00084);
}));

test('gateway journals one call, caches durably, and never stores the API key', () => temporary(async directory => {
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'never-log-this-secret', minRequestIntervalMs: 0,
    fetch: async (_url, init) => {
      calls++;
      assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'never-log-this-secret');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.generationConfig.responseJsonSchema, request.schema);
      assert.equal(body.tools, undefined);
      return success();
    } });
  const first = await gateway.generateJson(request), second = await gateway.generateJson(request);
  assert.deepEqual(first.value, { ok: true }); assert.equal(second.cache_hit, true); assert.equal(calls, 1);
  const restarted = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'unused', fetch: async () => { throw Error('must not request'); } });
  assert.equal((await restarted.generateJson(request)).cache_hit, true);
  assert.equal(restarted.summary().billable_attempts, 1);
  assert.equal(restarted.summary().measured_cost_usd, 0.000295);
  assert.equal(readFileSync(join(directory, 'model-ledger.jsonl'), 'utf8').includes('never-log-this-secret'), false);
}));

test('concurrent identical requests are coalesced into one paid attempt', () => temporary(async directory => {
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', minRequestIntervalMs: 0,
    fetch: async () => { calls++; return success(); } });
  const results = await Promise.all([gateway.generateJson(request), gateway.generateJson(request)]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.cache_hit).length, 1);
}));

test('budget reservation prevents network call and survives unresolved prior attempts', () => temporary(async directory => {
  writeFileSync(join(directory, 'model-ledger.jsonl'), JSON.stringify({ type: 'START', invocation_id: 'lost', reserved_usd: 0.02 }) + '\n');
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 0.01, apiKey: 'fake', minRequestIntervalMs: 0,
    fetch: async () => { calls++; return success(); } });
  await assert.rejects(gateway.generateJson(request), /MODEL_BUDGET_EXHAUSTED/);
  assert.equal(calls, 0); assert.equal(gateway.summary().unmetered_cost_upper_usd, 0.02);
}));

test('network failure remains usage-unknown instead of claiming zero actual cost', () => temporary(async directory => {
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', minRequestIntervalMs: 0, maxAttempts: 1,
    fetch: async () => { throw Error('secret provider transport detail'); } });
  await assert.rejects(gateway.generateJson(request), /MODEL_NETWORK_USAGE_UNKNOWN/);
  assert.ok(gateway.summary().unmetered_cost_upper_usd > 0);
  const text = readFileSync(join(directory, 'model-ledger.jsonl'), 'utf8');
  assert.equal(text.includes('secret provider transport detail'), false);
}));

test('permanent daily quota stops further attempts and emits only safe status', () => temporary(async directory => {
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', minRequestIntervalMs: 0,
    fetch: async () => { calls++; return new Response(JSON.stringify({ error: { message: 'secret account detail',
      details: [{ violations: [{ quotaId: 'GenerateRequestsPerDay', quotaValue: 20 }] }] } }), { status: 429 }); } });
  await assert.rejects(gateway.generateJson(request), /MODEL_DAILY_QUOTA_EXHAUSTED/);
  await assert.rejects(gateway.generateJson({ ...request, input: 'other' }), /MODEL_DAILY_QUOTA_EXHAUSTED/);
  assert.equal(calls, 1);
  assert.equal(readFileSync(join(directory, 'model-ledger.jsonl'), 'utf8').includes('secret account detail'), false);
}));

test('a temporary per-minute limit retries once within bounded attempts', () => temporary(async directory => {
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', minRequestIntervalMs: 0, maxAttempts: 2,
    fetch: async () => ++calls === 1 ? new Response(JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'RequestsPerMinute', quotaValue: 15 }] }] } }),
      { status: 429, headers: { 'retry-after': '0.001' } }) : success() });
  assert.deepEqual((await gateway.generateJson(request)).value, { ok: true });
  assert.equal(calls, 2); assert.equal(gateway.summary().unmetered_cost_upper_usd, 0);
}));

test('truncated last ledger event is repaired without discarding earlier reservations', () => temporary(async directory => {
  writeFileSync(join(directory, 'model-ledger.jsonl'), JSON.stringify({ type: 'START', invocation_id: 'lost', reserved_usd: 0.001 }) + '\n{"type":');
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', minRequestIntervalMs: 0, fetch: async () => success() });
  await gateway.generateJson(request);
  const lines = readFileSync(join(directory, 'model-ledger.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3); lines.forEach(line => assert.doesNotThrow(() => JSON.parse(line)));
  assert.equal(gateway.summary().unmetered_cost_upper_usd, 0.001);
}));

test('an already aborted request cannot consume budget or call the provider', () => temporary(async directory => {
  let calls = 0;
  const gateway = createGeminiGateway({ directory, budgetUsd: 1, apiKey: 'fake', fetch: async () => { calls++; return success(); } });
  await assert.rejects(gateway.generateJson({ ...request, signal: AbortSignal.abort() }), /MODEL_ABORTED/);
  assert.equal(calls, 0); assert.equal(gateway.summary().billable_attempts, 0);
}));
