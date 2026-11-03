import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runQueryCollectors } from '../src/application/query-collector.js';
import { createWindowScheduler } from '../src/application/window-scheduler.js';
import type { CollectorInput } from '../src/application/production-service.js';

test('8 keywords x 2 platforms own 16 independent windows/checkpoints; failed window does not cancel siblings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-query-'));
  const windows = createWindowScheduler({ sample: () => ({ freeBytes: 12e9, totalBytes: 16e9, cpuBusy: 0.1 }), staggerMs: 0 });
  const calls = new Map<string, number>(), childConfigs = new Map<string, string>(); let active = 0, peak = 0;
  try {
    const results = await Promise.all((['facebook', 'threads'] as const).map(platform => {
      const input: CollectorInput = { platform, profileId: 'fixture-' + platform, config: { runId: 'query-test-' + platform,
        output: join(root, platform), queries: Array.from({ length: 8 }, (_, i) => 'keyword ' + i), maxMinutes: 10, windowMode: 'ALL' },
        shouldStop: () => false, onProgress() {} };
      return runQueryCollectors(input, async (child, id) => {
        assert.ok(id); assert.equal((child.config.queries as string[]).length, 1); assert.equal(child.config.maxScrollsPerQuery, 3);
        const count = (calls.get(id) ?? 0) + 1; calls.set(id, count);
        if (childConfigs.has(id)) { assert.equal(JSON.stringify(child.config), childConfigs.get(id)); assert.equal(child.resume, true); }
        else childConfigs.set(id, JSON.stringify(child.config));
        peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
        if (platform === 'facebook' && (child.config.queries as string[])[0] === 'keyword 0') throw Error('WINDOW_CLOSED');
        return { stop_reason: count === 1 ? 'QUERY_BUDGET_COMPLETE' : 'SOURCE_EXHAUSTED', summary: { unique: 0 }, session_flush: 'OK' };
      }, windows);
    }));
    assert.equal(calls.size, 16); assert.equal(peak, 16);
    assert.equal(results[0]!.stop_reason, 'QUERY_WORKER_FAILED'); assert.equal(results[1]!.stop_reason, 'SOURCE_EXHAUSTED');
    const tasks = JSON.parse(readFileSync(join(root, 'facebook', 'runs', 'query-test-facebook', 'query-tasks.json'), 'utf8')).tasks;
    assert.equal(tasks.filter((t: { state: string }) => t.state === 'COMPLETED').length, 7);
    assert.equal(new Set([...childConfigs.values()].map(s => JSON.parse(s).output)).size, 16);
    assert.equal(windows.status().active, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resource pressure yields excess windows and queued user cancellation releases all slots', async () => {
  let clock = 2000, freeBytes = 12e9;
  const windows = createWindowScheduler({ now: () => clock, staggerMs: 0, sample: () => ({ freeBytes, totalBytes: 16e9, cpuBusy: 0 }) });
  const first = await windows.acquire('facebook', true, () => false), second = await windows.acquire('threads', true, () => false);
  freeBytes = 1e8; clock += 2000;
  assert.equal(first.shouldYield(), true); assert.equal(second.shouldYield(), true);
  await assert.rejects(windows.acquire('facebook', true, () => true), /USER_STOP/);
  first.release(); second.release(); assert.equal(windows.status().active, 0);
});
