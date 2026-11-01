#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditOpportunityExport } from './audit-opportunity-export-v2.mjs';
import { blindSnapshot } from './sample-live-v2.mjs';

const ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const VERSION = 'opportunity-delivery-v2.0.0';
const PROVENANCE = 'model_assessed_not_individually_human_verified';
const RANKING = 'Frozen conversations array from conversation-store.results(context,{ranked:true}); preserve deployed categorical tuple and decision-rowid descending tie order; no reranking from reference labels.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(normalize(value));
function normalize(value) { return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)])) : value; }
const rootKey = value => stable([value.platform, value.root_post_id]);
const privateWrite = (file, value) => fs.writeFileSync(file, value, { flag: 'wx', flush: true, mode: 0o600 });
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
function unwrap(input) { const data = Array.isArray(input?.snapshots) ? input : input?.opportunity; if (!data || !Array.isArray(data.conversations)) throw Error('PIPELINE_EXPORT_REQUIRED'); return data; }
function exposureSet(records) {
  if (!Array.isArray(records)) throw Error('EXPOSURE_RECORDS_INVALID');
  const keys = new Set();
  for (const row of records) {
    const id = row?.root_post_id ?? row?.post_id;
    if (!['facebook', 'threads'].includes(row?.platform) || typeof id !== 'string' || !id.trim() || (row.root_post_id !== undefined && row.post_id !== undefined && row.root_post_id !== row.post_id)) throw Error('EXPOSURE_ID_INVALID');
    keys.add(rootKey({ platform: row.platform, root_post_id: id }));
  }
  return keys;
}
function safeCost(cost) {
  if (!cost || !['measured_cost_usd', 'unmetered_cost_upper_usd', 'reserved_usd'].every(k => typeof cost[k] === 'number' && Number.isFinite(cost[k]) && cost[k] >= 0)) throw Error('COST_SNAPSHOT_REQUIRED');
  const result = Object.fromEntries(['model', 'budget_usd', 'measured_cost_usd', 'unmetered_cost_upper_usd', 'reserved_usd', 'remaining_usd', 'billable_attempts', 'cache_hits', 'cost_basis'].filter(k => cost[k] !== undefined).map(k => [k, cost[k]]));
  for (const key of ['models', 'components']) if (Array.isArray(cost[key])) result[key] = cost[key].map(safeCost);
  return result;
}
function selectedCounts(views) {
  return { raw: views.length, comments: views.reduce((n, view) => n + view.snapshot.comments.length, 0), suitable: views.length, notYet: 0, unrelated: 0, pending: 0, failed: 0 };
}

