import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { runParallelCollectors } from '../src/application/parallel-collector.js';
import type { CollectorInput, CollectorReceipt } from '../src/application/production-service.js';
import { parseUserConfig } from '../src/infrastructure/config/user-config.js';

function hold<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const receipt: CollectorReceipt = { stop_reason: 'QUERY_BUDGET_COMPLETE', summary: { unique: 2 }, session_flush: 'OK' };
async function fixture(work: (input: CollectorInput) => Promise<void>) {
  const output = mkdtempSync(join(tmpdir(), 'csd-parallel-'));
  try { await work({ platform: 'threads', profileId: 'fixture', config: { runId: 'test-parallel', output, queries: ['one', 'two', 'three', 'four'],
    parallelWorkers: 2, maxMinutes: 10, targetTotal: 100, maxScrollsPerQuery: 1, settleMs: 2000 }, shouldStop: () => false, onProgress() {} }); }
  finally { assert.equal(dirname(resolve(output)), resolve(tmpdir())); rmSync(output, { recursive: true, force: true }); }
}
function rows(id: string, query: string) { return [{ platform: 'threads', post_id: id, shortcode: 'code-' + id, query, text: 'question ' + id,
  post_url: 'https://www.threads.com/@fixture/post/code-' + id, extraction_method: 'EMBEDDED_DOCUMENT_JSON' }]; }
const provenance = (runId: string) => ({ run_id: runId, batch_id: runId + '-1', query_index: 0, scroll_index: 0, method: 'EMBEDDED_DOCUMENT_JSON', response_sha256: 'fixture', operation: null, request_id: null });

test('parallel lanes have independent checkpoints, aggregate once, retain all observations and resume the same assignments', () => fixture(async input => {
  const ready = hold(), release = hold(), calls: CollectorInput[] = [], observations: string[] = [];
  input.onRecords = async records => { observations.push(String(records[0]?.post_id)); };
  const work = runParallelCollectors(input, async (worker, workerId) => {
    calls.push(worker); assert.ok(workerId); if (calls.length === 2) ready.resolve();
    await release.promise;
    await worker.onRecords!(rows('shared', String((worker.config.queries as string[])[0])), provenance(String(worker.config.runId)));
    await worker.onRecords!(rows(String(workerId), 'unique'), provenance(String(worker.config.runId)));
    return receipt;
  });
  await ready.promise; assert.equal(calls.length, 2); release.resolve();
  const result = await work; assert.equal(result.summary.unique, 3); assert.equal(observations.length, 4);
  assert.deepEqual(calls.map(v => v.config.queries), [['one', 'three'], ['two', 'four']]);
  assert.notEqual(calls[0]!.config.output, calls[1]!.config.output);
  const resumed: CollectorInput[] = [];
  await runParallelCollectors({ ...input, resume: true }, async value => { resumed.push(value); return receipt; });
  assert.deepEqual(resumed.map(v => v.config), calls.map(v => v.config)); assert.ok(resumed.every(v => v.resume));
  const stored = readFileSync(join(String(input.config.output), 'posts.jsonl'), 'utf8').trim().split('\n'); assert.equal(stored.length, 3);
  await assert.rejects(runParallelCollectors({ ...input, config: { ...input.config, parallelWorkers: 3 } }, async () => receipt), /RUN_CONFIG_CHANGED/);
}));
test('one account barrier stops every sibling but waits for their flush before returning', () => fixture(async input => {
  const ready = hold(), release = hold(), calls: CollectorInput[] = []; let settled = false;
  const work = runParallelCollectors(input, async value => {
    calls.push(value); if (calls.length === 2) ready.resolve();
    await ready.promise;
    if (calls[0] === value) { value.onProgress({ event: 'HTTP_BARRIER' }); return { ...receipt, stop_reason: 'ACCOUNT_BARRIER' }; }
    await release.promise; assert.equal(value.shouldStop(), true); return { ...receipt, stop_reason: 'USER_STOP' };
  }).then(value => { settled = true; return value; });
  await ready.promise; await new Promise<void>(setImmediate); assert.equal(settled, false);
  release.resolve(); assert.equal((await work).stop_reason, 'ACCOUNT_BARRIER');
}));
test('user Stop signals every lane and preserves durable partial aggregate', () => fixture(async input => {
  let stopped = false; const ready = hold(), release = hold(); let calls = 0;
  const work = runParallelCollectors({ ...input, shouldStop: () => stopped }, async value => {
    const index = ++calls; if (calls === 2) ready.resolve();
    await value.onRecords!(rows(String(index), 'partial'), provenance(String(value.config.runId)));
    await release.promise; assert.equal(value.shouldStop(), true); return { ...receipt, stop_reason: 'USER_STOP' };
  });
  await ready.promise; stopped = true; release.resolve();
  const result = await work; assert.equal(result.summary.unique, 2); assert.equal(result.stop_reason, 'USER_STOP');
}));
test('legacy single-window config is not resharded on resume', () => fixture(async input => {
  const { parallelWorkers: _unused, ...config } = input.config;
  let calls = 0; await runParallelCollectors({ ...input, config, resume: true }, async (value, slot) => {
    calls++; assert.equal(slot, null); assert.deepEqual(value.config, config); return receipt;
  }); assert.equal(calls, 1);
}));
test('performance preference is optional for old configs and validated for new ones', () => {
  const prior = { keywords: ['x'], minimumPosts: 1 };
  assert.deepEqual(parseUserConfig(prior), prior);
  assert.equal(parseUserConfig({ ...prior, performance: 'FAST' }).performance, 'FAST');
  assert.throws(() => parseUserConfig({ ...prior, performance: 'UNBOUNDED' }), /CONFIG_INVALID/);
});
