import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequestScheduler, retryDelayMs } from '../src/infrastructure/llm/request-scheduler.js';

const limits = { concurrency: 2, rpm: 100, inputTpm: 1000, rpd: 1000 };
test('request slots remain bounded and queued aborts never consume quota', async () => {
  const scheduler = createRequestScheduler(limits);
  const a = await scheduler.acquire(100), b = await scheduler.acquire(100);
  const cancel = new AbortController();
  const c = scheduler.acquire(100, cancel.signal), rejection = assert.rejects(c, /MODEL_ABORTED/);
  assert.equal(scheduler.status().active, 2); assert.equal(scheduler.status().queued, 1);
  cancel.abort(); await rejection;
  assert.equal(scheduler.status().requestsToday, 2);
  a.finish(20); a.finish(); b.finish(30);
  assert.equal(scheduler.status().active, 0); assert.equal(scheduler.status().inputTokensLastMinute, 50);
});
test('RPM and input TPM independently gate admission until the rolling window expires', async () => {
  for (const override of [{ rpm: 1 }, { inputTpm: 150 }]) {
    const scheduler = createRequestScheduler({ ...limits, ...override }, { windowMs: 60 });
    const a = await scheduler.acquire(100); a.finish();
    let admitted = false; const next = scheduler.acquire(100).then(lease => { admitted = true; return lease; });
    await sleep(10); assert.equal(admitted, false);
    (await next).finish(); assert.equal(admitted, true);
  }
});
test('token reservations reconcile from actual usage without truncating inputs', async () => {
  const scheduler = createRequestScheduler({ ...limits, inputTpm: 150 });
  const a = await scheduler.acquire(100);
  const b = scheduler.acquire(100);
  assert.equal(scheduler.status().queued, 1);
  a.finish(20); (await b).finish(30);
  await assert.rejects(scheduler.acquire(151), /EXCEEDS_TOKEN_RATE_LIMIT/);
});
test('429 cooldown is shared, halves concurrency and honors provider delays above a minute', async () => {
  let now = Date.now();
  const scheduler = createRequestScheduler({ ...limits, concurrency: 8 }, { now: () => now });
  scheduler.cooldown(120_000);
  assert.equal(scheduler.status().concurrency, 4);
  const cancel = new AbortController(), pending = scheduler.acquire(10, cancel.signal);
  const rejected = assert.rejects(pending, /MODEL_ABORTED/);
  assert.equal(scheduler.status().active, 0); cancel.abort(); await rejected;
  now += 120_001; const lease = await scheduler.acquire(10); lease.finish();
  assert.equal(scheduler.status().cooldownUntil, null);
  assert.equal(retryDelayMs(new Response('', { status: 429, headers: { 'Retry-After': '120' } }), null, 5000), 120_000);
  assert.equal(retryDelayMs(null, { error: { details: [{ retryDelay: '125.5s' }] } }, 5000), 125_500);
  assert.equal(retryDelayMs(new Response('', { headers: { 'Retry-After': 'Tue, 03 Nov 2026 08:02:00 GMT' } }), null, 5000, Date.parse('2026-11-03T08:00:00Z')), 120_000);
});
test('local project/model quota survives restart and resets by Pacific date', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-rate-test-'));
  try {
    let now = Date.parse('2026-11-03T07:59:00Z');
    const options = { stateFile: join(directory, 'rate.json'), now: () => now };
    const first = createRequestScheduler({ ...limits, rpd: 1 }, options); (await first.acquire(10)).finish(5);
    const second = createRequestScheduler({ ...limits, rpd: 1 }, options);
    await assert.rejects(second.acquire(10), /DAILY_QUOTA/);
    now = Date.parse('2026-11-03T08:00:01Z'); (await second.acquire(10)).finish();
    assert.equal(second.status().requestsToday, 1);
  } finally { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); }
});
