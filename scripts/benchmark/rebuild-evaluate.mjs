// Frozen, small evaluation. Dry-run is default. --live still requires the shared development authorization file.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { classifyConversations, classifierRecipe } from '../../dist/application/classification-service.js';
import { withFilterPolicy } from '../../dist/application/filter-policy.js';
import { createGeminiGateway } from '../../dist/infrastructure/llm/gemini-gateway.js';
import { createSharedModelBudget } from '../../dist/infrastructure/llm/shared-model-budget.js';
import { developmentSpend, REBUILD_MODEL } from '../../dist/infrastructure/llm/durable-spend.js';

const root = resolve(process.argv.find(v => v.startsWith('--out='))?.slice(6) ?? 'artifacts/csd-rebuild-20261103');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const write = (file, value) => writeFileSync(join(root, file), JSON.stringify(value, null, 2));
const frozen = read('piano-holdout.json'), reference = read('piano-reference-labels.json');
const inputHash = hash(readFileSync(join(root, 'piano-holdout.json'))), labelHash = hash(readFileSync(join(root, 'piano-reference-labels.json')));
assert.equal(inputHash, reference.holdoutSha256); assert.equal(reference.candidatePredictionsSeen, false);
assert.equal(frozen.sample.length, 100); assert.equal(reference.labels.length, 100);
const proposal = { model: REBUILD_MODEL, maxCalls: 25, cumulativeUsd: .1, batchSize: 10, sampleSize: 100,
  scope: 'One access preflight, then STANDARD and QUALITY on the same frozen sample. QUALITY reuses STANDARD. No crawling, planner, fallback or format-repair calls.',
  inputHash, labelHash, recipeHash: hash(JSON.stringify(['coverage-standard-v1', 'coverage-quality-v1'].map(classifierRecipe))) };
if (!process.argv.includes('--live')) { console.log(JSON.stringify({ ...proposal, authorization: 'NOT_CHECKED_IN_DRY_RUN', action: 'DRY_RUN_ONLY' }, null, 2)); process.exit(0); }
const spending = developmentSpend();
// Validate existing user authorization before creating any transport or reading a key.
spending.status();
const manifestFile = join(root, 'evaluation-manifest.json');
if (existsSync(manifestFile)) assert.deepEqual(read('evaluation-manifest.json'), proposal, 'Evaluation inputs/recipe changed; do not silently reuse the holdout');
else write('evaluation-manifest.json', proposal);
const sharedBudget = createSharedModelBudget(proposal.cumulativeUsd), liveDirectory = join(root, 'live'); mkdirSync(liveDirectory, { recursive: true });
const base = createGeminiGateway({ directory: join(liveDirectory, 'gateway'), model: REBUILD_MODEL, spending, sharedBudget,
  budgetUsd: proposal.cumulativeUsd, maxAttempts: 1, minRequestIntervalMs: 1200, timeoutMs: 45000 });
const gateway = { summary: base.summary, generateJson(request) {
  if (base.summary().billable_attempts >= proposal.maxCalls) throw Error('EVALUATION_CALL_LIMIT_REACHED');
  return base.generateJson(request);
} };
if (existsSync(join(root, 'access-preflight.json')) && read('access-preflight.json').success === false && !process.argv.includes('--retry-access')) {
  console.log('ACCESS_PREFLIGHT_ALREADY_FAILED: resolve model access before an explicit --retry-access; budget and call counters are retained.'); process.exit(1);
}
try {
  const guard = await gateway.generateJson({ purpose: 'access-preflight', system: 'Return JSON {"ok":true}.', input: {},
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, max_output_tokens: 32 });
  assert.equal(guard.value?.ok, true, 'GENERATION_ACCESS_NOT_VERIFIED');
  write('access-preflight.json', { success: true, model: guard.model, usage: guard.usage, costUsd: guard.cost_usd });
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'ACCESS_PREFLIGHT_FAILED';
  write('access-preflight.json', { success: false, model: REBUILD_MODEL, code, at: new Date().toISOString(), cost: gateway.summary() });
  write('evaluation-summary.json', { status: 'BLOCKED_AT_ACCESS_PREFLIGHT', proposal, error: code, cost: gateway.summary(),
    globalSpending: spending.status(), evaluatedPosts: 0, modes: [], qualityMeasured: false });
  console.log(JSON.stringify({ status: 'BLOCKED_AT_ACCESS_PREFLIGHT', code, evaluatedPosts: 0, cost: gateway.summary() })); process.exit(1);
}

