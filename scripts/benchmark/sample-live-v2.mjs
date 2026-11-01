#!/usr/bin/env node
/** Freeze a label-blind probability sample from a single pipeline export. No network/model calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LIVE_HOLDOUT_SEED = 'csd-conversation-live-v2-holdout-20261030';
const VERSION = 'live-holdout-sampler-v2.1.0';
const PLATFORMS = ['facebook', 'threads'];
const ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)]));
  return value;
}
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, structuredClone(object[key])]));
function requireValue(condition, code) { if (!condition) throw Error(code); }
const text = value => typeof value === 'string' && value.length > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const entityKeys = ['entity_id', 'entity_type', 'root_post_id', 'parent_id', 'text', 'observed_at', 'published_at', 'permalink', 'content_hash'];
const coverageKeys = ['status', 'advertised_count', 'observed_count', 'has_more', 'sort_mode', 'stop_reason', 'pages', 'cursor', 'observed_at'];
const campaignKeys = ['schema_version', 'campaign_id', 'version', 'created_at', 'prompt', 'topic', 'audience', 'needs', 'participation_intents', 'research_intents', 'inclusions', 'exclusions', 'brand_context', 'required_geographies', 'preferred_geographies', 'languages', 'source_priority', 'queries', 'assumptions', 'suitable_target', 'target_scope', 'desired_platform_weights', 'budget', 'watch', 'max_age_days', 'filter_version'];
const decisionKeys = ['id', 'campaign_id', 'campaign_version', 'filter_version', 'snapshot_id', 'classification', 'assessment_status', 'reason_code', 'evidence_ids', 'model', 'intents', 'action_target', 'attributes', 'created_at', 'platform', 'root_post_id', 'snapshot_revision'];
const costKeys = ['model', 'budget_usd', 'measured_cost_usd', 'unmetered_cost_upper_usd', 'reserved_usd', 'remaining_usd', 'billable_attempts', 'cache_hits', 'cost_basis'];

function blindEntity(value, type, rootId) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'ENTITY_INVALID');
  requireValue(text(value.entity_id) && value.entity_type === type && value.root_post_id === rootId && typeof value.text === 'string' && validTime(value.observed_at), 'ENTITY_IDENTITY_INVALID');
  requireValue(value.parent_id === null || text(value.parent_id), 'ENTITY_PARENT_INVALID');
  if (type === 'POST') requireValue(value.entity_id === rootId, 'POST_ROOT_MISMATCH');
  requireValue(Array.isArray(value.media), 'ENTITY_MEDIA_INVALID');
  return { ...pick(value, entityKeys), author: pick(value.author, ['id', 'name', 'role']), source: pick(value.source, ['kind', 'id', 'name', 'url']),
    media: value.media.map(item => pick(item, ['type', 'url'])) };
}
export function blindSnapshot(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'SNAPSHOT_INVALID');
  requireValue(text(value.id) && PLATFORMS.includes(value.platform) && text(value.root_post_id) && Number.isSafeInteger(value.revision) && value.revision >= 1 && validTime(value.observed_at) && text(value.content_hash), 'SNAPSHOT_IDENTITY_INVALID');
  requireValue(Array.isArray(value.comments) && Array.isArray(value.spans) && value.coverage && typeof value.coverage === 'object', 'SNAPSHOT_CONTEXT_INVALID');
  const post = value.post === null ? null : blindEntity(value.post, 'POST', value.root_post_id);
  const comments = value.comments.map(entity => blindEntity(entity, 'COMMENT', value.root_post_id));
  const entities = new Map([...(post ? [post] : []), ...comments].map(entity => [entity.entity_id, entity]));
  requireValue(entities.size === comments.length + (post ? 1 : 0), 'SNAPSHOT_DUPLICATE_ENTITY');
  const spanIds = new Set();
  const spans = value.spans.map(span => {
    const entity = entities.get(span.entity_id);
    requireValue(text(span.id) && !spanIds.has(span.id) && entity && span.entity_type === entity.entity_type && Number.isInteger(span.start) && Number.isInteger(span.end)
      && span.start >= 0 && span.end > span.start && span.end <= entity.text.length && entity.text.slice(span.start, span.end) === span.text, 'SNAPSHOT_EVIDENCE_INVALID');
    spanIds.add(span.id); return pick(span, ['id', 'entity_id', 'entity_type', 'start', 'end', 'text']);
  });
  return { ...pick(value, ['id', 'platform', 'root_post_id', 'revision', 'content_hash', 'observed_at']), post, comments,
    coverage: pick(value.coverage, coverageKeys), spans };
}
function unwrap(input) {
  if (input && Array.isArray(input.snapshots)) return input;
  if (input?.opportunity && Array.isArray(input.opportunity.snapshots)) return input.opportunity;
  throw Error('PIPELINE_EXPORT_REQUIRED');
}
function currentPredictions(data, campaign) {
  const map = new Map();
  const currentViews = Array.isArray(data.conversations);
  const rows = currentViews ? data.conversations.map(view => {
    requireValue(view && view.snapshot?.id === view.decision?.snapshot_id && view.stale !== true, 'CURRENT_VIEW_INVALID');
    return view.decision;
  }) : data.decisions ?? [];
  requireValue(Array.isArray(rows), 'PREDICTIONS_INVALID');
  for (const value of rows) {
    requireValue(value && text(value.snapshot_id), 'PREDICTION_SNAPSHOT_INVALID');
    requireValue(value.campaign_id === campaign.campaign_id && value.campaign_version === campaign.version && value.filter_version === campaign.filter_version, 'PREDICTION_CAMPAIGN_MISMATCH');
    requireValue(['ASSESSED', 'PENDING', 'FAILED'].includes(value.assessment_status) && (value.classification === null || ['SUITABLE', 'NOT_YET', 'UNRELATED'].includes(value.classification)), 'PREDICTION_LABEL_INVALID');
    const prior = map.get(value.snapshot_id);
    if (currentViews) requireValue(!prior, 'DUPLICATE_CURRENT_PREDICTION');
    // History fallback reproduces the store rule: a late technical failure cannot erase an assessed decision.
    if (!prior || value.assessment_status === 'ASSESSED' || prior.assessment_status !== 'ASSESSED') map.set(value.snapshot_id, pick(value, decisionKeys));
  }
  return { rows: map, source: currentViews ? 'CURRENT_EXPORTED_VIEWS' : 'EXACT_SNAPSHOT_HISTORY_REPLAY' };
}

function excludedRoots(records) {
  requireValue(Array.isArray(records), 'EXCLUSION_RECORDS_INVALID');
  const roots = new Set(), unique = [];
  for (const row of records) {
    requireValue(row && typeof row === 'object' && PLATFORMS.includes(row.platform), 'EXCLUSION_PLATFORM_INVALID');
    const id = row.root_post_id ?? row.post_id;
    requireValue(text(id) && id.trim() === id, 'EXCLUSION_ROOT_ID_INVALID');
    requireValue(row.root_post_id === undefined || row.post_id === undefined || row.root_post_id === row.post_id, 'EXCLUSION_ROOT_ID_CONFLICT');
    const key = canonical([row.platform, id]);
    if (!roots.has(key)) { roots.add(key); unique.push({ platform: row.platform, root_post_id: id }); }
  }
  unique.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  return { roots, unique, inputCount: records.length, sha256: sha(canonical(unique)) };
}

/** Pure preparation. Callers may inspect counts without writing any benchmark dataset. */
export function sampleLiveExport(input, options = {}) {
  const data = unwrap(input), seed = options.seed ?? DEFAULT_LIVE_HOLDOUT_SEED;
  const requested = { facebook: options.facebookCount ?? 100, threads: options.threadsCount ?? 200 };
  requireValue(text(seed) && seed.length <= 1000, 'SEED_INVALID');
  requireValue(PLATFORMS.every(platform => Number.isSafeInteger(requested[platform]) && requested[platform] >= 0) && requested.facebook + requested.threads > 0, 'SAMPLE_COUNTS_INVALID');
  const campaign = pick(data.campaign, campaignKeys);
  requireValue(text(campaign.campaign_id) && text(campaign.version) && text(campaign.filter_version), 'CAMPAIGN_VERSION_REQUIRED');
  requireValue(data.watermark && Number.isSafeInteger(data.watermark.journal_sequence) && data.watermark.journal_sequence >= 0 && validTime(data.watermark.captured_at), 'FROZEN_WATERMARK_REQUIRED');
  const inputPopulation = data.snapshots.map(blindSnapshot), roots = new Set(), snapshotIds = new Set();
  requireValue(inputPopulation.length > 0, 'POPULATION_EMPTY');
  for (const snapshot of inputPopulation) {
    const root = canonical([snapshot.platform, snapshot.root_post_id]);
    requireValue(!roots.has(root) && !snapshotIds.has(snapshot.id), 'DUPLICATE_CURRENT_SNAPSHOT'); roots.add(root); snapshotIds.add(snapshot.id);
  }
  // Exclude previously exposed roots before any probability sample or model output is inspected.
  const exclusionsProvided = options.exclusionRecords !== undefined;
  const excluded = excludedRoots(options.exclusionRecords ?? []);
  const population = inputPopulation.filter(snapshot => !excluded.roots.has(canonical([snapshot.platform, snapshot.root_post_id])));
  const exclusionCounts = Object.fromEntries(PLATFORMS.map(platform => {
    const before = inputPopulation.filter(snapshot => snapshot.platform === platform).length;
    const remaining = population.filter(snapshot => snapshot.platform === platform).length;
    const supplied = excluded.unique.filter(row => row.platform === platform).length;
    return [platform, { input_population_count: before, supplied_unique_root_count: supplied, excluded_population_count: before - remaining,
      supplied_roots_absent_from_population: supplied - (before - remaining), eligible_population_count: remaining }];
  }));
  const strata = {}, blindedRows = [];
  // Selection uses identity and the frozen seed ONLY. No classifier output is read here.
  for (const platform of PLATFORMS) {
    const frame = population.filter(snapshot => snapshot.platform === platform).map(snapshot => ({ snapshot,
      selectionHash: sha(canonical([VERSION, seed, platform, snapshot.root_post_id])) }));
    frame.sort((a, b) => a.selectionHash < b.selectionHash ? -1 : a.selectionHash > b.selectionHash ? 1 : a.snapshot.root_post_id < b.snapshot.root_post_id ? -1 : 1);
    const selected = frame.slice(0, requested[platform]), n = selected.length, N = frame.length;
    const fraction = N ? n / N : null, weight = n ? N / n : null;
    strata[platform] = { population_count: N, input_population_count: exclusionCounts[platform].input_population_count,
      excluded_population_count: exclusionCounts[platform].excluded_population_count, requested_sample_count: requested[platform], actual_sample_count: n, shortfall: Math.max(0, requested[platform] - n),
      inclusion_probability: fraction, design_weight: weight, status: n === requested[platform] ? 'COMPLETE' : 'UNDERSIZED' };
    for (const [index, { snapshot, selectionHash }] of selected.entries()) {
      blindedRows.push({ ...snapshot, snapshot_id: snapshot.id, sample_id: 'LH-' + sha(canonical([platform, snapshot.root_post_id, snapshot.id])).slice(0, 24),
        blinded_snapshot_sha256: sha(canonical(snapshot)), as_of: snapshot.observed_at,
        sampling: { stratum: platform, rank: index + 1, selection_sha256: selectionHash, population_count: N, sample_count: n, inclusion_probability: fraction, design_weight: weight } });
    }
  }
  const mapped = currentPredictions(data, campaign);
  const predictions = blindedRows.map(row => {
    const current = mapped.rows.get(row.snapshot_id);
    return { ...(current ?? { classification: null, assessment_status: 'MISSING', reason_code: 'NO_CURRENT_DECISION_FOR_FROZEN_SNAPSHOT', evidence_ids: [], model: null }),
      snapshot_id: row.snapshot_id, sample_id: row.sample_id, platform: row.platform, root_post_id: row.root_post_id,
      blinded_snapshot_sha256: row.blinded_snapshot_sha256, prediction_present: Boolean(current), sampling: structuredClone(row.sampling) };
  });
  const createdAt = options.createdAt ?? new Date().toISOString(); requireValue(validTime(createdAt), 'CREATED_AT_INVALID');
  const manifest = { schema_version: '1.0.0', sampler_version: VERSION, purpose: 'FROZEN_LIVE_CANDIDATE_HOLDOUT_PENDING_INDEPENDENT_ANNOTATION', created_at: createdAt,
    reference_status: 'UNLABELED_NOT_HUMAN_GOLD', unit: 'unique (platform, root_post_id), latest exported snapshot', seed,
    sampling_method: 'Stratified uniform sampling without replacement via SHA256(seed, platform, root ID); fixed seed before label inspection',
    selection_excludes_model_labels: true, population_includes_pending_failed_missing: true, strata,
    population_count: population.length, input_population_count: inputPopulation.length,
    exclusions: { provided: exclusionsProvided, identity: '(platform, root_post_id); post_id accepted as alias', input_record_count: excluded.inputCount,
      unique_root_count: excluded.unique.length, duplicate_record_count: excluded.inputCount - excluded.unique.length,
      root_set_sha256: excluded.sha256, excluded_population_count: inputPopulation.length - population.length, by_platform: exclusionCounts },
    sample_count: blindedRows.length, sample_status: PLATFORMS.every(platform => strata[platform].status === 'COMPLETE') ? 'COMPLETE' : 'UNDERSIZED',
    population_frame_sha256: sha(canonical(population.map(snapshot => ({ platform: snapshot.platform, root_post_id: snapshot.root_post_id, snapshot_id: snapshot.id, blinded_snapshot_sha256: sha(canonical(snapshot)) })).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1))),
    sample_identity_sha256: sha(canonical(blindedRows.map(row => [row.sample_id, row.snapshot_id, row.blinded_snapshot_sha256]))),
    watermark: pick(data.watermark, ['journal_sequence', 'journal_event_id', 'captured_at']), campaign,
    campaign_version: campaign.version, filter_version: campaign.filter_version, predictions_source: mapped.source,
    cost_snapshot: data.cost ? pick(data.cost, costKeys) : null, cost_captured_at: data.cost_captured_at ?? null,
    independence_checks: { snapshot_context_frozen: true, selection_label_blind: true,
      prior_calibration_root_overlap: exclusionsProvided ? 'SUPPLIED_ROOTS_EXCLUDED_BEFORE_SAMPLING' : 'NOT_CHECKED', author_and_near_duplicate_overlap: 'NOT_CHECKED' },
    interpretation: 'Annotators receive blinded-reference.jsonl and campaign criteria only. Keep predictions.jsonl separate. Weights apply to the eligible population after exact-root exclusions. Do not pool unequal strata unweighted. Exclusion source completeness and author/near-duplicate overlap still require an independent audit. No live or future context may be added to these frozen cases.' };
  return { blindedRows, predictions, manifest };
}

