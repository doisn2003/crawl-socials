#!/usr/bin/env node
/** Structural QA for a frozen conversation export. No network, store writer, or model calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSION = 'opportunity-export-audit-v2.0.0';
const PLATFORMS = ['facebook', 'threads'], LABELS = ['SUITABLE', 'NOT_YET', 'UNRELATED'];
const COVERAGE = ['NOT_ATTEMPTED', 'OBSERVED_EMPTY', 'PARTIAL', 'EXHAUSTED_VISIBLE', 'INACCESSIBLE', 'RETRYABLE_ERROR'];
const ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v)))
  : Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, JSON.parse(stable(value[k]))])) : value);
const id = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const key = value => JSON.stringify([value?.platform, value?.root_post_id]);
const safeId = value => /^[A-Za-z0-9:_.-]{1,240}$/u.test(String(value ?? '')) ? String(value) : 'sha256:' + hash(String(value ?? '')).slice(0, 20);
const sameContext = (d, campaign) => d?.campaign_id === campaign?.campaign_id && d?.campaign_version === campaign?.version && d?.filter_version === campaign?.filter_version;
const emptyCounts = () => ({ raw: 0, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 0, failed: 0, missing: 0 });
const sumCounts = counts => Object.fromEntries(Object.keys(emptyCounts()).map(k => [k, counts.reduce((sum, row) => sum + row[k], 0)]));
function platformUrl(value, platform) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
    && (platform === 'facebook' ? ['facebook.com'] : ['threads.net', 'threads.com']).some(host => u.hostname === host || u.hostname.endsWith('.' + host)); }
  catch { return false; }
}
function unwrap(input) {
  const data = Array.isArray(input?.snapshots) ? input : input?.opportunity;
  if (!data || !Array.isArray(data.snapshots) || !Array.isArray(data.conversations)) throw Error('PIPELINE_EXPORT_REQUIRED');
  return data;
}

export function auditOpportunityExport(input, options = {}) {
  const data = unwrap(input), campaign = data.campaign ?? {}, asOf = data.watermark?.captured_at;
  const maxExamples = options.maxExamples ?? 5, clockSkewSeconds = options.clockSkewSeconds ?? 300;
  if (!Number.isInteger(maxExamples) || maxExamples < 0 || maxExamples > 20 || !Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) throw Error('AUDIT_OPTIONS_INVALID');
  const issues = new Map(); let examplesUsed = 0;
  function issue(code, severity, object = {}, entityId) {
    object ??= {};
    if (!issues.has(code)) issues.set(code, { code, severity, count: 0, examples: [] });
    const row = issues.get(code); row.count++;
    if ({ ERROR: 0, WARN: 1, INFO: 2 }[severity] < { ERROR: 0, WARN: 1, INFO: 2 }[row.severity]) row.severity = severity;
    if (row.examples.length < maxExamples && examplesUsed < 50) {
      row.examples.push({ ...(PLATFORMS.includes(object.platform) ? { platform: object.platform } : {}),
        ...(object.root_post_id ? { root_post_id: safeId(object.root_post_id) } : {}),
        ...(object.id || object.snapshot_id ? { snapshot_id: safeId(object.snapshot_id ?? object.id) } : {}),
        ...(entityId ? { entity_id: safeId(entityId) } : {}) }); examplesUsed++;
    }
  }
  if (!instant(asOf) || !Number.isSafeInteger(data.watermark?.journal_sequence)) issue('INVALID_EXPORT_WATERMARK', 'ERROR');
  if (![campaign.campaign_id, campaign.version, campaign.filter_version].every(id)) issue('MISSING_CAMPAIGN_VERSION', 'ERROR');
  const roots = new Map(), snapshots = new Map(), info = new Map(), entityRoots = new Map();
  const profiles = Object.fromEntries(PLATFORMS.map(p => [p, { ...emptyCounts(), post_missing: 0, empty_post_text: 0,
    unresolved_comment_parents: 0, comments_with_unknown_parent: 0, coverage: {}, suitable_with_comment_evidence: 0,
    suitable_comment_target: 0, qualified_comment_supported_promotions: 0 }]));
  function validateSnapshot(snapshot, current) {
    const validIdentity = snapshot && id(snapshot.id) && PLATFORMS.includes(snapshot.platform) && id(snapshot.root_post_id)
      && Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0;
    if (!validIdentity) { issue('INVALID_SNAPSHOT_IDENTITY', 'ERROR', snapshot); return null; }
    const prior = snapshots.get(snapshot.id);
    if (prior) { if (stable(prior) !== stable(snapshot)) issue('CONFLICTING_SNAPSHOT_CONTENT', 'ERROR', snapshot); return info.get(snapshot.id); }
    snapshots.set(snapshot.id, snapshot);
    let invalid = false;
    const error = (code, entityId) => { invalid = true; issue(code, 'ERROR', snapshot, entityId); };
    const comments = Array.isArray(snapshot.comments) ? snapshot.comments : [], spans = Array.isArray(snapshot.spans) ? snapshot.spans : [];
    if (!Array.isArray(snapshot.comments) || !Array.isArray(snapshot.spans)) error('INVALID_SNAPSHOT_CONTEXT');
    const entities = new Map(), validSpans = new Map(), unresolved = new Set();
    if (!instant(snapshot.observed_at)) error('INVALID_OBSERVED_TIMESTAMP');
    else if (instant(asOf) && Date.parse(snapshot.observed_at) > Date.parse(asOf) + clockSkewSeconds * 1000) issue('OBSERVATION_AFTER_EXPORT', 'WARN', snapshot);
    const coverage = snapshot.coverage ?? {};
    if (!COVERAGE.includes(coverage.status)) error('INVALID_COVERAGE_STATUS');
    if (coverage.status === 'OBSERVED_EMPTY' && (comments.length || coverage.observed_count > 0 || coverage.has_more === true)) error('EMPTY_COVERAGE_WITH_COMMENTS_OR_MORE');
    if (coverage.status === 'EXHAUSTED_VISIBLE' && coverage.has_more === true) error('EXHAUSTED_COVERAGE_WITH_MORE');
    for (const n of [coverage.observed_count, coverage.advertised_count, coverage.pages]) if (n != null && (!Number.isInteger(n) || n < 0)) error('INVALID_COVERAGE_COUNT');
    if (current && Number.isInteger(coverage.observed_count) && coverage.observed_count !== comments.length) issue('CAPTURE_COUNT_DIFFERS_FROM_RETAINED_COMMENTS', 'INFO', snapshot);
    const values = [...(snapshot.post ? [[snapshot.post, 'POST']] : []), ...comments.map(c => [c, 'COMMENT'])];
    for (const [entity, type] of values) {
      if (!entity || !id(entity.entity_id) || entity.entity_type !== type || entity.root_post_id !== snapshot.root_post_id || typeof entity.text !== 'string'
        || (type === 'POST' && entity.entity_id !== snapshot.root_post_id)) { error('INVALID_ENTITY_IDENTITY', entity?.entity_id); continue; }
      if (entities.has(entity.entity_id)) error('DUPLICATE_ENTITY_ID', entity.entity_id);
      entities.set(entity.entity_id, entity);
      if (entity.parent_id !== null && !id(entity.parent_id)) error('INVALID_ENTITY_PARENT_ID', entity.entity_id);
      if (type === 'POST' && entity.parent_id !== null) error('ROOT_POST_HAS_PARENT', entity.entity_id);
      if (!instant(entity.observed_at)) error('INVALID_ENTITY_OBSERVED_TIMESTAMP', entity.entity_id);
      if (entity.published_at != null) {
        if (!instant(entity.published_at)) error('INVALID_PUBLISHED_TIMESTAMP', entity.entity_id);
        else if ([entity.observed_at, asOf].some(t => instant(t) && Date.parse(entity.published_at) > Date.parse(t) + clockSkewSeconds * 1000)) issue('FUTURE_PUBLISHED_TIMESTAMP', 'WARN', snapshot, entity.entity_id);
      }
      if (entity.permalink && !platformUrl(entity.permalink, snapshot.platform)) error('INVALID_ENTITY_PERMALINK_HOST', entity.entity_id);
      if (entity.source?.url && !platformUrl(entity.source.url, snapshot.platform)) issue('INVALID_SOURCE_URL_HOST', 'WARN', snapshot, entity.entity_id);
      if (current) {
        const entityKey = stable([snapshot.platform, type, entity.entity_id]);
        if (entityRoots.has(entityKey) && entityRoots.get(entityKey) !== snapshot.root_post_id) error('ENTITY_ASSIGNED_TO_MULTIPLE_ROOTS', entity.entity_id);
        entityRoots.set(entityKey, snapshot.root_post_id);
      }
    }
    for (const comment of comments) {
      if (!comment || !entities.has(comment.entity_id)) continue;
      if (comment.parent_id === comment.entity_id) error('SELF_PARENT_COMMENT', comment.entity_id);
      if (comment.parent_id == null || !entities.has(comment.parent_id) && comment.parent_id !== snapshot.root_post_id) {
        unresolved.add(comment.entity_id);
        if (current) {
          profiles[snapshot.platform].unresolved_comment_parents++;
          if (comment.parent_id == null) profiles[snapshot.platform].comments_with_unknown_parent++;
          issue('COMMENT_PARENT_NOT_OBSERVED', coverage.status === 'PARTIAL' || coverage.status === 'NOT_ATTEMPTED' ? 'INFO' : 'WARN', snapshot, comment.entity_id);
        }
      }
      const seen = new Set(); let at = comment;
      while (at?.entity_type === 'COMMENT') {
        if (seen.has(at.entity_id)) { error('COMMENT_PARENT_CYCLE', comment.entity_id); break; }
        seen.add(at.entity_id); at = entities.get(at.parent_id);
      }
    }
    const spanIds = new Set();
    for (const span of spans) {
      const entity = span && entities.get(span.entity_id);
      if (!span || !id(span.id) || spanIds.has(span.id) || !entity || entity.entity_type !== span.entity_type || !Number.isInteger(span.start) || !Number.isInteger(span.end)
        || span.start < 0 || span.end <= span.start || span.end > entity.text.length || entity.text.slice(span.start, span.end) !== span.text) error('INVALID_EXACT_EVIDENCE_SPAN', span?.entity_id);
      else validSpans.set(span.id, span);
      spanIds.add(span?.id);
    }
    const result = { entities, validSpans, unresolved, valid: !invalid }; info.set(snapshot.id, result); return result;
  }
  for (const snapshot of data.snapshots) {
    const context = validateSnapshot(snapshot, true); if (!context) continue;
    if (roots.has(key(snapshot))) { issue('DUPLICATE_CURRENT_ROOT', 'ERROR', snapshot); continue; }
    roots.set(key(snapshot), snapshot);
    const profile = profiles[snapshot.platform]; profile.raw++; profile.comments += Array.isArray(snapshot.comments) ? snapshot.comments.length : 0;
    if (!snapshot.post) profile.post_missing++; else if (typeof snapshot.post.text !== 'string' || !snapshot.post.text.trim()) profile.empty_post_text++;
    const coverage = COVERAGE.includes(snapshot.coverage?.status) ? snapshot.coverage.status : 'INVALID'; profile.coverage[coverage] = (profile.coverage[coverage] ?? 0) + 1;
  }
  const historical = Array.isArray(data.decision_snapshots) ? data.decision_snapshots : [];
  if (!Array.isArray(data.decision_snapshots)) issue('HISTORICAL_SNAPSHOTS_UNAVAILABLE', 'INFO');
  const historicalIds = new Set();
  for (const snapshot of historical) {
    if (historicalIds.has(snapshot?.id)) issue('DUPLICATE_HISTORICAL_SNAPSHOT_ID', 'ERROR', snapshot);
    historicalIds.add(snapshot?.id); validateSnapshot(snapshot, false);
  }
  const decisionValid = new Map();
  function validateDecision(decision) {
    const snapshot = snapshots.get(decision?.snapshot_id), details = info.get(decision?.snapshot_id);
    let valid = true;
    const error = code => { valid = false; issue(code, 'ERROR', decision); };
    if (!decision || !id(decision.id) || !sameContext(decision, campaign)) error('DECISION_CONTEXT_OR_ID_INVALID');
    if (!snapshot) { issue('DECISION_SNAPSHOT_UNAVAILABLE', 'WARN', decision); return false; }
    if (decision.platform !== snapshot.platform || decision.root_post_id !== snapshot.root_post_id || decision.snapshot_revision !== snapshot.revision) error('DECISION_SNAPSHOT_REVISION_MISMATCH');
    if (!['ASSESSED', 'PENDING', 'FAILED'].includes(decision.assessment_status) || (decision.assessment_status === 'ASSESSED' ? !LABELS.includes(decision.classification) : decision.classification !== null)) error('DECISION_CLASS_STATUS_CONTRADICTION');
    if (!id(decision.model) || !id(decision.reason_code)) error('DECISION_PROVENANCE_MISSING');
    if (!instant(decision.created_at)) error('INVALID_DECISION_TIMESTAMP');
    const refs = decision.evidence_ids;
    if (!Array.isArray(refs) || new Set(refs).size !== refs.length || refs.some(ref => !details?.validSpans.has(ref))) error('INVALID_DECISION_EVIDENCE_REFERENCE');
    if (decision.classification === 'SUITABLE' && (!Array.isArray(refs) || !refs.length)) error('SUITABLE_WITHOUT_EVIDENCE');
    const target = decision.action_target, entity = target && details?.entities.get(target.entity_id);
    if (target && (!entity || entity.entity_type !== target.type)) error('INVALID_ACTION_TARGET');
    if (decision.classification === 'SUITABLE' && (!target || !Array.isArray(refs) || !refs.some(ref => details?.validSpans.get(ref)?.entity_id === target.entity_id))) error('SUITABLE_ACTION_TARGET_NOT_EVIDENCED');
    if (decision.classification === 'SUITABLE' && !snapshot.post?.permalink && !entity?.permalink) issue('SUITABLE_WITHOUT_OBSERVED_PERMALINK', 'WARN', decision);
    return valid && details?.valid === true;
  }
  const history = Array.isArray(data.decisions) ? data.decisions : [], historyIds = new Map();
  if (!Array.isArray(data.decisions)) issue('DECISION_HISTORY_UNAVAILABLE', 'INFO');
  for (const decision of history) {
    if (historyIds.has(decision?.id)) issue('DUPLICATE_DECISION_HISTORY_ID', 'ERROR', decision);
    historyIds.set(decision?.id, decision); decisionValid.set(decision, validateDecision(decision));
  }
  const current = new Map();
  for (const view of data.conversations) {
    const decision = view?.decision, snapshot = view?.snapshot, canonical = roots.get(key(snapshot));
    if (!snapshot || !decision) { issue('INVALID_CURRENT_VIEW', 'ERROR'); continue; }
    if (current.has(key(snapshot))) issue('DUPLICATE_CURRENT_DECISION', 'ERROR', snapshot);
    const match = canonical && canonical.id === snapshot.id && stable(canonical) === stable(snapshot) && decision.snapshot_id === snapshot.id && view.stale !== true;
    if (!match) issue('STALE_OR_INCONSISTENT_CURRENT_VIEW', 'ERROR', snapshot);
    const historicalDecision = historyIds.get(decision.id);
    if (historicalDecision && stable(historicalDecision) !== stable(decision)) issue('CURRENT_DECISION_HISTORY_CONFLICT', 'ERROR', decision);
    if (!historicalDecision) issue('CURRENT_DECISION_HISTORY_MISSING', 'WARN', decision);
    const valid = historicalDecision && stable(historicalDecision) === stable(decision) ? decisionValid.get(historicalDecision) : validateDecision(decision);
    if (match && !current.has(key(snapshot))) current.set(key(snapshot), { decision, valid });
  }
  const promotionExclusions = {};
  for (const [rootKey, snapshot] of roots) {
    const profile = profiles[snapshot.platform], entry = current.get(rootKey), decision = entry?.decision;
    if (decision?.assessment_status === 'ASSESSED' && LABELS.includes(decision.classification)) profile[{ SUITABLE: 'suitable', NOT_YET: 'notYet', UNRELATED: 'unrelated' }[decision.classification]]++;
    else { profile.pending++; if (decision?.assessment_status === 'FAILED') profile.failed++; if (!decision) profile.missing++; }
    if (decision?.classification !== 'SUITABLE' || decision.assessment_status !== 'ASSESSED' || !entry.valid) continue;
    const details = info.get(snapshot.id), cited = decision.evidence_ids.map(ref => details.validSpans.get(ref));
    if (cited.some(span => span?.entity_type === 'COMMENT')) profile.suitable_with_comment_evidence++;
    if (decision.action_target?.type === 'COMMENT') profile.suitable_comment_target++;
    const previous = history.filter(d => key(d) === rootKey && sameContext(d, campaign) && d.assessment_status === 'ASSESSED' && d.snapshot_id !== snapshot.id
      && d.snapshot_revision < snapshot.revision && instant(d.created_at) && Date.parse(d.created_at) <= Date.parse(decision.created_at))
      .sort((a, b) => b.snapshot_revision - a.snapshot_revision || Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const before = snapshots.get(previous?.snapshot_id);
    let exclusion;
    if (!previous || !before || !decisionValid.get(previous)) exclusion = 'no_valid_prior_assessed_snapshot';
    else if (previous.classification !== 'NOT_YET') exclusion = 'prior_label_not_not_yet';
    else if (previous.model !== decision.model) exclusion = 'model_changed';
    else if (!before.post || !snapshot.post || before.post.text !== snapshot.post.text) exclusion = 'root_text_changed_or_unavailable';
    else if (before.comments.some(comment => !snapshot.comments.some(now => now.entity_id === comment.entity_id && now.text === comment.text && now.parent_id === comment.parent_id))) exclusion = 'preexisting_comment_changed_or_removed';
    else {
      const newIds = new Set(snapshot.comments.filter(comment => !before.comments.some(old => old.entity_id === comment.entity_id)).map(comment => comment.entity_id));
      const target = decision.action_target;
      if (target?.type !== 'COMMENT' || !newIds.has(target.entity_id) || !cited.some(span => span?.entity_id === target.entity_id)) exclusion = 'no_new_comment_action_evidence';
      else {
        let at = details.entities.get(target.entity_id), parentUnresolved = false;
        while (at?.entity_type === 'COMMENT') { if (details.unresolved.has(at.entity_id)) { parentUnresolved = true; break; } at = details.entities.get(at.parent_id); }
        if (parentUnresolved) exclusion = 'new_comment_parent_context_incomplete';
      }
    }
    if (exclusion) promotionExclusions[exclusion] = (promotionExclusions[exclusion] ?? 0) + 1;
    else profile.qualified_comment_supported_promotions++;
  }
  const counts = sumCounts(Object.values(profiles));
  const countMismatches = [];
  for (const [provided, actual, platform] of [[data.progress?.counts, counts], ...PLATFORMS.map(p => [data.progress?.byPlatform?.[p], profiles[p], p])]) {
    if (!provided) { issue('EXPORTED_PROGRESS_COUNTS_UNAVAILABLE', 'INFO', { platform }); continue; }
    for (const field of ['raw', 'comments', 'suitable', 'notYet', 'unrelated', 'pending', 'failed']) if (provided[field] !== actual[field]) {
      issue('EXPORTED_COUNTS_DO_NOT_RECONCILE', 'ERROR', { platform });
      countMismatches.push({ scope: platform ?? 'total', field, exported: Number.isFinite(provided[field]) ? provided[field] : null, recomputed: actual[field] });
    }
  }
  const findings = [...issues.values()].sort((a, b) => ({ ERROR: 0, WARN: 1, INFO: 2 }[a.severity] - { ERROR: 0, WARN: 1, INFO: 2 }[b.severity]) || a.code.localeCompare(b.code));
  const totals = Object.fromEntries(['ERROR', 'WARN', 'INFO'].map(severity => [severity.toLowerCase(), findings.filter(f => f.severity === severity).reduce((sum, f) => sum + f.count, 0)]));
  return { audit_version: VERSION, audited_at: options.auditedAt ?? new Date().toISOString(), status: totals.error ? 'FAIL' : totals.warn ? 'WARN' : 'PASS',
    source_watermark: { journal_sequence: data.watermark?.journal_sequence ?? null, captured_at: instant(asOf) ? asOf : null },
    unit: 'unique (platform, root_post_id); comments and revisions never add root counts', counts, by_platform: profiles,
    snapshot_rows: data.snapshots.length, decision_history_rows: history.length, historical_snapshot_rows: historical.length,
    findings: { totals, checks: findings }, count_mismatches: countMismatches, promotion_exclusion_counts: promotionExclusions,
    definitions: { pending: 'raw minus assessed; includes FAILED and missing current decisions, so failed must not be added again',
      qualified_comment_supported_promotions: 'Current SUITABLE after immediate prior assessed revision NOT_YET in same campaign/filter/model; unchanged root text, unchanged retained comment text/parents, newly observed comment is cited action target with resolved ancestry. Observed transition, not causal lift.',
      coverage: 'Retained comments are not a complete census. Missing parents in partial captures are counted separately, not a failed integrity assertion.',
      semantic_accuracy: 'Not measured by this structural audit; requires independent blinded reference labels.', timestamp_skew_tolerance_seconds: clockSkewSeconds,
      example_limit_per_check: maxExamples, total_example_limit: 50 } };
}

function outsideRepository(destination) {
  const resolved = path.resolve(destination); let ancestor = path.dirname(resolved);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const target = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved)), relative = path.relative(ROOT, target);
  if (!relative || !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  return resolved;
}
export function writeOpportunityAudit(options) {
  if (!id(options?.input) || !id(options?.output)) throw Error('INPUT_AND_OUTPUT_REQUIRED');
  const output = outsideRepository(options.output), bytes = fs.readFileSync(path.resolve(options.input));
  let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { throw Error('INPUT_JSON_INVALID'); }
  const audit = { ...auditOpportunityExport(data, options), input_sha256: hash(bytes) };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', flush: true, mode: 0o600 });
  return { event: 'opportunity_export_audited', status: audit.status, counts: audit.counts, finding_totals: audit.findings.totals, input_sha256: audit.input_sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if (!['--input', '--output', '--max-examples'].includes(process.argv[i]) || process.argv[i + 1] === undefined || Object.hasOwn(args, process.argv[i])) throw Error('CLI_ARGUMENT_INVALID');
      args[process.argv[i]] = process.argv[i + 1];
    }
    const result = writeOpportunityAudit({ input: args['--input'], output: args['--output'], ...(args['--max-examples'] !== undefined ? { maxExamples: Number(args['--max-examples']) } : {}) });
    console.log(JSON.stringify(result)); if (result.status === 'FAIL') process.exitCode = 2;
  } catch (error) { console.error(JSON.stringify({ error_code: /^[A-Z][A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'AUDIT_FAILED' })); process.exitCode = 1; }
}
