import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const CAMPAIGN_LEDGERS = [
  { model: 'gemini-3.1-flash-lite', directory: 'model' },
  { model: 'gemini-3.5-flash-lite', directory: 'model-gemini-3.5-flash-lite' },
];
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/u.test(value) ? value : 'UNKNOWN_ERROR_CODE';
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canonical = value => JSON.stringify((function normalize(input) {
  if (Array.isArray(input)) return input.map(normalize);
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  return input;
})(value));
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function inspectionContext(directory) {
  const baseline = JSON.parse(readFileSync(join(directory, 'campaign.json'), 'utf8'));
  const context = campaign => ({ campaign_id: campaign.campaign_id, campaign_version: campaign.version, filter_version: campaign.filter_version });
  const validate = value => { if (![value.campaign_id, value.campaign_version, value.filter_version].every(x => typeof x === 'string' && x.trim())) throw Error('INSPECTION_CONTEXT_INVALID'); return value; };
  const source = validate(context(baseline)), pointerFile = join(directory, 'active-evaluation.json');
  if (!existsSync(pointerFile)) return { context: source, state: 'BASELINE', key: canonical(Object.values(source)) };
  const pointer = JSON.parse(readFileSync(pointerFile, 'utf8'));
  if (pointer.schema_version !== 1 || !/^[a-f0-9]{64}$/u.test(pointer.recipe_sha256) || !['MIGRATING', 'READY_FOR_VERIFICATION'].includes(pointer.state)) throw Error('INSPECTION_ACTIVE_CONTEXT_INVALID');
  const folder = join(directory, 'evaluations', pointer.recipe_sha256), read = name => JSON.parse(readFileSync(join(folder, name), 'utf8'));
  const manifest = read('manifest.json'), campaign = read('campaign.json'), recipe = read('filter-recipe.json'), plan = read('migration-plan.json');
  const active = validate(context(campaign));
  if (digest(manifest) !== pointer.manifest_sha256 || digest(recipe) !== pointer.recipe_sha256 || manifest.recipe_sha256 !== pointer.recipe_sha256 ||
    digest(campaign) !== manifest.campaign_sha256 || digest(plan) !== manifest.plan_sha256 || digest(baseline) !== manifest.baseline_campaign_sha256 ||
    canonical(active) !== canonical(manifest.context) || canonical(source) !== canonical(manifest.source_context)) throw Error('INSPECTION_ACTIVE_CONTEXT_INVALID');
  return { context: active, state: pointer.state, key: canonical(Object.values(active)) };
}
function summarizeAttempts(starts, finishes, skippedPartialTail, now) {
  const age = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Math.max(0, Math.round((now - Date.parse(value)) / 1000)) : null;
  const durations = [...finishes.values()].map(event => ({ event, start: starts.get(event.invocation_id) }))
    .filter(item => item.start).map(({ event, start }) => Date.parse(event.finished_at) - Date.parse(start.started_at)).filter(numeric).sort((a, b) => a - b);
  const codes = {};
  for (const finish of finishes.values()) { const code = finish.error_code == null ? 'SUCCESS' : safeCode(finish.error_code); codes[code] = (codes[code] ?? 0) + 1; }
  const unfinished = [...starts.values()].filter(event => !finishes.has(event.invocation_id));
  const measured = [...finishes.values()].reduce((sum, event) => sum + (event.cost_usd ?? 0), 0);
  const unknown = [...finishes.values()].reduce((sum, event) => sum + (event.unmetered_cost_upper_usd ?? 0), 0);
  const unfinishedUpper = unfinished.reduce((sum, event) => sum + event.reserved_usd, 0);
  return { attempts: starts.size, finished: finishes.size, skipped_partial_tail: skippedPartialTail, result_codes: codes,
    total_cost_usd: measured, total_unmetered_upper_usd: unknown, unfinished_reservation_upper_usd: unfinishedUpper,
    total_cost_upper_usd: measured + unknown + unfinishedUpper,
    latency_ms: { min: durations[0] ?? null, median: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      p95: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null, max: durations.at(-1) ?? null },
    running: unfinished.map(event => ({ model: event.model, purpose: /^[a-zA-Z0-9._-]{1,100}$/u.test(event.purpose ?? '') ? event.purpose : 'UNKNOWN_PURPOSE',
      age_seconds: age(event.started_at), reserved_usd: event.reserved_usd, ledger_state: 'START_WITHOUT_FINISH' })),
    recent: [...finishes.values()].sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at)).slice(-5).map(event => ({ model: event.model,
      finished_age_seconds: age(event.finished_at), code: event.error_code == null ? 'SUCCESS' : safeCode(event.error_code),
      latency_ms: numeric(event.result?.elapsed_ms) ? event.result.elapsed_ms : null, returned_items: Array.isArray(event.result?.value) ? event.result.value.length : null })),
  };
}

