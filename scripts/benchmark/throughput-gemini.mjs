// Bounded real-API transport probe. Synthetic topics only; no AppData/account reads.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createGeminiGateway, resolveGeminiApiKey } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { GEMINI_35_FLASH_LITE_PRICE } from '../../dist/infrastructure/llm/campaign-model-gateway.js';
import { createRequestScheduler } from '../../dist/infrastructure/llm/request-scheduler.js';
import { createSharedModelBudget } from '../../dist/infrastructure/llm/shared-model-budget.js';
import { GEMINI_35_PROJECT_LIMITS } from '../../dist/shared/throughput.js';
const directory = resolve(process.argv[2] || 'artifacts/parallel-crawl-20261103/api-probe');
await mkdir(directory, { recursive: true });
const key = resolveGeminiApiKey(); if (!key) throw Error('GEMINI_API_KEY_MISSING');
const budget = createSharedModelBudget(.20), measurements = [];
const scheduler = createRequestScheduler({ ...GEMINI_35_PROJECT_LIMITS, concurrency: 1 }, { stateFile: join(directory, 'rate-limit.json') });
for (const concurrency of [1, 4]) {
  scheduler.configure({ ...GEMINI_35_PROJECT_LIMITS, concurrency });
  let active = 0, peak = 0;
  const gateway = createGeminiGateway({ directory: join(directory, 'concurrency-' + concurrency), budgetUsd: .20, sharedBudget: budget,
    apiKey: key, model: 'gemini-3.5-flash-lite', price: GEMINI_35_FLASH_LITE_PRICE, scheduler, maxAttempts: 1,
    fetch: async (...args) => { peak = Math.max(peak, ++active); try { return await fetch(...args); } finally { active--; } } });
  const start = performance.now();
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => gateway.generateJson({ purpose: 'transport-concurrency-smoke-v1',
    system: 'Return JSON with the exact input id and topic. Do not add commentary.', input: { id: i, topic: i % 2 ? 'quán cafe' : 'phòng cho thuê' },
    schema: { type: 'object', properties: { id: { type: 'integer' }, topic: { type: 'string' } }, required: ['id', 'topic'] }, max_output_tokens: 128 })));
  const failures = results.flatMap(r => r.status === 'rejected' ? [r.reason?.code ?? 'PROBE_FAILED'] : []);
  results.forEach((r, i) => { if (r.status === 'fulfilled') { assert.equal(r.value.value.id, i); assert.equal(r.value.value.topic, i % 2 ? 'quán cafe' : 'phòng cho thuê'); } });
  measurements.push({ concurrency, peak_http_requests: peak, elapsed_ms: Math.round(performance.now() - start), successes: results.length - failures.length, failures,
    ledger: gateway.summary() });
  await writeFile(join(directory, 'result.json'), JSON.stringify({ scope: 'SYNTHETIC_TRANSPORT_ONLY_NOT_CRAWL_OR_CLASSIFIER_BENCHMARK', measurements }, null, 2));
  console.log(JSON.stringify(measurements.at(-1)));
  if (failures.length) break;
}
