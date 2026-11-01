#!/usr/bin/env node
/** Offline evaluation of the frozen café benchmark. No network or model calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REFERENCE_STATUS = 'AI_ADJUDICATED_NOT_HUMAN_VALIDATED';
const DECISIONS = ['ACCEPT', 'REJECT', 'UNCERTAIN'];
const PREDICTION_COLUMNS = [...DECISIONS, 'MISSING'];
const EXPECTED = { facebook: { raw: 1156, evaluation: 150 }, threads: { raw: 1004, evaluation: 150 } };
const REPO_ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const originalKey = (row) => String(row.text_original ?? row.text).normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);

function fail(code) { const error = new Error(code); error.safeCode = code; throw error; }
function readJsonl(file, optional = false) {
  if (optional && !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { fail(`INVALID_JSONL_${path.basename(file)}_LINE_${index + 1}`); }
  });
}
function readJson(file, optional = false) {
  if (optional && !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function uniqueMap(rows, name) {
  const map = new Map();
  for (const row of rows) {
    if (!row.id || map.has(row.id)) fail(`INVALID_OR_DUPLICATE_ID_${name}`);
    map.set(row.id, row);
  }
  return map;
}

/** Wilson binomial interval, not an uncertainty interval for correctness of AI labels. */
function wilson95(successes, total) {
  if (!total) return null;
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || successes > total) fail('INVALID_WILSON_COUNTS');
  const z = 1.959963984540054;
  const p = successes / total;
  const divisor = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / divisor;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin), level: 0.95, method: 'Wilson binomial; no finite-population or cluster correction' };
}

function evaluateReference(references, predictions, expectedSampleCount = references.length) {
  const matrix = Object.fromEntries(DECISIONS.map((label) => [label, Object.fromEntries(PREDICTION_COLUMNS.map((column) => [column, 0]))]));
  let valid = 0;
  for (const ref of references) {
    if (!DECISIONS.includes(ref.decision)) fail('INVALID_REFERENCE_DECISION');
    const pred = predictions.get(ref.id)?.decision ?? 'MISSING';
    if (!PREDICTION_COLUMNS.includes(pred)) fail('INVALID_PREDICTION_DECISION');
    matrix[ref.decision][pred] += 1;
    if (pred !== 'MISSING') valid += 1;
  }
  const positives = sum(Object.values(matrix.ACCEPT), (n) => n);
  const negatives = sum(Object.values(matrix.REJECT), (n) => n);
  const uncertain = sum(Object.values(matrix.UNCERTAIN), (n) => n);
  const tp = matrix.ACCEPT.ACCEPT;
  const fp = matrix.REJECT.ACCEPT;
  const fn = matrix.ACCEPT.REJECT + matrix.ACCEPT.UNCERTAIN + matrix.ACCEPT.MISSING;
  // A wholly unexecuted model is blocked, not a zero-recall classifier.
  const canMeasure = valid > 0;
  const precision = canMeasure && tp + fp ? tp / (tp + fp) : null;
  const recall = canMeasure && tp + fn ? tp / (tp + fn) : null;
  return {
    reference_status: REFERENCE_STATUS,
    expected_sample_count: expectedSampleCount, reference_count: references.length,
    reference_complete: references.length === expectedSampleCount,
    missing_reference_count: Math.max(0, expectedSampleCount - references.length),
    valid_prediction_count: valid, missing_prediction_count: references.length - valid,
    prediction_coverage: references.length ? valid / references.length : null,
    evaluation_status: !references.length ? 'REFERENCE_PENDING' : !canMeasure ? 'BLOCKED_NO_VALID_PREDICTIONS' : valid < references.length ? 'PARTIAL_MODEL_COVERAGE' : 'COMPLETE_AGAINST_AI_REFERENCE',
    confusion_matrix: matrix, confusion_rows: DECISIONS, confusion_columns: PREDICTION_COLUMNS,
    true_positive: tp, false_positive: fp, false_negative_including_abstentions_and_missing: fn,
    precision, recall,
    precision_wilson95: precision === null ? null : wilson95(tp, tp + fp),
    recall_wilson95: recall === null ? null : wilson95(tp, tp + fn),
    reference_positive: positives, reference_negative: negatives, reference_uncertain: uncertain,
    accepted_reference_uncertain: matrix.UNCERTAIN.ACCEPT,
    reference_positive_raw_prevalence: references.length ? positives / references.length : null,
    reference_positive_raw_prevalence_wilson95: references.length ? wilson95(positives, references.length) : null,
    reference_positive_prevalence_unknown_bounds: references.length ? { lower: positives / references.length, upper: (positives + uncertain) / references.length } : null,
    reference_positive_known_prevalence: positives + negatives ? positives / (positives + negatives) : null,
    definitions: {
      precision: 'TP/(TP+FP), excluding reference UNCERTAIN from both terms',
      recall: 'TP/(TP+FN); model UNCERTAIN or MISSING on reference ACCEPT counts as FN; null when no valid sample prediction exists',
      prevalence: 'Reference ACCEPT / all reference rows, including UNCERTAIN in denominator; this is confirmed-positive prevalence, not a claim that unknowns are negative',
      intervals: 'Sampling intervals conditional on fixed AI reference labels; do not cover annotation errors or unseen social-platform posts',
    },
  };
}

