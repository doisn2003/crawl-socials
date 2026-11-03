import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedModelBudget } from '../src/infrastructure/llm/shared-model-budget.js';
import { createGeminiGateway } from '../src/infrastructure/llm/gemini-gateway.js';

test('different model ledgers share reservations and recover unknown spend without double counting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-shared-model-'));
  let release: () => void = () => {};
  try {
    const pool = createSharedModelBudget(0.001);
    const body = { purpose: 'pool', system: 'data', input: {}, schema: { type: 'object' }, max_output_tokens: 100 };
    const first = createGeminiGateway({ mockTransport: true, model: 'gemini-3.1-flash-lite', directory: join(directory, 'first'), budgetUsd: 0.001, sharedBudget: pool,
      apiKey: 'fixture', minRequestIntervalMs: 0, fetch: async () => {
        await new Promise<void>(resolve => { release = resolve; });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }));
      } });
    let secondCalls = 0;
    const secondDir = join(directory, 'second'); mkdirSync(secondDir);
    writeFileSync(join(secondDir, 'model-ledger.jsonl'), JSON.stringify({ type: 'START', invocation_id: 'unknown', reserved_usd: 0.0003 }) + '\n');
    const second = createGeminiGateway({ mockTransport: true, model: 'gemini-3.1-flash-lite', directory: secondDir, budgetUsd: 0.001, sharedBudget: pool,
      apiKey: 'fixture', minRequestIntervalMs: 0, fetch: async () => { secondCalls++; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })); } });
    const pending = first.generateJson(body);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(first.summary().reserved_usd > 0);
    const waiting = second.generateJson(body);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(secondCalls, 0);
    release(); await pending; await waiting; assert.equal(secondCalls, 1);
    assert.ok(pool.remaining() > 0);
    const before = pool.remaining();
    createGeminiGateway({ mockTransport: true, model: 'gemini-3.1-flash-lite', directory: secondDir, budgetUsd: 0.001, sharedBudget: pool, apiKey: 'fixture' });
    assert.equal(pool.remaining(), before);
    assert.equal(second.summary().unmetered_cost_upper_usd, 0.0003);
  } finally { release(); rmSync(directory, { recursive: true, force: true }); }
});
