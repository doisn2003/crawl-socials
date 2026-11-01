#!/usr/bin/env node
/** Development diagnostic only. Default plan mode performs no API or ledger writes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blindSnapshot } from './sample-live-v2.mjs';

const ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) { return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)])) : value; }
const jsonl = file => fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(line => line.trim()).map(JSON.parse);
const totalCost = summary => summary.measured_cost_usd + summary.unmetered_cost_upper_usd + summary.reserved_usd;
const save = (file, value) => fs.writeFileSync(file, value, { flag: 'wx', flush: true, mode: 0o600 });
function outsideRepo(file) {
  const target = path.resolve(file); let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = path.resolve(fs.realpathSync(existing), path.relative(existing, target)), relative = path.relative(ROOT, real);
  if (!relative || !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) throw Error('OUTPUT_MUST_BE_EXTERNAL');
  return target;
}

/** Do not read reference annotations here. Exact deployed top20 order is frozen before inference. */
export function prepareFocusedAblation(input, rows, { perPlatform = 20 } = {}) {
  const data = input?.opportunity ?? input;
  if (!Array.isArray(data?.conversations) || !Array.isArray(rows) || rows.length !== perPlatform * 2) throw Error('TOP20_BUNDLE_REQUIRED');
  const views = ['facebook', 'threads'].flatMap(platform => data.conversations.filter(v => !v.stale && v.decision?.classification === 'SUITABLE'
    && v.decision.assessment_status === 'ASSESSED' && v.snapshot?.platform === platform).slice(0, perPlatform));
  if (views.length !== rows.length || new Set(rows.map(r => r.sample_id)).size !== rows.length) throw Error('TOP20_COUNT_MISMATCH');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], v = views[i], s = v.snapshot, d = v.decision;
    if (r.rank !== i % perPlatform + 1 || r.snapshot_id !== s.id || r.as_of !== s.observed_at || d.snapshot_id !== s.id
      || d.snapshot_revision !== s.revision || d.campaign_id !== data.campaign.campaign_id || d.campaign_version !== data.campaign.version
      || d.filter_version !== data.campaign.filter_version || canonical(blindSnapshot(r)) !== canonical(blindSnapshot(s))) throw Error('TOP20_FROZEN_CONTEXT_MISMATCH');
  }
  return { campaign: data.campaign, snapshots: views.map(v => v.snapshot), proposals: views.map(v => v.decision), rows,
    watermark: data.watermark, cost_snapshot: data.cost, input_sha256: sha(canonical(views.map(v => blindSnapshot(v.snapshot)))) };
}

/** Retain completed content assessments exactly; only technical failures are retry candidates. */
export function prepareFocusedResume(prepared, priorAudits, version, promptHash) {
  if (!Array.isArray(priorAudits) || priorAudits.length !== prepared.rows.length
    || new Set(priorAudits.map(a => a.snapshot_id)).size !== priorAudits.length) throw Error('RESUME_AUDIT_COUNT_INVALID');
  const identities = new Map(prepared.rows.map(r => [r.snapshot_id, r])), byAudit = new Map();
  const pending = new Set();
  for (const a of priorAudits) {
    const row = identities.get(a.snapshot_id);
    if (!row || a.sample_id !== row.sample_id || a.as_of !== row.as_of || a.platform !== row.platform || a.rank !== row.rank
      || a.version !== version || a.prompt_sha256 !== promptHash
      || !['KEEP', 'DOWNGRADE_NOT_YET', 'DOWNGRADE_UNRELATED', 'UNRESOLVED'].includes(a.verdict)) throw Error('RESUME_AUDIT_CONTEXT_MISMATCH');
    if (a.reason === 'TECHNICAL_FAILURE') {
      if (a.verdict !== 'UNRESOLVED' || !/^[A-Z][A-Z0-9_]+$/u.test(a.error_code ?? '')) throw Error('RESUME_TECHNICAL_AUDIT_INVALID');
      pending.add(a.snapshot_id);
    }
    byAudit.set(a.snapshot_id, a);
  }
  return { pending_ids: pending, retained: new Map([...byAudit].filter(([id]) => !pending.has(id))),
    snapshots: prepared.snapshots.filter(s => pending.has(s.id)), proposals: prepared.proposals.filter(p => pending.has(p.snapshot_id)) };
}