/** Both campaign gateway ledgers, including old-model spend after an explicit switch. */
export function summarizeOpportunityLedgers(directory, now = Date.now()) {
  const combinedStarts = new Map(), combinedFinishes = new Map(), parts = [];
  let anyPartial = false;
  for (const source of CAMPAIGN_LEDGERS) {
    const file = join(directory, source.directory, 'model-ledger.jsonl'), starts = new Map(), finishes = new Map();
    const present = existsSync(file), lines = present ? readFileSync(file, 'utf8').split('\n') : [];
    let partial = false;
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue;
      let event;
      try { event = JSON.parse(lines[index]); } catch { if (index === lines.length - 1) { partial = true; continue; } throw Error('MODEL_LEDGER_INVALID'); }
      if (!event || typeof event.invocation_id !== 'string' || !['START', 'FINISH'].includes(event.type)) throw Error('MODEL_LEDGER_INVALID');
      // Model IDs come from the gateway's fixed directory mapping, not arbitrary ledger strings.
      event.model = source.model;
      if (event.type === 'START') {
        if (!numeric(event.reserved_usd)) throw Error('MODEL_LEDGER_COST_INVALID');
        if (!starts.has(event.invocation_id)) starts.set(event.invocation_id, event);
      } else {
        if ((event.cost_usd !== null && !numeric(event.cost_usd)) || !numeric(event.unmetered_cost_upper_usd ?? 0)) throw Error('MODEL_LEDGER_COST_INVALID');
        if (!finishes.has(event.invocation_id)) finishes.set(event.invocation_id, event);
      }
    }
    // Invocation identities are ledger-local for diagnostics; do not merge two models' attempts.
    for (const [id, event] of starts) combinedStarts.set(source.model + ':' + id, { ...event, invocation_id: source.model + ':' + id });
    for (const [id, event] of finishes) combinedFinishes.set(source.model + ':' + id, { ...event, invocation_id: source.model + ':' + id });
    parts.push({ model: source.model, ledger_present: present, ...summarizeAttempts(starts, finishes, partial, now) }); anyPartial ||= partial;
  }
  const combined = summarizeAttempts(combinedStarts, combinedFinishes, anyPartial, now);
  return { ...combined, by_model: parts,
    combined_cost: { measured_cost_usd: combined.total_cost_usd, finished_usage_unknown_upper_usd: combined.total_unmetered_upper_usd,
      unfinished_attempts_upper_usd: combined.unfinished_reservation_upper_usd, total_upper_usd: combined.total_cost_upper_usd },
    unfinished_note: 'START without FINISH may be in flight or interrupted. Reserve its full upper bound; ledger-only inspection cannot distinguish these states.' };
}