/** Pure selector. target is test/library configuration; the delivery CLI fixes it to1000. */
export function selectOpportunityDelivery(input, options = {}) {
  const data = unwrap(input), target = options.target ?? 1000;
  if (!Number.isSafeInteger(target) || target < 1 || target > 100000) throw Error('DELIVERY_TARGET_INVALID');
  const minThreads = Math.ceil(target * 0.7 - 1e-9), maxThreads = Math.floor(target * 0.8 + 1e-9), minFacebook = target - maxThreads;
  const audit = auditOpportunityExport(data, { maxExamples: 0 }), cost = safeCost(data.cost);
  const pool = data.conversations.map((view, index) => ({ ...view, source_rank_index: index + 1 })).filter(view => !view.stale && view.decision.assessment_status === 'ASSESSED' && view.decision.classification === 'SUITABLE');
  const groups = Object.fromEntries(['facebook', 'threads'].map(platform => [platform, pool.filter(view => view.snapshot.platform === platform)]));
  const lower = Math.max(minThreads, target - groups.facebook.length), upper = Math.min(maxThreads, groups.threads.length);
  const status = audit.status === 'FAIL' ? 'INVALID_POOL' : lower > upper ? 'SHORTFALL' : 'READY';
  const chosenThreads = status === 'READY' ? upper : null, chosenFacebook = chosenThreads === null ? null : target - chosenThreads;
  const chosen = status === 'READY' ? [...groups.threads.slice(0, chosenThreads), ...groups.facebook.slice(0, chosenFacebook)].sort((a, b) => a.source_rank_index - b.source_rank_index) : [];
  const selectedKeys = new Set(chosen.map(view => rootKey(view.snapshot)));
  const exposure = exposureSet(options.exposureRecords ?? []), exposureProvided = options.exposureRecords !== undefined;
  const topRows = [], topPredictions = [];
  for (const platform of ['facebook', 'threads']) for (const [index, view] of (status === 'INVALID_POOL' ? [] : groups[platform].slice(0, 20)).entries()) {
    const blinded = blindSnapshot(view.snapshot), digest = hash(stable(blinded));
    const identity = { snapshot_id: blinded.id, sample_id: 'TOP20-' + hash(stable([platform, blinded.root_post_id, blinded.id])).slice(0, 24), platform,
      rank: index + 1, source_rank_index: view.source_rank_index, blinded_snapshot_sha256: digest, prior_exposure: exposureProvided ? exposure.has(rootKey(blinded)) : null };
    topRows.push({ ...blinded, ...identity, as_of: blinded.observed_at }); topPredictions.push({ ...view.decision, ...identity });
  }
  const manifest = { schema_version: '1.0.0', delivery_version: VERSION, created_at: options.createdAt ?? new Date().toISOString(), status, label_provenance: PROVENANCE,
    ranking_contract: RANKING, source_watermark: data.watermark, source_export_sha256: hash(stable(input)), source_hash_basis: 'CANONICAL_JSON_OBJECT',
    target_total: target, required_mix: { min_threads: minThreads, max_threads: maxThreads, preferred_threads: maxThreads, min_facebook: minFacebook },
    available: { facebook: groups.facebook.length, threads: groups.threads.length, total_suitable: pool.length, population_roots: data.snapshots.length },
    shortfall: { total: Math.max(0, target - pool.length), minimum_threads: Math.max(0, minThreads - groups.threads.length), minimum_facebook: Math.max(0, minFacebook - groups.facebook.length) },
    selected_counts: { total: chosen.length, facebook: chosenFacebook ?? 0, threads: chosenThreads ?? 0 },
    selection_identity_sha256: hash(stable(chosen.map(view => [view.snapshot.platform, view.snapshot.root_post_id, view.snapshot.id, view.decision.id]))),
    audit: { status: audit.status, finding_totals: audit.findings.totals, checks: audit.findings.checks.map(({ code, severity, count }) => ({ code, severity, count })) },
    campaign_version: data.campaign.version, filter_version: data.campaign.filter_version, runtime_limits: data.runtime_limits ?? null,
    cost_scope: 'ENTIRE_CAMPAIGN_LEDGER_INCLUDING_UNSELECTED_ROOTS_AND_RETRIES', cost_snapshot: cost, cost_captured_at: data.cost_captured_at ?? null,
    model_cost_upper_usd: cost.measured_cost_usd + cost.unmetered_cost_upper_usd + cost.reserved_usd,
    evidence: { comments: chosen.reduce((n, view) => n + view.snapshot.comments.length, 0),
      suitable_with_comment_evidence: chosen.filter(view => view.snapshot.spans.some(span => span.entity_type === 'COMMENT' && view.decision.evidence_ids.includes(span.id))).length,
      comment_action_targets: chosen.filter(view => view.decision.action_target?.type === 'COMMENT').length,
      coverage: Object.fromEntries([...new Set(chosen.map(view => view.snapshot.coverage.status))].map(status => [status, chosen.filter(view => view.snapshot.coverage.status === status).length])) },
    top20_diagnostic: { purpose: 'DESCRIPTIVE_DEPLOYED_RANKING_NOT_PROBABILITY_SAMPLE_OR_RELEASE_GATE', ranking_contract: RANKING,
      exposure_checked: exposureProvided, exposure_set_sha256: exposureProvided ? hash(stable([...exposure].sort())) : null,
      by_platform: Object.fromEntries(['facebook', 'threads'].map(platform => [platform, { count: topRows.filter(row => row.platform === platform).length,
        prior_exposed: exposureProvided ? topRows.filter(row => row.platform === platform && row.prior_exposure).length : null }])) },
    limitations: ['Labels are model-assessed, not individually human-verified.', 'Preserve the full pool; selected1000 does not replace raw/research/pending evidence.',
      'Whole-campaign costs are token-usage estimates, not an invoice. Unknown usage and open reservations remain in the upper bound.'] };
  const selected = status === 'READY' ? { campaign: data.campaign, watermark: data.watermark, cost, cost_captured_at: data.cost_captured_at,
    runtime_limits: data.runtime_limits, label_provenance: PROVENANCE,
    progress: { ...data.progress, preview: [], counts: selectedCounts(chosen), byPlatform: { facebook: selectedCounts(chosen.filter(v => v.snapshot.platform === 'facebook')), threads: selectedCounts(chosen.filter(v => v.snapshot.platform === 'threads')) } },
    conversations: chosen.map(({ source_rank_index: _rank, ...view }) => view), snapshots: data.snapshots.filter(s => selectedKeys.has(rootKey(s))),
    decisions: data.decisions.filter(d => selectedKeys.has(rootKey(d))), decision_snapshots: (data.decision_snapshots ?? []).filter(s => selectedKeys.has(rootKey(s))) } : null;
  return { status, selected, manifest, top20: { blindedRows: topRows, predictions: topPredictions } };
}