function aggregatePopulation(records, predictions) {
  const counts = { ACCEPT: 0, REJECT: 0, UNCERTAIN: 0, MISSING: 0 };
  const clusters = new Map();
  for (const record of records) {
    const decision = predictions.get(record.id)?.decision ?? 'MISSING';
    counts[decision] += 1;
    const key = originalKey(record);
    const cluster = clusters.get(key) ?? [];
    cluster.push({ id: record.id, decision });
    clusters.set(key, cluster);
  }
  let anyAccepted = 0;
  let strictAccepted = 0;
  let possiblyStrictAccepted = 0;
  let mixed = 0;
  let partialClusters = 0;
  const mixedClusterIds = [];
  for (const [key, members] of clusters) {
    const observed = new Set(members.filter((row) => row.decision !== 'MISSING').map((row) => row.decision));
    if (observed.has('ACCEPT')) anyAccepted += 1;
    if (members.every((row) => row.decision === 'ACCEPT')) strictAccepted += 1;
    if (members.every((row) => ['ACCEPT', 'MISSING'].includes(row.decision))) possiblyStrictAccepted += 1;
    if (members.some((row) => row.decision === 'MISSING')) partialClusters += 1;
    if (observed.size > 1) {
      mixed += 1;
      mixedClusterIds.push({ original_text_hash: sha(key), ids: members.map((row) => row.id), observed_decisions: [...observed].sort() });
    }
  }
  const valid = records.length - counts.MISSING;
  const complete = Boolean(records.length) && !counts.MISSING;
  return {
    raw_records: records.length, unique_ids: new Set(records.map((row) => row.id)).size,
    exact_original_text_unique: new Set(records.map((row) => row.text_original ?? row.text)).size,
    normalized_original_text_unique: clusters.size,
    normalized_original_text_duplicate_extra: records.length - clusters.size,
    original_text_dedup_policy: 'NFC, lowercase, whitespace collapse on ORIGINAL text; no redacted-text merging, no semantic near-dedup',
    valid_predictions: valid, pending_predictions: counts.MISSING, complete,
    accepted: counts.ACCEPT, rejected: counts.REJECT, uncertain: counts.UNCERTAIN,
    acceptance_yield: complete ? counts.ACCEPT / records.length : null,
    observed_acceptance_bounds: records.length ? { lower: counts.ACCEPT / records.length, upper: (counts.ACCEPT + counts.MISSING) / records.length } : null,
    bounds_meaning: 'Only unprocessed/invalid predictions can vary; model UNCERTAIN is not counted as accepted',
    deduplicated: {
      unique_original_texts: clusters.size,
      accepted_any_member: anyAccepted,
      accepted_all_members: strictAccepted,
      mixed_prediction_clusters: mixed,
      partially_classified_clusters: partialClusters,
      strict_acceptance_yield: complete ? strictAccepted / clusters.size : null,
      any_member_acceptance_yield: complete ? anyAccepted / clusters.size : null,
      strict_observed_bounds: clusters.size ? { lower: strictAccepted / clusters.size, upper: possiblyStrictAccepted / clusters.size } : null,
      mixed_cluster_members: mixedClusterIds,
      policy: 'Primary strict yield requires every duplicate member to be ACCEPT; any-member yield is shown separately and mixed decisions are flagged',
    },
  };
}

function recomputeUsageCost(usage, rates) {
  if (!usage || !Number.isFinite(usage.promptTokenCount)) return null;
  const cached = Math.min(usage.promptTokenCount, usage.cachedContentTokenCount ?? 0);
  const output = Math.max((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0), (usage.totalTokenCount ?? usage.promptTokenCount) - usage.promptTokenCount);
  return ((usage.promptTokenCount - cached) * rates.input + cached * rates.cached_input + output * rates.output) / 1e6;
}

