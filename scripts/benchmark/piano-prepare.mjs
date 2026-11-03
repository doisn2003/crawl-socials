// Authorized 2026-11-03 comparison; every HTTP attempt uses the same durable $6 envelope.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { developmentSpend, SPEND_DIRECTORY, REBUILD_MODEL } from '../../dist/infrastructure/llm/durable-spend.js';
import { compileSemanticTurn } from '../../dist/application/semantic-campaign.js';
import { withFilterPolicy } from '../../dist/application/filter-policy.js';

export const taskDirectory = resolve('artifacts/piano-comparison-20261103');
export const prompt = 'Tìm người dùng đang có nhu cầu học chơi đàn piano. Tìm người muốn mua đàn piano hoặc thuê đàn piano. Tìm những người đang bàn luận về đàn piano. Tìm những người chia sẻ câu chuyện của họ về piano. Tìm những người đam mê âm nhạc, đam mê piano';
mkdirSync(taskDirectory, { recursive: true });
const write = (name, value) => writeFileSync(join(taskDirectory, name), JSON.stringify(value, null, 2), { flush: true });
const authPath = join(SPEND_DIRECTORY, 'development-authorization.json');
// Historical task tooling must never grant itself a fresh spending allowance.
if (!process.argv.includes('--live')) throw Error('LIVE_FLAG_REQUIRED');
if (existsSync(join(taskDirectory, 'closed-spending.json'))) throw Error('TASK_ALREADY_CLOSED');
const authorization = JSON.parse(readFileSync(authPath, 'utf8'));
if (authorization.closedAt || authorization.scope !== 'DEVELOPMENT' || authorization.model !== REBUILD_MODEL
  || authorization.purpose !== 'piano-comparison-20261103') throw Error('TASK_AUTHORIZATION_REQUIRED');
if (!existsSync(join(taskDirectory, 'task.json'))) {
  const before = developmentSpend().status();
  const manifest = { id: 'piano-comparison-20261103', prompt, model: REBUILD_MODEL, targetPerMode: 1000, rawCap: 10000,
    maxTaskUsd: 6, maxTaskCalls: 1500, startingSpending: before, startedAt: new Date().toISOString(),
    source: 'Explicit user authorization in chat: Gemini 3.1 Flash-Lite, STANDARD + QUALITY, per-keyword Electron windows, total maximum USD 6.' };
  write('task.json', manifest);
}
const spending = developmentSpend();
const gateway = createGeminiGateway({ directory: join(taskDirectory, 'model'), model: REBUILD_MODEL,
  spending, budgetUsd: 6, maxAttempts: 1, minRequestIntervalMs: 1000, timeoutMs: 90000 });
if (!existsSync(join(taskDirectory, 'preflight.json'))) {
  const r = await gateway.generateJson({ purpose: 'access-preflight', system: 'Return JSON {"ok":true}.', input: {},
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, max_output_tokens: 32 });
  if (r.value?.ok !== true) throw Error('PREFLIGHT_FAILED');
  write('preflight.json', { success: true, model: r.model, usage: r.usage, costUsd: r.cost_usd });
  console.log(JSON.stringify({ phase: 'PREFLIGHT_OK', model: r.model, costUsd: r.cost_usd }));
}
if (!existsSync(join(taskDirectory, 'campaign.json'))) {
  const input = { campaign_id: 'piano-comparison-20261103', prompt, suitable_target: 1000, raw_cap: 10000,
    model_usd: 6, max_run_minutes: 90, planner_policy: 'controlled-semantic-dialogue-v1' };
  const intent = { stage: 'S2', prompt, context: '', seeds: [], revision: 1, answers: [], edits: [] };
  const result = await compileSemanticTurn(input, intent, gateway, { onAttempt: attempt => write('planner-attempt-' + attempt.result.invocation_id + '.json', attempt) });
  write('intent.json', result.plan);
  if (!result.campaign) throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  write('campaign.json', result.campaign);
  for (const mode of ['STANDARD', 'QUALITY']) write('campaign-' + mode + '.json', withFilterPolicy(result.campaign, mode));
}
const campaign = JSON.parse(readFileSync(join(taskDirectory, 'campaign.json'), 'utf8'));
console.log(JSON.stringify({ phase: 'READY', topic: campaign.topic, queries: campaign.queries, audience: campaign.audience,
  needs: campaign.needs, inclusions: campaign.inclusions, exclusions: campaign.exclusions, cost: gateway.summary(), global: spending.status() }));
