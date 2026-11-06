// Resume only the authorized campaign's retrieval planning, without opening social windows.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { developmentSpend, SPEND_DIRECTORY, REBUILD_MODEL } from '../../dist/infrastructure/llm/durable-spend.js';
import { createCoverageExpansion, readCoverageDiagnostics } from '../../dist/application/coverage-queries.js';

const id = 'cafe-consistent-recovery-20261106', directory = resolve('artifacts', id);
const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
if (!process.argv.includes('--live')) throw Error('LIVE_FLAG_REQUIRED');
const task = read('task.json'), current = read('status.json');
const authorization = JSON.parse(readFileSync(join(SPEND_DIRECTORY, 'development-authorization.json'), 'utf8'));
if (existsSync(join(directory, 'closed-spending.json')) || authorization.closedAt || authorization.purpose !== id
  || authorization.model !== REBUILD_MODEL || task.model !== REBUILD_MODEL || task.maxTaskUsd !== 10
  || authorization.totalUsd > task.startingSpending.measuredUsd + task.maxTaskUsd + 1e-9
  || authorization.maxCalls > task.startingSpending.calls + task.maxTaskCalls) throw Error('TASK_AUTHORIZATION_REQUIRED');
if (!existsSync(join(directory, 'STOP')) || !['STOPPED', 'PARTIAL', 'PAUSED_ERROR'].includes(current.state)) throw Error('PAUSED_RUN_REQUIRED');
const spending = developmentSpend();
if (spending.status().heldUsd) throw Error('UNSETTLED_SPEND');
const gateway = createGeminiGateway({ directory: join(directory, 'model'), model: REBUILD_MODEL, spending,
  budgetUsd: task.maxTaskUsd, timeoutMs: 90000, maxAttempts: 1 });
const opportunity = join(read('live-data-path.json').directory, 'collections', current.runId, 'opportunity');
const campaign = JSON.parse(readFileSync(join(opportunity, 'campaign.json'), 'utf8'));
const old = JSON.parse(readFileSync(join(opportunity, 'coverage-query-expansion.json'), 'utf8'));
const expand = createCoverageExpansion(opportunity, campaign, gateway, new AbortController().signal, () => ({ allowModel: true,
  accepted: current.progress.targetCount, raw: current.progress.counts.raw, pending: current.progress.counts.pending }));
let error = null, added = [];
try { added = await expand({ knownQueries: [...campaign.queries.map(q => q.text), ...old.queries], completeInitial: true }); }
catch (e) { error = /^[A-Z][A-Z0-9_]+$/.test(e.message ?? '') ? e.message : 'PREFLIGHT_FAILED'; }
const actual = spending.status(), coverage = readCoverageDiagnostics(opportunity);
const checkpoint = { at: new Date().toISOString(), taskUsd: actual.measuredUsd - task.startingSpending.measuredUsd,
  taskCalls: actual.calls - task.startingSpending.calls, taskHeldUsd: actual.heldUsd, cumulative: actual };
writeFileSync(join(directory, 'spending-checkpoint.json'), JSON.stringify(checkpoint, null, 2), { flush: true });
appendFileSync(join(directory, 'planning-preflights.jsonl'), JSON.stringify({ ...checkpoint, added, coverage, error }) + '\n', { flush: true });
console.log(JSON.stringify({ added: added.length, coverage, error, ...checkpoint }));
process.exitCode = error || coverage?.state !== 'COMPLETE' ? 2 : 0;