function aggregateCosts(requests, starts, rates, population) {
  const settled = new Set(requests.map((row) => row.attempt_id).filter(Boolean));
  const unsettled = starts.filter((row) => !settled.has(row.attempt_id));
  const metered = requests.filter((row) => row.usageMetadata && Number.isFinite(row.usageMetadata.promptTokenCount));
  const recomputed = sum(metered, (row) => recomputeUsageCost(row.usageMetadata, rates));
  const upperUnknown = sum(requests, (row) => row.unmetered_cost_upper_bound_usd ?? 0)
    + sum(unsettled, (row) => row.cost_upper_bound_usd ?? 0);
  const known = metered.length ? recomputed : null;
  const comparable = population.complete && population.accepted > 0 && known !== null && upperUnknown === 0;
  return {
    attempts: requests.length, usage_returned_attempts: metered.length,
    no_usage_returned_attempts: requests.length - metered.length, unsettled_started_attempts: unsettled.length,
    prompt_tokens: sum(metered, (row) => row.usageMetadata.promptTokenCount),
    cached_input_tokens: sum(metered, (row) => row.usageMetadata.cachedContentTokenCount ?? 0),
    response_tokens: sum(metered, (row) => row.usageMetadata.candidatesTokenCount ?? 0),
    thinking_tokens: sum(metered, (row) => row.usageMetadata.thoughtsTokenCount ?? 0),
    measured_token_cost_usd: known,
    recorded_attempt_cost_usd: sum(requests, (row) => row.cost_usd ?? 0),
    unmetered_cost_upper_bound_usd: upperUnknown,
    usage_price_reconciliation_errors: metered.filter((row) => row.cost_usd === null || Math.abs(row.cost_usd - recomputeUsageCost(row.usageMetadata, rates)) > 1e-9).length,
    cost_per_1000_accepted_usd: comparable ? known / population.accepted * 1000 : null,
    cost_per_1000_strict_deduplicated_accepted_usd: comparable && population.deduplicated.accepted_all_members ? known / population.deduplicated.accepted_all_members * 1000 : null,
    cost_status: known === null ? 'NO_TOKEN_USAGE_RETURNED' : upperUnknown ? 'PARTLY_UNMETERED' : 'MEASURED_TOKENS_PRICED_AT_CONFIGURED_RATES',
    scope: 'All attempts in this run, including failed/invalid generations and retries; excludes annotation work, other run directories, crawl, infrastructure and invoice credits/taxes',
  };
}

function blockingReason(summary, requests, validCount) {
  if (validCount) return null;
  if (summary?.stop_reason) return summary.stop_reason;
  if (requests.some((row) => row.http_status === 402)) return 'PAYMENT_REQUIRED';
  if (requests.some((row) => row.http_status === 401)) return 'AUTHENTICATION_FAILURE';
  if (requests.some((row) => row.http_status === 403)) return 'AUTHORIZATION_FAILURE';
  return requests.length ? 'NO_VALID_PREDICTIONS' : 'MODEL_NOT_RUN';
}