function outsideRepository(destination) {
  const resolved = path.resolve(destination); let ancestor = resolved;
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); requireValue(parent !== ancestor, 'OUTPUT_PATH_INVALID'); ancestor = parent; }
  const canonicalTarget = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved)), relative = path.relative(ROOT, canonicalTarget);
  requireValue(relative && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (fs.existsSync(resolved)) requireValue(fs.statSync(resolved).isDirectory(), 'OUTPUT_NOT_DIRECTORY');
  return resolved;
}
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
function privateWrite(file, content) { fs.writeFileSync(file, content, { flag: 'wx', flush: true, mode: 0o600 }); }
export function freezeLiveSample(options) {
  requireValue(text(options?.input) && text(options?.output), 'INPUT_AND_OUTPUT_REQUIRED');
  const destination = outsideRepository(options.output), inputPath = path.resolve(options.input), bytes = fs.readFileSync(inputPath);
  let input; try { input = JSON.parse(bytes.toString('utf8')); } catch { throw Error('INPUT_JSON_INVALID'); }
  let exclusionInput = null, exclusionRecords = options.exclusionRecords;
  if (options.excludeIds !== undefined) {
    requireValue(text(options.excludeIds) && exclusionRecords === undefined, 'EXCLUSION_INPUT_INVALID');
    const exclusionPath = path.resolve(options.excludeIds), exclusionBytes = fs.readFileSync(exclusionPath);
    try { exclusionRecords = exclusionBytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line)); }
    catch { throw Error('EXCLUSION_JSONL_INVALID'); }
    exclusionInput = { path: exclusionPath, sha256: sha(exclusionBytes), bytes: exclusionBytes.length };
  }
  const prepared = sampleLiveExport(input, { ...options, ...(exclusionRecords === undefined ? {} : { exclusionRecords }) });
  requireValue(!fs.existsSync(destination) || fs.readdirSync(destination).length === 0, 'FROZEN_OUTPUT_ALREADY_EXISTS');
  fs.mkdirSync(destination, { recursive: true });
  const lock = path.join(destination, '.freeze.lock'); let lockOwned = false;
  try {
    privateWrite(lock, JSON.stringify({ pid: process.pid })); lockOwned = true;
    requireValue(fs.readdirSync(destination).every(name => name === '.freeze.lock'), 'FROZEN_OUTPUT_ALREADY_EXISTS');
    const referenceBytes = jsonl(prepared.blindedRows), predictionBytes = jsonl(prepared.predictions);
    const manifest = { ...prepared.manifest, input: { path: inputPath, sha256: sha(bytes), bytes: bytes.length }, exclusion_input: exclusionInput,
      files: { blinded_reference: { name: 'blinded-reference.jsonl', sha256: sha(referenceBytes), rows: prepared.blindedRows.length },
        predictions: { name: 'predictions.jsonl', sha256: sha(predictionBytes), rows: prepared.predictions.length } } };
    privateWrite(path.join(destination, 'blinded-reference.jsonl'), referenceBytes);
    privateWrite(path.join(destination, 'predictions.jsonl'), predictionBytes);
    const manifestBytes = JSON.stringify(manifest, null, 2) + '\n'; privateWrite(path.join(destination, 'manifest.json'), manifestBytes);
    return { event: 'live_holdout_frozen', sample_status: manifest.sample_status, population_count: manifest.population_count, sample_count: manifest.sample_count,
      excluded_population_count: manifest.exclusions.excluded_population_count, strata: manifest.strata, seed_sha256: sha(manifest.seed), manifest_sha256: sha(manifestBytes) };
  } finally { if (lockOwned && fs.existsSync(lock)) fs.unlinkSync(lock); }
}
function cli() {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    requireValue(['--input', '--output', '--seed', '--facebook-count', '--threads-count', '--exclude-ids'].includes(key) && value !== undefined && !Object.hasOwn(args, key), 'CLI_ARGUMENT_INVALID'); args[key] = value;
  }
  const result = freezeLiveSample({ input: args['--input'], output: args['--output'], ...(args['--seed'] ? { seed: args['--seed'] } : {}),
    ...(args['--exclude-ids'] !== undefined ? { excludeIds: args['--exclude-ids'] } : {}),
    ...(args['--facebook-count'] !== undefined ? { facebookCount: Number(args['--facebook-count']) } : {}), ...(args['--threads-count'] !== undefined ? { threadsCount: Number(args['--threads-count']) } : {}) });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); } catch (error) { console.error(JSON.stringify({ error_code: /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'LIVE_SAMPLER_FAILED' })); process.exitCode = 1; }
}