/** Includes failed/unmetered/unfinished calls, preventing a rerun from resetting the $0.06 ablation allowance. */
export function purposeCostUpper(events, purpose) {
  const starts = new Map(), finishes = new Map();
  for (const event of events) {
    if (event.type === 'START' && event.purpose === purpose) starts.set(event.invocation_id, event);
    if (event.type === 'FINISH' && !finishes.has(event.invocation_id)) finishes.set(event.invocation_id, event);
  }
  return [...starts].reduce((n, [id, start]) => {
    const finish = finishes.get(id), value = finish ? (finish.cost_usd ?? 0) + (finish.unmetered_cost_upper_usd ?? 0) : start.reserved_usd;
    if (!Number.isFinite(value) || value < 0) throw Error('ABLATION_LEDGER_COST_INVALID');
    return n + value;
  }, 0);
}

/** Same conservative request bound as the existing Gemini gateway, with one attempt only. */
export function requestCostUpper(request, price, stableJson, geminiWireSchema) {
  const generationConfig = { responseMimeType: 'application/json', responseJsonSchema: geminiWireSchema(request.schema),
    maxOutputTokens: request.max_output_tokens, temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } };
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: stableJson(request.input) }] }], generationConfig });
  return ((Buffer.byteLength(body) + 1024) * price.input_per_million + request.max_output_tokens * price.output_per_million) / 1_000_000;
}

export function evaluateFocusedAblation(audits, references) {
  if (new Set(audits.map(r => r.snapshot_id)).size !== audits.length || new Set(references.map(r => r.snapshot_id)).size !== references.length) throw Error('DUPLICATE_EVALUATION_ID');
  const byReference = new Map(references.map(r => [r.snapshot_id, r]));
  const output = {};
  for (const platform of ['facebook', 'threads']) {
    const rows = audits.filter(r => r.platform === platform), m = { n: rows.length, initialTP: 0, initialFP: 0, referenceUnresolved: 0,
      retainedTP: 0, retainedFP: 0, removedFP: 0, newFN: 0, pendingTP: 0, pendingFP: 0 };
    for (const r of rows) {
      const ref = byReference.get(r.snapshot_id);
      if (!ref || ref.sample_id !== r.sample_id || ref.as_of !== r.as_of) throw Error('REFERENCE_ALIGNMENT_INVALID');
      if (!['SUITABLE', 'NOT_YET', 'UNRELATED', 'REFERENCE_UNRESOLVED'].includes(ref.final_label)) throw Error('REFERENCE_LABEL_INVALID');
      if (!['KEEP', 'DOWNGRADE_NOT_YET', 'DOWNGRADE_UNRELATED', 'UNRESOLVED'].includes(r.verdict)) throw Error('AUDIT_VERDICT_INVALID');
      if (ref.final_label === 'REFERENCE_UNRESOLVED') { m.referenceUnresolved++; continue; }
      const positive = ref.final_label === 'SUITABLE'; m[positive ? 'initialTP' : 'initialFP']++;
      if (r.verdict === 'KEEP') m[positive ? 'retainedTP' : 'retainedFP']++;
      else if (r.verdict === 'UNRESOLVED') m[positive ? 'pendingTP' : 'pendingFP']++;
      else m[positive ? 'newFN' : 'removedFP']++;
    }
    output[platform] = { ...m, precision_retained_resolved: m.retainedTP + m.retainedFP ? m.retainedTP / (m.retainedTP + m.retainedFP) : null,
      true_positive_retention: m.initialTP ? m.retainedTP / m.initialTP : null,
      false_positive_removal: m.initialFP ? m.removedFP / m.initialFP : null };
  }
  return { purpose: 'TOP20_DEVELOPMENT_ABLATION_NOT_HOLDOUT_OR_RELEASE_GATE', reference_provenance: 'INDEPENDENT_AI_REFERENCE_NOT_HUMAN_GOLD',
    by_platform: output, limitations: ['Accepted-candidate diagnostic has no population recall estimate.',
      'Top20 errors informed this verifier draft; metrics measure development fit, not unseen generalization.',
      'KEEP means no targeted contradiction found; unresolved references are excluded and reported explicitly.'] };
}