function metrics(result) {
  const decisions = new Map(result.decisions.map(d => [d.snapshot_id, d]));
  let tp = 0, fp = 0, fn = 0, tn = 0, acceptedUnknown = 0, pending = 0;
  for (const row of frozen.sample) {
    const label = reference.labels.find(l => l.index === row.index); assert.equal(label.key, row.key);
    const d = decisions.get(row.snapshot.id), accepted = d?.classification === 'SUITABLE' && d.assessment_status === 'ASSESSED';
    if (!d || d.assessment_status !== 'ASSESSED') pending++;
    if (label.label === 'UNKNOWN') { if (accepted) acceptedUnknown++; continue; }
    if (accepted) label.label === 'SUITABLE' ? tp++ : fp++;
    else label.label === 'SUITABLE' ? fn++ : tn++;
  }
  const accepted = tp + fp + acceptedUnknown, n = tp + fp, p = n ? tp / n : null;
  const z = 1.96, denominator = 1 + z * z / (n || 1), center = n ? (p + z * z / (2 * n)) / denominator : null;
  const half = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator : null;
  return { sample: 100, labelledKnown: tp + fp + fn + tn, referenceUnknown: 7, accepted, pending, tp, fp, fn, tn, acceptedUnknown,
    precisionKnown: p, precisionWilson95: n ? [center - half, center + half] : null, recallKnown: tp / (tp + fn),
    precisionBoundsIncludingUnknown: accepted ? [tp / accepted, (tp + acceptedUnknown) / accepted] : null };
}
const reports = [];
for (const mode of ['STANDARD', 'QUALITY']) {
  const file = 'evaluation-' + mode.toLowerCase() + '.json';
  if (existsSync(join(root, file))) { reports.push(read(file)); continue; }
  const before = gateway.summary(), start = performance.now();
  const result = await classifyConversations(withFilterPolicy(frozen.goal, mode), frozen.sample.map(row => row.snapshot), gateway,
    { evaluatedAt: frozen.asOf, maxBatchSize: proposal.batchSize, assessmentCacheDirectory: join(liveDirectory, 'assessment-cache') });
  const after = gateway.summary(), score = metrics(result), incrementalUsd = after.measured_cost_usd - before.measured_cost_usd;
  const standardUsd = reports.find(r => r.mode === 'STANDARD')?.incrementalUsd ?? 0;
  const totalModeUsd = mode === 'QUALITY' ? standardUsd + incrementalUsd : incrementalUsd;
  const report = { mode, model: REBUILD_MODEL, createdAt: new Date().toISOString(), inputHash, labelHash, recipeHash: proposal.recipeHash,
    ...score, calls: after.billable_attempts - before.billable_attempts, seconds: (performance.now() - start) / 1000,
    incrementalUsd, totalModeUsd, usdPer1000Inputs: totalModeUsd * 10, usdPerKnownTruePositive: score.tp ? totalModeUsd / score.tp : null,
    outputTokens: result.model_results.reduce((n, r) => n + (r.usage?.output_tokens ?? 0), 0), failures: result.failures,
    decisions: result.decisions, cumulativeCost: after, evaluationCaveat: reference.annotator };
  write(file, report); reports.push(report);
  console.log(JSON.stringify({ mode, accepted: report.accepted, pending: report.pending, precision: report.precisionKnown, recall: report.recallKnown, incrementalUsd }));
  // A systemic model/budget failure stops this experiment; no cascade of additional experiments.
  if (result.failures.some(f => /MODEL_|GEMINI_/.test(f.code))) break;
}
write('evaluation-summary.json', { proposal, cost: gateway.summary(), globalSpending: spending.status(),
  modes: reports.map(({ decisions, ...rest }) => rest), note: 'One blinded agent reference set; not customer-validated ground truth. Do not tune on this holdout and reuse its score as independent evidence.' });