function destinationOutsideRepo(destination) {
  const resolved = path.resolve(destination); let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved)), relative = path.relative(ROOT, canonical);
  if (!relative || !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (fs.existsSync(resolved) && (!fs.statSync(resolved).isDirectory() || fs.readdirSync(resolved).length)) throw Error('DELIVERY_OUTPUT_ALREADY_EXISTS');
  return resolved;
}
export async function writeOpportunityDelivery(options) {
  if (!options?.input || !options?.output) throw Error('INPUT_AND_OUTPUT_REQUIRED');
  const output = destinationOutsideRepo(options.output), source = path.resolve(options.input), bytes = fs.readFileSync(source);
  let input; try { input = JSON.parse(bytes.toString('utf8')); } catch { throw Error('INPUT_JSON_INVALID'); }
  let exposureRecords, exposureInput = null;
  if (options.exposureIds) {
    const exposureBytes = fs.readFileSync(path.resolve(options.exposureIds));
    try { exposureRecords = exposureBytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim()).map(JSON.parse); } catch { throw Error('EXPOSURE_JSONL_INVALID'); }
    exposureInput = { sha256: hash(exposureBytes), bytes: exposureBytes.length };
  }
  const result = selectOpportunityDelivery(input, { ...(options.target === undefined ? {} : { target: options.target }), ...(exposureRecords ? { exposureRecords } : {}) });
  const manifest = { ...result.manifest, source_export_sha256: hash(bytes), source_hash_basis: 'EXACT_INPUT_BYTES', source_input: source, exposure_input: exposureInput, files: {} };
  let workbook;
  if (result.status === 'READY') {
    const module = path.resolve(options.moduleRoot ?? path.join(ROOT, 'dist'), 'infrastructure', 'export', 'opportunity-workbook.js');
    if (!fs.existsSync(module)) throw Error('WORKBOOK_EXPORT_MODULE_UNAVAILABLE');
    workbook = (await import(pathToFileURL(module).href)).exportOpportunityWorkbook;
  }
  fs.mkdirSync(output, { recursive: true }); const lock = path.join(output, '.delivery.lock'); let owned = false;
  try {
    privateWrite(lock, JSON.stringify({ pid: process.pid })); owned = true;
    if (fs.readdirSync(output).some(name => name !== '.delivery.lock')) throw Error('DELIVERY_OUTPUT_ALREADY_EXISTS');
    const save = (name, content) => { privateWrite(path.join(output, name), content); manifest.files[name] = { sha256: hash(content), bytes: Buffer.byteLength(content) }; };
    if (result.status === 'READY') {
      save('full-pool.json', bytes); save('selected-opportunities.json', JSON.stringify(result.selected, null, 2) + '\n');
      save('top20-blinded-reference.jsonl', jsonl(result.top20.blindedRows)); save('top20-predictions.jsonl', jsonl(result.top20.predictions));
      const file = path.join(output, 'selected-opportunities.xlsx'); await workbook(file, result.selected, 'SUITABLE');
      const workbookBytes = fs.readFileSync(file); manifest.files['selected-opportunities.xlsx'] = { sha256: hash(workbookBytes), bytes: workbookBytes.length };
    }
    privateWrite(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { event: 'opportunity_delivery_prepared', status: result.status, selected_counts: manifest.selected_counts, available: manifest.available,
      shortfall: manifest.shortfall, label_provenance: PROVENANCE, model_cost_upper_usd: manifest.model_cost_upper_usd, source_export_sha256: hash(bytes) };
  } finally { if (owned) fs.unlinkSync(lock); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) { if (!['--input', '--output', '--module-root', '--exposure-ids'].includes(process.argv[i]) || process.argv[i + 1] === undefined || Object.hasOwn(args, process.argv[i])) throw Error('CLI_ARGUMENT_INVALID'); args[process.argv[i]] = process.argv[i + 1]; }
    const result = await writeOpportunityDelivery({ input: args['--input'], output: args['--output'], moduleRoot: args['--module-root'], exposureIds: args['--exposure-ids'] });
    console.log(JSON.stringify(result)); if (result.status !== 'READY') process.exitCode = 2;
  } catch (error) { console.error(JSON.stringify({ error_code: /^[A-Z][A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'DELIVERY_FAILED' })); process.exitCode = 1; }
}
