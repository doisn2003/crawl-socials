import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableSpend, REBUILD_MODEL } from '../src/infrastructure/llm/durable-spend.js';
import { createGeminiGateway } from '../src/infrastructure/llm/gemini-gateway.js';

test('durable reservations span callers/restart/day; unknown cost never expires', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-spend-'));
  try {
    let date = new Date('2026-11-03T10:00:00Z');
    const envelope = () => ({ scope: 'DEVELOPMENT' as const, model: REBUILD_MODEL, totalUsd: 0.1, dailyUsd: 0.1, maxCalls: 3 });
    const options = { envelope, file: join(root, 'ledger.sqlite'), now: () => date };
    const a = createDurableSpend(options), b = createDurableSpend(options);
    const first = a.reserve(REBUILD_MODEL, 0.08);
    assert.throws(() => b.reserve(REBUILD_MODEL, 0.03), /MODEL_BUDGET_BUSY/);
    a.settle(first, 0.02);
    const lost = b.reserve(REBUILD_MODEL, 0.07); b.settle(lost, null);
    date = new Date('2026-11-04T10:00:00Z');
    const restarted = createDurableSpend(options);
    assert.equal(restarted.status().heldUsd, 0.07);
    assert.throws(() => restarted.reserve(REBUILD_MODEL, 0.02), /MODEL_GLOBAL_BUDGET_EXHAUSTED/);
    assert.throws(() => restarted.reserve('gemini-3.5-flash-lite', 0.001), /MODEL_NOT_AUTHORIZED/);
    const last = restarted.reserve(REBUILD_MODEL, 0.005); restarted.settle(last, 0);
    assert.throws(() => restarted.reserve(REBUILD_MODEL, 0.001), /MODEL_CALL_LIMIT_REACHED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('zero allowance blocks transport; 2.5 defaults use its price and thinkingBudget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-spend-'));
  try {
    let allowed = false, calls = 0;
    const spending = createDurableSpend({ file: join(root, 'ledger.sqlite'), envelope: () => ({ scope: 'USER', model: REBUILD_MODEL,
      totalUsd: allowed ? 0.01 : 0, dailyUsd: allowed ? 0.01 : 0, maxCalls: 2 }) });
    const gateway = createGeminiGateway({ directory: join(root, 'run'), apiKey: 'fixture', budgetUsd: 0.01, minRequestIntervalMs: 0, spending,
      fetch: async (url, init) => {
        calls++; assert.match(String(url), /gemini-2\.5-flash-lite:generateContent$/);
        assert.deepEqual(JSON.parse(String(init?.body)).generationConfig.thinkingConfig, { thinkingBudget: 0 });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } }));
      } });
    const request = { purpose: 'test', system: '', input: {}, schema: { type: 'object' }, max_output_tokens: 100, thinking_level: 'medium' as const };
    await assert.rejects(gateway.generateJson(request), /MODEL_GLOBAL_BUDGET_EXHAUSTED/); assert.equal(calls, 0);
    allowed = true; await gateway.generateJson(request);
    assert.equal(calls, 1); assert.equal(gateway.summary().measured_cost_usd, 0.00014);
    assert.equal(spending.status().measuredUsd, 0.00014);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