function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--benchmark', '--run'].includes(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith('--')) fail('USAGE_BENCHMARK_AND_RUN_REQUIRED');
    args[argv[index].slice(2)] = path.resolve(argv[index + 1]);
  }
  if (!args.benchmark || !args.run) fail('USAGE_BENCHMARK_AND_RUN_REQUIRED');
  args.benchmark = fs.realpathSync(args.benchmark);
  const relative = path.relative(REPO_ROOT, args.benchmark);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('BENCHMARK_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const records = readJsonl(path.join(args.benchmark, 'records-private.jsonl'));
  const publicRecords = readJsonl(path.join(args.benchmark, 'population.jsonl'));
  const references = readJsonl(path.join(args.benchmark, 'reference-final.jsonl'), true);
  const privateById = uniqueMap(records, 'POPULATION');
  const publicById = uniqueMap(publicRecords, 'MODEL_INPUT');
  uniqueMap(references, 'REFERENCE');
  if (privateById.size !== publicById.size || records.some((row) => !publicById.has(row.id))) fail('POPULATION_INPUT_ID_MISMATCH');
  if (references.some((row) => !privateById.has(row.id) || privateById.get(row.id).split !== 'evaluation')) fail('REFERENCE_OUTSIDE_EVALUATION_SPLIT');
  const manifest = readJson(path.join(args.run, 'manifest.json'));
  const runSummary = readJson(path.join(args.run, 'summary.json'), true);
  const requests = readJsonl(path.join(args.run, 'requests.jsonl'), true);
  const starts = readJsonl(path.join(args.run, 'attempts-started.jsonl'), true);
  const rows = readJsonl(path.join(args.run, 'predictions.jsonl'), true);
  const predictions = new Map();
  let ignored = 0;
  let repeatedConflicts = 0;
  for (const row of rows) {
    const input = publicById.get(row.id);
    const evidenceOkay = input && typeof row.evidence === 'string' && [...row.evidence].length <= 180
      && (row.evidence.trim() || !input.text.trim()) && input.text.includes(row.evidence);
    const targetIntents = ['REQUEST_RECOMMENDATION', 'CAFE_EXPERIENCE', 'WORK_STUDY_CAFE', 'DATING_PLACE'];
    const intentsOkay = Array.isArray(row.intents) && row.intents.every((intent) => targetIntents.includes(intent))
      && new Set(row.intents).size === row.intents.length;
    const coherent = intentsOkay && (
      (row.decision === 'ACCEPT' && row.intents.length > 0 && ['TARGET_REQUEST', 'TARGET_EXPERIENCE', 'TARGET_WORK_STUDY', 'TARGET_DATING'].includes(row.reason_code))
      || (row.decision === 'REJECT' && ['RECRUITMENT_JOB', 'BUSINESS_TRANSFER', 'COMMERCIAL_PROMOTION', 'SURVEY_EVENT', 'OTHER_TOPIC'].includes(row.reason_code))
      || (row.decision === 'UNCERTAIN' && ['INSUFFICIENT_CONTEXT', 'MIXED_AMBIGUOUS'].includes(row.reason_code))
    );
    if (!input || row.status !== 'valid' || row.evidence_valid !== true || !evidenceOkay
      || !coherent || row.model !== manifest.model
      || row.prompt_hash !== manifest.prompt_hash || row.record_hash !== sha(JSON.stringify(input))) { ignored += 1; continue; }
    if (predictions.has(row.id) && predictions.get(row.id).decision !== row.decision) repeatedConflicts += 1;
    predictions.set(row.id, row);
  }
  const platforms = {};
  for (const platform of [...new Set(records.map((row) => row.platform))].sort()) {
    const populationRows = records.filter((row) => row.platform === platform);
    const referenceRows = references.filter((row) => privateById.get(row.id).platform === platform);
    const sampleCount = populationRows.filter((row) => row.split === 'evaluation').length;
    const population = aggregatePopulation(populationRows, predictions);
    platforms[platform] = {
      expected_counts: EXPECTED[platform] ?? null,
      source_counts_match_expected: EXPECTED[platform] ? populationRows.length === EXPECTED[platform].raw && sampleCount === EXPECTED[platform].evaluation : null,
      population,
      evaluation: evaluateReference(referenceRows, predictions, sampleCount),
      cost: aggregateCosts(requests.filter((row) => row.platform === platform), starts.filter((row) => row.platform === platform), manifest.rates_usd_per_million, population),
    };
  }
  const populationOverall = aggregatePopulation(records.map((row) => ({ ...row, text_original: `${row.platform}\u0000${row.text_original ?? row.text}` })), predictions);
  const costsOverall = aggregateCosts(requests, starts, manifest.rates_usd_per_million, populationOverall);
  const metrics = {
    schema_version: '1.0.0', generated_at: new Date().toISOString(), reference_status: REFERENCE_STATUS,
    model: manifest.model, model_versions_observed: [...new Set(rows.map((row) => row.modelVersion).filter(Boolean))],
    prompt_hash: manifest.prompt_hash, rates_usd_per_million: manifest.rates_usd_per_million,
    reference_sha256: references.length ? sha(fs.readFileSync(path.join(args.benchmark, 'reference-final.jsonl'))) : null,
    reference_human_validated_count: references.filter((row) => row.human_validated === true).length,
    benchmark_directory: args.benchmark, run_directory: args.run,
    blocked_reason: blockingReason(runSummary, requests, predictions.size),
    ignored_invalid_or_stale_prediction_rows: ignored, repeated_prediction_decision_conflicts: repeatedConflicts,
    overall_cost: costsOverall, platforms,
    interpretation: 'Model acceptance is not independently verified true-positive yield. Precision/recall are agreement with an AI-adjudicated reference; no human-validated production-quality claim. Recall covers collected candidates only. Missing model output is not a negative decision.',
  };
  const disagreements = [];
  for (const reference of references) {
    const prediction = predictions.get(reference.id);
    if (!prediction || prediction.decision === reference.decision) continue;
    const record = privateById.get(reference.id);
    disagreements.push({ id: reference.id, platform: record.platform, reference, prediction,
      text: record.text, text_original: record.text_original, url: record.url, query: record.query,
      cluster_id: record.cluster_id, reference_status: REFERENCE_STATUS });
  }
  fs.writeFileSync(path.join(args.benchmark, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(args.benchmark, 'disagreements-model.jsonl'), disagreements.map((row) => JSON.stringify(row)).join('\n') + (disagreements.length ? '\n' : ''));
  console.log(JSON.stringify({ event: 'evaluation_saved', reference_status: REFERENCE_STATUS,
    raw_records: records.length, reference_records: references.length, valid_model_records: predictions.size,
    blocked_reason: metrics.blocked_reason, measured_token_cost_usd: costsOverall.measured_token_cost_usd,
    disagreement_records: disagreements.length }));
  return metrics;
}

export { wilson95, evaluateReference, aggregatePopulation, aggregateCosts, blockingReason, main };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ event: 'fatal', error_code: error?.safeCode ?? 'UNEXPECTED_LOCAL_ERROR' }));
    process.exitCode = 1;
  }
}
