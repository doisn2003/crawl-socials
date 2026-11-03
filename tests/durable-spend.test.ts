import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDurableSpend, REBUILD_MODEL } from '../src/infrastructure/llm/durable-spend.js';
import { createGeminiGateway } from '../src/infrastructure/llm/gemini-gateway.js';

test('a custom fetch still requires development authorization and cannot bypass the guard', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-guard-transport-'));
  try {
    const module = new URL('../src/infrastructure/llm/gemini-gateway.js', import.meta.url).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createGeminiGateway } from ${JSON.stringify(module)};
      let calls = 0;
      const gateway = createGeminiGateway({ directory: ${JSON.stringify(join(root, 'run'))}, apiKey: 'fixture', budgetUsd: .01,
        fetch: async () => { calls++; throw Error('TRANSPORT_MUST_NOT_START'); } });
      await assert.rejects(gateway.generateJson({purpose:'test', system:'', input:{}, schema:{type:'object'}, max_output_tokens:10}), /MODEL_SPEND_AUTH_REQUIRED/);
      assert.equal(calls, 0);
    `], { env: { ...process.env, USERPROFILE: root }, timeout: 10000, stdio: 'pipe' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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

test('zero allowance blocks transport; 3.1 defaults use its own price and minimal thinking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-spend-'));
  try {
    let allowed = false, calls = 0;
    const spending = createDurableSpend({ file: join(root, 'ledger.sqlite'), envelope: () => ({ scope: 'USER', model: REBUILD_MODEL,
      totalUsd: allowed ? 0.01 : 0, dailyUsd: allowed ? 0.01 : 0, maxCalls: 2 }) });
    const gateway = createGeminiGateway({ mockTransport: true, directory: join(root, 'run'), apiKey: 'fixture', budgetUsd: 0.01, minRequestIntervalMs: 0, spending,
      fetch: async (url, init) => {
        calls++; assert.match(String(url), /gemini-3\.1-flash-lite:generateContent$/);
        assert.deepEqual(JSON.parse(String(init?.body)).generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } }));
      } });
    const request = { purpose: 'test', system: '', input: {}, schema: { type: 'object' }, max_output_tokens: 100, thinking_level: 'minimal' as const };
    await assert.rejects(gateway.generateJson(request), /MODEL_GLOBAL_BUDGET_EXHAUSTED/); assert.equal(calls, 0);
    allowed = true; await gateway.generateJson(request);
    assert.equal(calls, 1); assert.equal(gateway.summary().measured_cost_usd, 0.0004);
    assert.equal(spending.status().measuredUsd, 0.0004);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy user call caps never block funded requests; restart preserves history and enforces daily/total money', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-user-money-'));
  try {
    let date = new Date('2026-11-03T10:00:00Z');
    const options = { file: join(root, 'ledger.sqlite'), now: () => date,
      envelope: () => ({ scope: 'USER' as const, model: REBUILD_MODEL, totalUsd: .01, dailyUsd: .006, maxCalls: 3 }) };
    const old = createDurableSpend(options);
    for (let i = 0; i < 3; i++) old.settle(old.reserve(REBUILD_MODEL, .001), i === 0 ? 0 : .001);
    const restarted = createDurableSpend(options);
    assert.equal(restarted.status().calls, 3);
    assert.equal(restarted.status().measuredUsd, .002);
    restarted.settle(restarted.reserve(REBUILD_MODEL, .004), .004);
    assert.equal(restarted.status().calls, 4, 'the fourth user request is permitted, without clearing old calls');
    assert.throws(() => restarted.reserve(REBUILD_MODEL, .001), /MODEL_GLOBAL_BUDGET_EXHAUSTED/, 'daily money still blocks');
    date = new Date('2026-11-04T10:00:00Z');
    const nextDay = createDurableSpend(options);
    nextDay.settle(nextDay.reserve(REBUILD_MODEL, .004), .004);
    assert.equal(nextDay.status().measuredUsd, .01);
    assert.throws(() => nextDay.reserve(REBUILD_MODEL, .001), /MODEL_GLOBAL_BUDGET_EXHAUSTED/, 'total money survives day changes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('user reservations work without a call cap, keep unknown cost, and development still requires its authorized cap', () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-user-reservations-'));
  try {
    const options = { file: join(root, 'ledger.sqlite'), envelope: () => ({ scope: 'USER' as const, model: REBUILD_MODEL, totalUsd: .01, dailyUsd: .01 }) };
    const a = createDurableSpend(options), b = createDurableSpend(options);
    const held = a.reserve(REBUILD_MODEL, .008);
    assert.throws(() => b.reserve(REBUILD_MODEL, .003), /MODEL_BUDGET_BUSY/);
    a.settle(held, null);
    assert.equal(createDurableSpend(options).status().heldUsd, .008);
    assert.throws(() => b.reserve(REBUILD_MODEL, .003), /MODEL_GLOBAL_BUDGET_EXHAUSTED/);
    const invalid = createDurableSpend({ file: options.file, envelope: () => ({ scope: 'DEVELOPMENT', model: REBUILD_MODEL, totalUsd: 1, dailyUsd: 1 } as never) });
    assert.throws(() => invalid.reserve(REBUILD_MODEL, .001), /MODEL_SPEND_POLICY_INVALID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('settlement disk failure retains uncertain cost without leaving an eternal in-flight allocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-spend-settlement-'));
  try {
    const gateway = createGeminiGateway({ mockTransport: true, directory: root, apiKey: 'fixture', budgetUsd: .01,
      spending: { reserve: () => 'reservation', settle: () => { throw Error('SETTLEMENT_DISK_FAILED'); },
        status: () => ({ calls: 1, measuredUsd: 0, heldUsd: .001, remainingUsd: .009, dailyRemainingUsd: .009 }) },
      fetch: async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } })) });
    await assert.rejects(gateway.generateJson({ purpose: 'test', system: '', input: {}, schema: { type: 'object' }, max_output_tokens: 20 }), /SETTLEMENT_DISK_FAILED/);
    assert.equal(gateway.summary().reserved_usd, 0);
    assert.ok(gateway.summary().unmetered_cost_upper_usd > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