/** Aggregate-only live diagnostic. Never opens the writer or repairs/truncates journals. */
export function inspectOpportunityRun(latestFile) {
  const now = Date.now(), run = JSON.parse(readFileSync(latestFile, 'utf8'));
  const directory = join(run.outputDirectory, 'opportunity');
  const progress = JSON.parse(readFileSync(join(directory, 'progress.json'), 'utf8'));
  const evaluation = inspectionContext(directory), parameters = Object.values(evaluation.context);
  const jobContext = "json_extract(j.payload,'$.campaign_id')=? AND json_extract(j.payload,'$.campaign_version')=? AND json_extract(j.payload,'$.filter_version')=?";
  const age = value => value ? Math.max(0, Math.round((now - Date.parse(value)) / 1000)) : null;
  const db = new DatabaseSync(join(directory, 'store', 'conversations.sqlite'), { readOnly: true });
  let database;
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    database = {
      watermark: db.prepare('SELECT MAX(sequence) AS sequence FROM applied_events').get(),
      roots: db.prepare(`SELECT c.platform,COUNT(*) AS roots,MAX(c.revision) AS maximum_revision,SUM(c.revision-1) AS extra_revisions,
        SUM(json_array_length(s.payload,'$.comments')) AS comments FROM campaign_roots cr JOIN conversations c ON c.platform=cr.platform AND c.root_post_id=cr.root_post_id
        JOIN snapshots s ON s.id=c.snapshot_id WHERE cr.context_key=? GROUP BY c.platform`).all(evaluation.key),
      current_decisions: db.prepare(`SELECT c.platform,CASE WHEN d.snapshot_id=c.snapshot_id THEN d.classification ELSE NULL END AS classification,
        CASE WHEN d.snapshot_id=c.snapshot_id THEN d.assessment_status ELSE 'MISSING_OR_STALE' END AS assessment_status,COUNT(*) AS count
        FROM campaign_roots cr JOIN conversations c ON c.platform=cr.platform AND c.root_post_id=cr.root_post_id
        LEFT JOIN current_decisions cd ON cd.context_key=cr.context_key AND cd.platform=c.platform AND cd.root_post_id=c.root_post_id
        LEFT JOIN decisions d ON d.id=cd.decision_id WHERE cr.context_key=? GROUP BY 1,2,3`).all(evaluation.key),
      jobs: db.prepare(`SELECT j.type,j.state,COALESCE(s.platform,json_extract(j.payload,'$.platform')) AS platform,
        COUNT(*) AS count,MIN(j.created_at) AS oldest_created_at,MAX(j.updated_at) AS latest_updated_at,
        SUM(CASE WHEN j.type='CLASSIFY' AND c.snapshot_id IS NOT NULL AND c.snapshot_id<>s.id THEN 1 ELSE 0 END) AS stale_snapshot_jobs,
        MAX(j.attempts) AS maximum_attempts FROM jobs j LEFT JOIN snapshots s ON s.id=json_extract(j.payload,'$.snapshot_id')
        LEFT JOIN conversations c ON c.platform=s.platform AND c.root_post_id=s.root_post_id WHERE ${jobContext} GROUP BY 1,2,3`).all(...parameters)
        .map(({ oldest_created_at, latest_updated_at, ...row }) => ({ ...row, oldest_created_age_seconds: age(oldest_created_at), latest_update_age_seconds: age(latest_updated_at) })),
      active_classifier: db.prepare(`SELECT s.platform,j.state,j.priority,j.attempts,s.revision,s.id=c.snapshot_id AS current_snapshot,j.created_at,j.updated_at,j.lease_until
        FROM jobs j LEFT JOIN snapshots s ON s.id=json_extract(j.payload,'$.snapshot_id') LEFT JOIN conversations c ON c.platform=s.platform AND c.root_post_id=s.root_post_id
        WHERE j.type IN ('CLASSIFY','VERIFY') AND j.state='RUNNING' AND ${jobContext} ORDER BY j.priority DESC,j.created_at,j.id LIMIT 16`).all(...parameters)
        .map(({ created_at, updated_at, lease_until, ...row }) => ({ ...row, queued_age_seconds: age(created_at), running_age_seconds: age(updated_at), lease_seconds_remaining: Math.round((Date.parse(lease_until) - now) / 1000) })),
      next_classifier: db.prepare(`SELECT s.platform,j.state,j.priority,j.attempts,s.revision,s.id=c.snapshot_id AS current_snapshot,j.created_at
        FROM jobs j LEFT JOIN snapshots s ON s.id=json_extract(j.payload,'$.snapshot_id') LEFT JOIN conversations c ON c.platform=s.platform AND c.root_post_id=s.root_post_id
        WHERE j.type IN ('CLASSIFY','VERIFY') AND j.state IN ('PENDING','RETRY') AND ${jobContext} ORDER BY j.priority DESC,j.created_at,j.id LIMIT 8`).all(...parameters)
        .map(({ created_at, ...row }) => ({ ...row, queued_age_seconds: age(created_at) })),
      decision_history: db.prepare(`SELECT COUNT(*) AS count,SUM(CASE WHEN d.snapshot_id<>c.snapshot_id THEN 1 ELSE 0 END) AS superseded_snapshot_decisions,
        MAX(json_extract(d.payload,'$.created_at')) AS latest_at FROM decisions d JOIN conversations c ON c.platform=d.platform AND c.root_post_id=d.root_post_id WHERE d.context_key=?`).get(evaluation.key),
    };
    db.exec('COMMIT');
  } finally { db.close(); }
  const blank = () => ({ raw: 0, comments: 0, suitable: 0, notYet: 0, unrelated: 0, pending: 0, failed: 0 });
  const counts = blank(), byPlatform = { facebook: blank(), threads: blank() };
  for (const row of database.roots) { byPlatform[row.platform].raw = row.roots; byPlatform[row.platform].comments = row.comments ?? 0; }
  for (const row of database.current_decisions) {
    const key = row.assessment_status === 'ASSESSED' ? { SUITABLE: 'suitable', NOT_YET: 'notYet', UNRELATED: 'unrelated' }[row.classification] ?? 'pending' : row.assessment_status === 'FAILED' ? 'failed' : 'pending';
    byPlatform[row.platform][key] += row.count;
  }
  for (const source of Object.values(byPlatform)) for (const key of Object.keys(counts)) counts[key] += source[key];
  return {
    observed_at: new Date(now).toISOString(), run_id: run.id, run_state: run.state, run_age_seconds: age(run.startedAt),
    evaluation, progress: { counts, byPlatform, phase: evaluation.state === 'BASELINE' ? progress.phase : evaluation.state, lastError: evaluation.state === 'BASELINE' ? progress.lastError : null,
      costUsd: progress.costUsd, costUpperUsd: progress.costUpperUsd }, database,
    model: summarizeOpportunityLedgers(directory, now),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const latestFile = process.argv[2] ?? join(process.env.APPDATA, 'csd-desktop', 'data', 'latest-run.json');
    console.log(JSON.stringify(inspectOpportunityRun(latestFile), null, 2));
  } catch (error) { console.error(/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'READ_ONLY_INSPECTION_FAILED'); process.exitCode = 1; }
}
