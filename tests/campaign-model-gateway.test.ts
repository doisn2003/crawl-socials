import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCampaignModelGateway } from '../src/infrastructure/llm/campaign-model-gateway.js';
import { createSharedModelBudget } from '../src/infrastructure/llm/shared-model-budget.js';
import type { JsonModelRequest } from '../src/application/ports/model-gateway.js';

async function temporary(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'csd-campaign-model-'));
  try { await work(directory); }
  finally { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('csd-campaign-model-')); rmSync(directory, { recursive: true, force: true }); }
}
function ledger(directory: string, known: number, unknown: number): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'model-ledger.jsonl'), [
    { type: 'START', invocation_id: 'known', reserved_usd: known },
    { type: 'FINISH', invocation_id: 'known', cost_usd: known, unmetered_cost_upper_usd: 0, result: null },
    { type: 'START', invocation_id: 'unfinished', reserved_usd: unknown },
  ].map(event => JSON.stringify(event)).join('\n') + '\n');
}
const request: JsonModelRequest = { purpose: 'same-filter', system: 'EXACT_UNCHANGED_SYSTEM', input: { frozen: true },
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, max_output_tokens: 100 };
const success = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 } }));

test('both legacy and new ledgers are registered before calls and summaries count known plus unresolved cost once', () => temporary(async directory => {
  ledger(join(directory, 'model'), 0.4, 0.2); ledger(join(directory, 'model-gemini-3.5-flash-lite'), 0.1, 0.05);
  const pool = createSharedModelBudget(1);
  const gateway = createCampaignModelGateway({ directory, budgetUsd: 1, sharedBudget: pool, apiKey: 'unused' });
  const s = gateway.summary();
  assert.equal(s.model, 'gemini-3.1-flash-lite'); assert.equal(s.measured_cost_usd, 0.5); assert.equal(s.unmetered_cost_upper_usd, 0.25);
  assert.equal(s.components?.length, 3); assert.equal(s.billable_attempts, 4); assert.ok(Math.abs(s.remaining_usd - 0.25) < 1e-12);
  assert.ok(Math.abs(pool.remaining() - 0.25) < 1e-12);
  assert.equal(JSON.parse(readFileSync(join(directory, 'model-routing.json'), 'utf8')).selection_reason, 'LEGACY_LEDGER_PRESERVED');
}));

test('explicit switch records reason and prior spend, then UI-style resume reads saved selection without another switch', () => temporary(async directory => {
  ledger(join(directory, 'model'), 0.4, 0.2);
  const selected = createCampaignModelGateway({ directory, budgetUsd: 1, primaryModel: 'gemini-3.5-flash-lite',
    selectionReason: 'MODEL_DAILY_QUOTA_EXHAUSTED', apiKey: 'never-record-this-key' });
  const file = join(directory, 'model-routing.json'), saved = readFileSync(file, 'utf8'), routing = JSON.parse(saved);
  assert.equal(selected.summary().model, 'gemini-3.5-flash-lite'); assert.equal(routing.history.length, 1);
  assert.equal(routing.history[0].from_model, 'gemini-3.1-flash-lite'); assert.equal(routing.history[0].measured_cost_before_usd, 0.4);
  assert.equal(routing.selection_reason, 'MODEL_DAILY_QUOTA_EXHAUSTED'); assert.equal(saved.includes('never-record-this-key'), false);
  const resumed = createCampaignModelGateway({ directory, budgetUsd: 1, apiKey: 'unused' });
  assert.equal(resumed.summary().model, 'gemini-3.5-flash-lite'); assert.equal(resumed.summary().unmetered_cost_upper_usd, 0.2);
  assert.equal(readFileSync(file, 'utf8'), saved);
}));

test('new campaigns default to2.5 at its explicit price, preserve caller prompt, and aggregate cache hits without rebilling', () => temporary(async directory => {
  let calls = 0;
  const gateway = createCampaignModelGateway({ directory, budgetUsd: 1, apiKey: 'fixture', minRequestIntervalMs: 0,
    fetch: async (url, init) => { calls++; assert.match(String(url), /gemini-2\.5-flash-lite:generateContent$/);
      const body = JSON.parse(String(init?.body)); assert.equal(body.systemInstruction.parts[0].text, request.system);
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), request.input); return success(); } });
  const first = await gateway.generateJson(request); await gateway.generateJson(request);
  assert.equal(first.cost_usd, 0.00014); assert.equal(calls, 1); assert.equal(gateway.summary().cache_hits, 1);
  assert.equal(gateway.summary().measured_cost_usd, 0.00014);
  assert.equal(gateway.summary().components?.find(p => p.model === 'gemini-3.1-flash-lite')?.billable_attempts, 0);
}));

test('old known and unresolved costs prevent a new-model request from escaping the campaign cap', () => temporary(async directory => {
  ledger(join(directory, 'model'), 0.006, 0.0039); let calls = 0;
  const gateway = createCampaignModelGateway({ directory, budgetUsd: 0.01, primaryModel: 'gemini-3.5-flash-lite', apiKey: 'fixture',
    minRequestIntervalMs: 0, fetch: async () => { calls++; return success(); } });
  await assert.rejects(gateway.generateJson(request), /MODEL_BUDGET_EXHAUSTED/); assert.equal(calls, 0);
  assert.equal(gateway.summary().measured_cost_usd, 0.006); assert.equal(gateway.summary().unmetered_cost_upper_usd, 0.0039);
}));

test('a quota error on the selected model never triggers an automatic API call to the other model', () => temporary(async directory => {
  let calls = 0;
  const gateway = createCampaignModelGateway({ directory, budgetUsd: 1, apiKey: 'fixture', minRequestIntervalMs: 0,
    fetch: async url => { calls++; assert.match(String(url), /gemini-2\.5-flash-lite:generateContent$/);
      return new Response(JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'RequestsPerDay', quotaValue: 0 }] }] } }), { status: 429 }); } });
  await assert.rejects(gateway.generateJson(request), /MODEL_DAILY_QUOTA_EXHAUSTED/);
  await assert.rejects(gateway.generateJson({ ...request, input: { next: true } }), /MODEL_DAILY_QUOTA_EXHAUSTED/);
  assert.equal(calls, 1); assert.equal(gateway.summary().components?.[0]?.billable_attempts, 0);
}));

test('invalid persisted routing and unsafe reason fail before any model request', () => temporary(async directory => {
  writeFileSync(join(directory, 'model-routing.json'), '{"active_model":"unknown"}');
  assert.throws(() => createCampaignModelGateway({ directory, budgetUsd: 1 }), /MODEL_ROUTING_INVALID/);
  assert.throws(() => createCampaignModelGateway({ directory, budgetUsd: 1, selectionReason: 'raw secret / provider message' }), /MODEL_ROUTING_REASON_INVALID/);
}));
