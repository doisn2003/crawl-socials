#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateOpportunitySample } from './evaluate-opportunity-v2.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = path.resolve(options.reference ?? path.join(process.env.APPDATA, 'csd-desktop/data/benchmarks/coffee-intent-20261030/conversation-reference-v2'));
const output = path.join(base, 'primary-3.5-ablation-v1');
const relative = path.relative(root, output);
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_EXTERNAL');
fs.mkdirSync(output, { recursive: true });
const moduleRoot = path.resolve(options['module-root'] ?? path.join(root, '.test-build/src'));
const jsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
const hash = value => createHash('sha256').update(value).digest('hex');
const snapshots = jsonl(path.join(base, 'snapshots-private.jsonl'));
const reference = jsonl(path.join(base, 'reference-final-agent.jsonl'));
const primary31 = jsonl(path.join(base, 'classifier-predictions-v2.0.3.jsonl'));
const selected = ['facebook', 'threads'].flatMap(platform => snapshots.filter(s => s.platform === platform)
  .sort((a, b) => hash('primary-model-ablation-v1:' + a.id).localeCompare(hash('primary-model-ablation-v1:' + b.id))).slice(0, 50));
if (selected.length !== 100) throw Error('EXPECTED_100_SNAPSHOTS');
const selectedIds = new Set(selected.map(s => s.id));
const selectedReference = reference.filter(r => selectedIds.has(r.snapshot_id));
const selected31 = primary31.filter(r => selectedIds.has(r.snapshot_id));
if (selectedReference.length !== 100 || selected31.length !== 100) throw Error('COMPARISON_INPUT_INCOMPLETE');
const sourceManifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
const { campaignVersion, OPPORTUNITY_FILTER_VERSION } = await import(pathToFileURL(path.join(moduleRoot, 'domain/campaign-plan.js')).href);
if (OPPORTUNITY_FILTER_VERSION !== 'conversation-opportunity-v2.0.3') throw Error('FILTER_VERSION_CHANGED');
const { version: oldVersion, created_at, ...criteria } = sourceManifest.campaign;
const campaignCriteria = { ...criteria, filter_version: OPPORTUNITY_FILTER_VERSION };
const campaign = { ...campaignCriteria, version: campaignVersion(campaignCriteria), created_at };
if (selected31.some(p => p.campaign_version !== campaign.version)) throw Error('CAMPAIGN_VERSION_MISMATCH');
const { createGeminiGateway } = await import(pathToFileURL(path.join(moduleRoot, 'infrastructure/llm/gemini-gateway.js')).href);
const { classifyConversations, CLASSIFIER_SYSTEM } = await import(pathToFileURL(path.join(moduleRoot, 'application/classification-service.js')).href);
const manifest = { purpose: 'HISTORICAL_PRIMARY_MODEL_COMPARISON_NOT_FRESH_HOLDOUT', selection: 'fixed SHA256 order per platform over all reference labels',
  selected_ids: selected.map(s => s.id), snapshot_sha256: hash(JSON.stringify(selected)), reference_sha256: hash(JSON.stringify(selectedReference)),
  filter_version: OPPORTUNITY_FILTER_VERSION, classifier_system_sha256: hash(CLASSIFIER_SYSTEM), classifier_module_sha256: hash(fs.readFileSync(path.join(moduleRoot, 'application/classification-service.js'))),
  primary_31_source: 'classifier-predictions-v2.0.3.jsonl', alternative: 'gemini-3.5-flash-lite', max_usd: 0.10,
  reference_status: 'AI_REFERENCE_NOT_HUMAN_GOLD', no_prompt_tuning: true };
const manifestFile = path.join(output, 'manifest.json');
if (fs.existsSync(manifestFile) && JSON.stringify(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))) !== JSON.stringify(manifest)) throw Error('ABLATION_MANIFEST_CHANGED');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
const gateway = createGeminiGateway({ directory: path.join(output, 'model'), budgetUsd: 0.10, model: 'gemini-3.5-flash-lite',
  minRequestIntervalMs: 4500, maxAttempts: 1,
  price: { input_per_million: 0.30, output_per_million: 2.50, cached_input_per_million: 0.03,
    observed_at: '2026-10-30', source: 'https://ai.google.dev/gemini-api/docs/pricing' } });
