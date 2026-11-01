#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function wilson(successes, n, z = 1.959963984540054) {
  if (!n) return null;
  const p = successes / n, denominator = 1 + z * z / n;
  const middle = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return { lower: Math.max(0, middle - radius), upper: Math.min(1, middle + radius) };
}

/** Sample metrics only. Missing predictions count as misses; unresolved rows retain bounds. */
export function evaluateOpportunitySample(reference, predictions, platformOf) {
  const predicted = new Map(predictions.map(r => [r.snapshot_id, r]));
  const result = {};
  for (const platform of ['facebook', 'threads']) {
    const rows = reference.filter(r => platformOf(r.snapshot_id) === platform);
    let tp = 0, fp = 0, fn = 0, tn = 0, acceptedUnknown = 0, otherUnknown = 0, pending = 0, unrelatedOnRelevant = 0, relevant = 0;
    const confusion = {};
    for (const row of rows) {
      const p = predicted.get(row.snapshot_id), accepted = p?.classification === 'SUITABLE' && p?.assessment_status === 'ASSESSED';
      const label = row.final_label ?? row.label;
      const predictionLabel = p?.assessment_status === 'ASSESSED' ? p.classification : 'PENDING_OR_FAILED';
      confusion[label] ??= {}; confusion[label][predictionLabel] = (confusion[label][predictionLabel] ?? 0) + 1;
      if (!p || p.assessment_status !== 'ASSESSED') pending++;
      if (label === 'REFERENCE_UNRESOLVED') { if (accepted) acceptedUnknown++; else otherUnknown++; continue; }
      if (label === 'SUITABLE') { if (accepted) tp++; else fn++; }
      else { if (accepted) fp++; else tn++; }
      if (['SUITABLE', 'NOT_YET'].includes(label)) { relevant++; if (p?.classification === 'UNRELATED') unrelatedOnRelevant++; }
    }
    const accepted = tp + fp + acceptedUnknown, knownPositive = tp + fn;
    result[platform] = { sample_records: rows.length, tp, fp, fn, tn, accepted, accepted_reference_unresolved: acceptedUnknown,
      other_reference_unresolved: otherUnknown, pending_or_failed: pending, confusion,
      precision_known_reference: tp + fp ? tp / (tp + fp) : null,
      precision_known_wilson95: wilson(tp, tp + fp),
      precision_bounds_including_unresolved: accepted ? { lower: tp / accepted, upper: (tp + acceptedUnknown) / accepted } : null,
      recall_known_reference: knownPositive ? tp / knownPositive : null,
      recall_bounds_including_unresolved: { lower: knownPositive + otherUnknown ? tp / (knownPositive + otherUnknown) : null,
        upper: knownPositive + acceptedUnknown ? (tp + acceptedUnknown) / (knownPositive + acceptedUnknown) : null },
      unrelated_on_known_relevant_rate: relevant ? unrelatedOnRelevant / relevant : null,
      sample_suitable_output_yield: rows.length ? accepted / rows.length : null,
      inference_scope: 'SAMPLE_ONLY_NO_POPULATION_EXTRAPOLATION',
      release_gate: 'NOT_EVALUATED_CALIBRATION_SET_NOT_FRESH_HOLDOUT' };
  }
  return result;
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = path.resolve(options.reference ?? path.join(process.env.APPDATA, 'csd-desktop/data/benchmarks/coffee-intent-20261030/conversation-reference-v2'));
  const relative = path.relative(root, directory);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const moduleRoot = path.resolve(options['module-root'] ?? path.join(root, 'dist'));
  const jsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const snapshots = jsonl(path.join(directory, 'snapshots-private.jsonl'));
  const reference = jsonl(path.join(directory, fs.existsSync(path.join(directory, 'reference-final-agent.jsonl')) ? 'reference-final-agent.jsonl' : 'reference-final.jsonl'));
  if (reference.length !== snapshots.length) throw Error('REFERENCE_INCOMPLETE');
  const { createGeminiGateway } = await import(pathToFileURL(path.join(moduleRoot, 'infrastructure/llm/gemini-gateway.js')).href);
  const { classifyConversations } = await import(pathToFileURL(path.join(moduleRoot, 'application/classification-service.js')).href);
  const { OPPORTUNITY_FILTER_VERSION, campaignVersion } = await import(pathToFileURL(path.join(moduleRoot, 'domain/campaign-plan.js')).href);
  const { version: oldVersion, created_at: oldTime, ...criteria } = manifest.campaign;
  const campaignCriteria = { ...criteria, filter_version: OPPORTUNITY_FILTER_VERSION };
  const campaign = { ...campaignCriteria, version: campaignVersion(campaignCriteria), created_at: oldTime };
  const tag = options['run-tag'] ?? 'baseline';
  if (!/^[a-zA-Z0-9.-]+$/u.test(tag)) throw Error('RUN_TAG_INVALID');
  const gateway = createGeminiGateway({ directory: path.join(directory, 'model'), budgetUsd: Number(options['max-usd'] ?? 1) });
  const file = path.join(directory, tag === 'baseline' ? 'classifier-predictions.jsonl' : `classifier-predictions-${tag}.jsonl`);
  const completed = new Set(jsonl(file).map(row => row.snapshot_id));
  const pending = snapshots.filter(snapshot => !completed.has(snapshot.id));
  const runLimit = Number(options.limit ?? pending.length);
  if (!Number.isInteger(runLimit) || runLimit < 0) throw Error('LIMIT_INVALID');
  const startCost = gateway.summary();
  if (options['score-only'] !== 'true') for (let index = 0; index < Math.min(pending.length, runLimit); index += 8) {
    const result = await classifyConversations(campaign, pending.slice(index, Math.min(index + 8, runLimit)), gateway);
    for (const decision of result.decisions) {
      const fd = fs.openSync(file, 'a');
      try { fs.appendFileSync(fd, JSON.stringify(decision) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    console.log(JSON.stringify({ event: 'calibration_progress', complete: completed.size + Math.min(index + 8, pending.length), total: snapshots.length, cost: gateway.summary() }));
    if (result.failures.some(f => /^MODEL_(?:BUDGET|AUTHENTICATION|BILLING|DAILY_QUOTA)/u.test(f.code))) break;
  }
  const byId = new Map(snapshots.map(s => [s.id, s]));
  const metrics = evaluateOpportunitySample(reference, jsonl(file), id => byId.get(id)?.platform);
  const endCost = gateway.summary();
  const ledger = jsonl(path.join(directory, 'model/model-ledger.jsonl'));
  const versionStarts = new Map(ledger.filter(e => e.type === 'START' && e.purpose === OPPORTUNITY_FILTER_VERSION).map(e => [e.invocation_id, e]));
  const versionFinishes = new Map(ledger.filter(e => e.type === 'FINISH' && versionStarts.has(e.invocation_id)).map(e => [e.invocation_id, e]));
  const versionCost = { measured_cost_usd: [...versionFinishes.values()].reduce((sum, e) => sum + (e.cost_usd ?? 0), 0),
    unmetered_cost_upper_usd: [...versionFinishes.values()].reduce((sum, e) => sum + e.unmetered_cost_upper_usd, 0)
      + [...versionStarts.values()].filter(e => !versionFinishes.has(e.invocation_id)).reduce((sum, e) => sum + e.reserved_usd, 0),
    request_attempts: versionStarts.size, scope: OPPORTUNITY_FILTER_VERSION + '_ALL_RESUMED_EXECUTIONS' };
  const report = { scope: manifest.purpose, filter_version: OPPORTUNITY_FILTER_VERSION, run_tag: tag,
    predictions_present: jsonl(file).length, expected_predictions: snapshots.length,
    reference_status: 'AI_REFERENCE_NOT_HUMAN_GOLD', metrics,
    this_execution_measured_cost_usd: endCost.measured_cost_usd - startCost.measured_cost_usd,
    this_execution_unmetered_cost_upper_usd: endCost.unmetered_cost_upper_usd - startCost.unmetered_cost_upper_usd,
    classifier_version_cost: versionCost,
    reference_and_calibration_shared_ledger: endCost,
    warning: 'Seen calibration sample. Do not claim production precision, total-network recall or cost per1000 population from this report.' };
  fs.writeFileSync(path.join(directory, tag === 'baseline' ? 'calibration-metrics.json' : `calibration-metrics-${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ event: 'calibration_finished', ...report }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error_code: /^[A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'CALIBRATION_FAILED' })); process.exitCode = 1;
});
