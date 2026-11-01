#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = path.resolve(options.reference ?? path.join(process.env.APPDATA, 'csd-desktop/data/benchmarks/coffee-intent-20261030/conversation-reference-v2'));
const tag = options.tag ?? 'verifier-ablation-v1';
if (!/^[a-zA-Z0-9.-]+$/u.test(tag)) throw Error('INVALID_TAG');
const budget = Number(options['max-usd'] ?? 0.15);
if (!Number.isFinite(budget) || budget <= 0 || budget > 0.15) throw Error('INVALID_BUDGET');
const output = path.join(base, tag);
const relative = path.relative(root, output);
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_EXTERNAL');
fs.mkdirSync(output, { recursive: true });
const moduleRoot = path.resolve(options['module-root'] ?? path.join(root, '.test-build/src'));
const jsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
const snapshots = jsonl(path.join(base, 'snapshots-private.jsonl'));
const predictions = jsonl(path.join(base, 'classifier-predictions-v2.0.3.jsonl'));
const reference = new Map(jsonl(path.join(base, 'reference-final-agent.jsonl')).map(r => [r.snapshot_id, r]));
const bySnapshot = new Map(snapshots.map(s => [s.id, s]));
const hash = value => createHash('sha256').update(value).digest('hex');
const selected = ['facebook', 'threads'].flatMap(platform => predictions.filter(p => p.classification === 'SUITABLE'
  && p.assessment_status === 'ASSESSED' && bySnapshot.get(p.snapshot_id)?.platform === platform)
  .sort((a, b) => hash('verifier-ablation-v1:' + a.snapshot_id).localeCompare(hash('verifier-ablation-v1:' + b.snapshot_id))).slice(0, 16));
if (selected.length !== 32) throw Error('EXPECTED_32_CANDIDATES');
const sourceManifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
const { campaignVersion } = await import(pathToFileURL(path.join(moduleRoot, 'domain/campaign-plan.js')).href);
const { version: priorVersion, created_at, ...criteria } = sourceManifest.campaign;
const campaignCriteria = { ...criteria, filter_version: 'conversation-opportunity-v2.0.3' };
const campaign = { ...campaignCriteria, version: campaignVersion(campaignCriteria), created_at };
if (selected.some(p => p.campaign_version !== campaign.version)) throw Error('CAMPAIGN_VERSION_MISMATCH');
const manifest = { purpose: 'HISTORICAL_ACCEPTED_CANDIDATE_ABLATION_NOT_FRESH_HOLDOUT', method: 'fixed SHA256 order separately per platform',
  selected_ids: selected.map(p => p.snapshot_id), input_sha256: hash(JSON.stringify(selected.map(p => bySnapshot.get(p.snapshot_id)))),
  filter_version: campaign.filter_version, reference: 'AI_REFERENCE_NOT_HUMAN_GOLD', max_combined_usd: budget };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
const { createGeminiGateway } = await import(pathToFileURL(path.join(moduleRoot, 'infrastructure/llm/gemini-gateway.js')).href);
const { verifyTentativeOpportunities } = await import(pathToFileURL(path.join(moduleRoot, 'application/opportunity-verifier.js')).href);
const prices = {
  'gemini-3.5-flash-lite': { input_per_million: 0.30, output_per_million: 2.50, cached_input_per_million: 0.03 },
  'gemini-3.8-flash': { input_per_million: 0.75, output_per_million: 3.75, cached_input_per_million: 0.075 },
  'gemini-2.5-flash': { input_per_million: 0.30, output_per_million: 2.50, cached_input_per_million: 0.03 },
};
const models = options.models ? options.models.split(',') : ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
if (models.some(model => !Object.hasOwn(prices, model))) throw Error('UNPRICED_MODEL');
const reports = {};
for (const model of models) {
  const gateway = createGeminiGateway({ directory: path.join(output, 'model'), budgetUsd: budget, model,
    maxAttempts: Number(options['max-attempts'] ?? 2),
    price: { ...prices[model], observed_at: '2026-10-30', source: 'https://ai.google.dev/gemini-api/docs/pricing' } });
  const allDecisions = [], allReviews = [], allFailures = [];
  for (let offset = 0; offset < selected.length; offset += 8) {
    const candidates = selected.slice(offset, offset + 8);
    const result = await verifyTentativeOpportunities(campaign, candidates.map(p => bySnapshot.get(p.snapshot_id)), candidates, gateway,
      { cacheNamespace: 'verifier-ablation-v1', maxBatchSize: 8 });
    allDecisions.push(...result.decisions); allReviews.push(...result.reviews); allFailures.push(...result.failures);
    console.log(JSON.stringify({ event: 'verifier_ablation_progress', model, complete: allDecisions.length,
      known_cost_total: gateway.summary().measured_cost_usd, unknown_upper_total: gateway.summary().unmetered_cost_upper_usd }));
  }
  fs.writeFileSync(path.join(output, model + '-reviews-private.jsonl'), allReviews.map(r => JSON.stringify(r)).join('\n') + '\n');
  const metrics = {};
  for (const platform of ['facebook', 'threads']) {
    const rows = allDecisions.filter(d => bySnapshot.get(d.snapshot_id)?.platform === platform);
    let initialTP = 0, initialFP = 0, retainedTP = 0, retainedFP = 0, rejectedFP = 0, newFN = 0, pendingTP = 0, pendingFP = 0;
    for (const d of rows) {
      const positive = reference.get(d.snapshot_id).final_label === 'SUITABLE';
      if (positive) initialTP++; else initialFP++;
      if (d.assessment_status !== 'ASSESSED') { if (positive) pendingTP++; else pendingFP++; }
      else if (d.classification === 'SUITABLE') { if (positive) retainedTP++; else retainedFP++; }
      else { if (positive) newFN++; else rejectedFP++; }
    }
    metrics[platform] = { n: rows.length, initialTP, initialFP, retainedTP, retainedFP, rejectedFP, newFN, pendingTP, pendingFP,
      precision_after: retainedTP + retainedFP ? retainedTP / (retainedTP + retainedFP) : null,
      retained_true_positive_rate: initialTP ? retainedTP / initialTP : null,
      acceptance_survival: (retainedTP + retainedFP) / rows.length };
  }
  const ledger = jsonl(path.join(output, 'model/model-ledger.jsonl'));
  const starts = new Map(ledger.filter(e => e.type === 'START' && e.model === model).map(e => [e.invocation_id, e]));
  const finishes = new Map(ledger.filter(e => e.type === 'FINISH' && starts.has(e.invocation_id)).map(e => [e.invocation_id, e]));
  const usage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cached_input_tokens: 0 };
  for (const e of finishes.values()) for (const key of Object.keys(usage)) usage[key] += e.result?.usage?.[key] ?? 0;
  reports[model] = { metrics, request_attempts: starts.size, failures: allFailures, usage,
    measured_cost_usd: [...finishes.values()].reduce((s, e) => s + (e.cost_usd ?? 0), 0),
    unmetered_cost_upper_usd: [...finishes.values()].reduce((s, e) => s + e.unmetered_cost_upper_usd, 0)
      + [...starts.values()].filter(e => !finishes.has(e.invocation_id)).reduce((s, e) => s + e.reserved_usd, 0),
    combined_ledger: gateway.summary() };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ manifest, reports }, null, 2));
  console.log(JSON.stringify({ event: 'verifier_ablation_model_finished', model, ...reports[model] }));
}