const predictionFile = path.join(output, 'predictions-private.jsonl');
const done = new Set(jsonl(predictionFile).map(r => r.snapshot_id));
const waiting = selected.filter(s => !done.has(s.id));
for (let offset = 0; offset < waiting.length; offset += 8) {
  const result = await classifyConversations(campaign, waiting.slice(offset, offset + 8), gateway,
    { cacheNamespace: 'primary-model-ablation-v1' });
  const fd = fs.openSync(predictionFile, 'a');
  try { fs.appendFileSync(fd, result.decisions.map(d => JSON.stringify(d)).join('\n') + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  console.log(JSON.stringify({ event: 'primary_ablation_progress', completed: done.size + Math.min(offset + 8, waiting.length),
    known_cost_usd: gateway.summary().measured_cost_usd, unknown_upper_usd: gateway.summary().unmetered_cost_upper_usd }));
  if (result.failures.some(f => /^MODEL_(?:BUDGET|AUTHENTICATION|BILLING|DAILY_QUOTA|NOT_AVAILABLE|PERMISSION)/u.test(f.code))) break;
}
const bySnapshot = new Map(selected.map(s => [s.id, s]));
const alternativePredictions = jsonl(predictionFile);
const ledger = jsonl(path.join(output, 'model/model-ledger.jsonl'));
const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, thinking_tokens: 0 };
for (const e of ledger.filter(e => e.type === 'FINISH')) for (const key of Object.keys(usage)) usage[key] += e.result?.usage?.[key] ?? 0;
const baselineLedger = jsonl(path.join(base, 'model/model-ledger.jsonl'));
const baselineStarts = new Set(baselineLedger.filter(e => e.type === 'START' && e.purpose === OPPORTUNITY_FILTER_VERSION).map(e => e.invocation_id));
let baselineAllocatedCost = 0;
for (const e of baselineLedger.filter(e => e.type === 'FINISH' && baselineStarts.has(e.invocation_id))) {
  const values = Array.isArray(e.result?.value) ? e.result.value : [];
  if (values.length) baselineAllocatedCost += (e.cost_usd ?? 0) * values.filter(v => selectedIds.has(v.snapshot_id)).length / values.length;
}
const baselineById = new Map(selected31.map(r => [r.snapshot_id, r]));
const referenceById = new Map(selectedReference.map(r => [r.snapshot_id, r]));
const pairedChanges = { recovered_true_positive: 0, lost_true_positive: 0, removed_false_positive: 0, introduced_false_positive: 0 };
for (const d of alternativePredictions) {
  const prior = baselineById.get(d.snapshot_id), label = referenceById.get(d.snapshot_id)?.final_label;
  if (!prior || label === 'REFERENCE_UNRESOLVED') continue;
  const before = prior.classification === 'SUITABLE' && prior.assessment_status === 'ASSESSED';
  const after = d.classification === 'SUITABLE' && d.assessment_status === 'ASSESSED';
  if (before !== after) pairedChanges[label === 'SUITABLE' ? (after ? 'recovered_true_positive' : 'lost_true_positive')
    : (after ? 'introduced_false_positive' : 'removed_false_positive')]++;
}
const report = { manifest, predictions_present: alternativePredictions.length, expected_predictions: 100,
  baseline_31: evaluateOpportunitySample(selectedReference, selected31, id => bySnapshot.get(id)?.platform),
  alternative_35: evaluateOpportunitySample(selectedReference, alternativePredictions, id => bySnapshot.get(id)?.platform),
  baseline_31_cost_allocation: { estimated_usd: baselineAllocatedCost,
    method: 'Proportional record-count allocation from historical 8-record batches; not a separately metered 100-record request run.' },
  paired_binary_changes: pairedChanges,
  usage, model_ledger: gateway.summary(),
  warning: 'Historical seen sample; model selection diagnostic only. This cannot certify production precision or comments/discovery recall.' };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ event: 'primary_ablation_finished', ...report }));
