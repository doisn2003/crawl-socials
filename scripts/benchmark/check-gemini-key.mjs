// Cumulative development authorization is required; no credential output.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
const gateway = createGeminiGateway({ directory: join('artifacts', 'gemini-25-preflight'), budgetUsd: 0.01, maxAttempts: 1 });
try {
  const result = await gateway.generateJson({ purpose: 'access-preflight', system: 'Return JSON {"ok":true}.', input: {},
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, max_output_tokens: 32 });
  const receipt = { checked_at: new Date().toISOString(), success: result.value?.ok === true, model: result.model, usage: result.usage, cost: gateway.summary() };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) { console.error(error.code ?? 'PREFLIGHT_FAILED'); process.exitCode = 1; }