export async function runFocusedAblation(options) {
  if (options.mode === 'evaluate') {
    const output = outsideRepo(options.output);
    const report = evaluateFocusedAblation(jsonl(options.audits), jsonl(options.reference));
    save(output, JSON.stringify(report, null, 2) + '\n'); return report;
  }
  if (options.reference || options.audits) throw Error('REFERENCE_FORBIDDEN_DURING_INFERENCE');
  if (!['plan', 'infer'].includes(options.mode ?? 'plan')) throw Error('MODE_INVALID');
  if (!options.export || !options.bundle || !options.campaignDirectory || !options.output) throw Error('INPUT_PATHS_REQUIRED');
  const output = outsideRepo(options.output);
  if (fs.existsSync(output)) throw Error('ABLATION_OUTPUT_ALREADY_EXISTS');
  const bytes = fs.readFileSync(options.export), bundleManifest = JSON.parse(fs.readFileSync(path.join(options.bundle, 'manifest.json'), 'utf8'));
  if (bundleManifest.source_export_sha256 !== sha(bytes)) throw Error('SOURCE_EXPORT_HASH_MISMATCH');
  const prepared = prepareFocusedAblation(JSON.parse(bytes.toString('utf8')), jsonl(path.join(options.bundle, 'top20-blinded-reference.jsonl')));
  const campaignFile = path.join(options.campaignDirectory, 'campaign.json');
  if (!fs.existsSync(campaignFile) || canonical(JSON.parse(fs.readFileSync(campaignFile, 'utf8'))) !== canonical(prepared.campaign)) throw Error('CAMPAIGN_LEDGER_CONTEXT_MISMATCH');
  if (!Number.isFinite(prepared.campaign.budget.model_usd) || prepared.campaign.budget.model_usd > 3 || prepared.campaign.budget.model_usd <= 0) throw Error('CAMPAIGN_BUDGET_INVALID');
  const maxUsd = options.maxUsd ?? 0.06;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 0.12) throw Error('ABLATION_BUDGET_INVALID');
  const batchSize = options.batchSize ?? 8;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 16) throw Error('ABLATION_BATCH_INVALID');
  const moduleRoot = path.resolve(options.moduleRoot ?? path.join(ROOT, '.test-build/src'));
  const verifier = await import(pathToFileURL(path.join(moduleRoot, 'application/opportunity-verifier-v2.js')).href);
  let resume = null, prior = null;
  if (options.resumeFrom) {
    const manifestBytes = fs.readFileSync(path.join(options.resumeFrom, 'manifest.json')),
      auditsBytes = fs.readFileSync(path.join(options.resumeFrom, 'audits-private.jsonl'));
    const previous = JSON.parse(manifestBytes.toString('utf8'));
    if (previous.source_export_sha256 !== sha(bytes) || previous.campaign_id !== prepared.campaign.campaign_id
      || previous.campaign_version !== prepared.campaign.version || previous.filter_version !== prepared.campaign.filter_version
      || previous.version !== verifier.FOCUSED_VERIFIER_VERSION || previous.prompt_sha256 !== verifier.FOCUSED_VERIFIER_PROMPT_SHA256
      || previous.input_sha256 !== prepared.input_sha256
      || path.resolve(previous.ledger_directory) !== path.resolve(options.campaignDirectory)) throw Error('RESUME_MANIFEST_CONTEXT_MISMATCH');
    prior = prepareFocusedResume(prepared, auditsBytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim()).map(JSON.parse),
      verifier.FOCUSED_VERIFIER_VERSION, verifier.FOCUSED_VERIFIER_PROMPT_SHA256);
    for (const [id, audit] of prior.retained) verifier.validateFocusedVerification(audit,
      prepared.snapshots.find(s => s.id === id), { model: audit.model, invocation_id: audit.invocation_id });
    resume = { directory: path.resolve(options.resumeFrom), manifest_sha256: sha(manifestBytes), audits_sha256: sha(auditsBytes),
      retained_completed: prior.retained.size, retry_technical: prior.pending_ids.size };
  }
  const manifest = { purpose: 'TOP20_DEVELOPMENT_ABLATION_NOT_HOLDOUT_OR_RELEASE_GATE', mode: options.mode ?? 'plan',
    version: verifier.FOCUSED_VERIFIER_VERSION, prompt_sha256: verifier.FOCUSED_VERIFIER_PROMPT_SHA256,
    campaign_id: prepared.campaign.campaign_id, campaign_version: prepared.campaign.version, filter_version: prepared.campaign.filter_version,
    source_export_sha256: sha(bytes), input_sha256: prepared.input_sha256, watermark: prepared.watermark,
    count: prepared.snapshots.length, by_platform: { facebook: 20, threads: 20 }, batch_size: batchSize, resume,
    max_purpose_cumulative_usd: maxUsd, campaign_budget_usd: prepared.campaign.budget.model_usd,
    ledger_directory: path.resolve(options.campaignDirectory), cost_snapshot: prepared.cost_snapshot,
    references_read_during_inference: false, created_at: new Date().toISOString() };
  fs.mkdirSync(output, { recursive: true });
  save(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (options.mode !== 'infer') return { event: 'focused_verifier_plan', api_calls: 0, ...manifest };
  // Parent must pause the campaign before invoking infer: the factory is a single campaign writer.
  const lock = path.join(options.campaignDirectory, '.focused-verifier-ablation.lock'); let owned = false;
  try {
    save(lock, JSON.stringify({ pid: process.pid, version: manifest.version })); owned = true;
    const events = ['model', 'model-gemini-3.5-flash-lite'].flatMap(dir => {
      const file = path.join(options.campaignDirectory, dir, 'model-ledger.jsonl'); return fs.existsSync(file) ? jsonl(file) : [];
    });
    const priorPurposeUpper = purposeCostUpper(events, manifest.version);
    if (priorPurposeUpper >= maxUsd) throw Error('ABLATION_BUDGET_EXHAUSTED');
    const factory = await import(pathToFileURL(path.join(moduleRoot, 'infrastructure/llm/campaign-model-gateway.js')).href);
    const gemini = await import(pathToFileURL(path.join(moduleRoot, 'infrastructure/llm/gemini-gateway.js')).href);
    const { ModelGatewayError } = await import(pathToFileURL(path.join(moduleRoot, 'application/ports/model-gateway.js')).href);
    const gateway = factory.createCampaignModelGateway({ directory: options.campaignDirectory,
      budgetUsd: prepared.campaign.budget.model_usd, maxAttempts: 1 });
    const before = gateway.summary(), price = before.model === 'gemini-3.5-flash-lite' ? factory.GEMINI_35_FLASH_LITE_PRICE : gemini.GEMINI_FLASH_LITE_PRICE;
    const capped = { summary: () => gateway.summary(), generateJson: async request => {
      const used = priorPurposeUpper + Math.max(0, totalCost(gateway.summary()) - totalCost(before));
      if (used + requestCostUpper(request, price, gemini.stableJson, gemini.geminiWireSchema) > maxUsd) throw new ModelGatewayError('MODEL_BUDGET_ABLATION_EXHAUSTED');
      return gateway.generateJson(request);
    } };
    const result = await verifier.auditTentativeOpportunitiesV2(prepared.campaign, prior?.snapshots ?? prepared.snapshots,
      prior?.proposals ?? prepared.proposals, capped, { batchSize });
    const identities = new Map(prepared.rows.map(r => [r.snapshot_id, r]));
    const merged = new Map(prior?.retained ?? []);
    for (const a of result.audits) { const r = identities.get(a.snapshot_id); merged.set(a.snapshot_id, { ...a,
      sample_id: r.sample_id, platform: r.platform, rank: r.rank, as_of: r.as_of }); }
    const audits = prepared.rows.map(r => merged.get(r.snapshot_id));
    if (audits.some(a => !a)) throw Error('RESUMED_AUDITS_INCOMPLETE');
    save(path.join(output, 'audits-private.jsonl'), audits.map(JSON.stringify).join('\n') + '\n');
    const after = gateway.summary(), cost = { before, after, purpose_prior_upper_usd: priorPurposeUpper,
      incremental_upper_usd: Math.max(0, totalCost(after) - totalCost(before)), max_purpose_cumulative_usd: maxUsd,
      results: result.model_results.map(({ value: _value, ...r }) => r) };
    save(path.join(output, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');
    return { event: 'focused_verifier_inferred', count: audits.length, retained_completed: prior?.retained.size ?? 0,
      attempted_candidates: result.audits.length,
      verdicts: audits.reduce((a, r) => (a[r.verdict] = (a[r.verdict] ?? 0) + 1, a), {}),
      incremental_upper_usd: cost.incremental_upper_usd, campaign_upper_usd: totalCost(after) };
  } finally { if (owned) fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = {}, names = { '--mode': 'mode', '--export': 'export', '--bundle': 'bundle', '--campaign-directory': 'campaignDirectory',
      '--output': 'output', '--module-root': 'moduleRoot', '--max-usd': 'maxUsd', '--audits': 'audits', '--reference': 'reference',
      '--resume-from': 'resumeFrom', '--batch-size': 'batchSize' };
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = names[process.argv[i]], value = process.argv[i + 1];
      if (!name || value === undefined || Object.hasOwn(opts, name)) throw Error('CLI_ARGUMENT_INVALID');
      opts[name] = ['maxUsd', 'batchSize'].includes(name) ? Number(value) : value;
    }
    if (opts.mode !== 'evaluate' && (opts.reference || opts.audits)) throw Error('REFERENCE_FORBIDDEN_DURING_INFERENCE');
    console.log(JSON.stringify(await runFocusedAblation(opts)));
  } catch (error) {
    console.error(JSON.stringify({ error_code: /^[A-Z][A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'FOCUSED_ABLATION_FAILED' })); process.exitCode = 1;
  }
}
