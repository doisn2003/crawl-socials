// Offline preparation only: no Electron import, network, profile read or live run creation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const inputFiles = [
  '.brain/decisions/ADR-009-source-probe-operational-limits.md',
  '.brain/specs/benchmark_protocol.md',
  '.brain/specs/benchmark_manifest.template.json',
  '.brain/specs/campaign.coffee.json',
  '.brain/specs/source_access_matrix.md',
  '.brain/specs/facebook_source_probe_runbook.md',
  '.brain/evidence/facebook-browser-route-assessment-2026-10-27.md',
];
const decisionRef = 'evidence://lead-probe-limits-2026-10-27';
const assessmentRef = 'evidence://facebook-browser-assessment-2026-10-27';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = inputFiles.map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) }));
const campaign = JSON.parse(readFileSync(resolve(root, '.brain/specs/campaign.coffee.json'), 'utf8'));
const selectedQueries = ['quán cà phê', 'cafe Hà Nội', 'Tiny Cafe'];
if (!selectedQueries.every(query => campaign.workload.keywords.includes(query))) throw new Error('PREPARATION_WORKLOAD_CHANGED');

const plan = {
  preparation_version: '1.0.0', status: 'DRAFT_PREPARATION', task: 'P02.02_OFFLINE',
  execution_authorized: false, gate_evaluated: false, live_observations: 0,
  run_id: null, started_at: null, deadline_at: null, freeze_sha256: null,
  route_id: 'FB_BROWSER_PUBLIC_SEARCH', planned_capture_mode: 'LIVE', planned_temperature: 'COLD',
  campaign_id: campaign.campaign_id, selected_queries: selectedQueries,
  operational_decision: { status: 'LEAD_DECIDED', ref: decisionRef, decision_maker: 'lead /root',
    runtime_binding: 'NOT_BOUND_UNTIL_IMPLEMENTED_AND_REVIEWED', user_approval_claimed: false },
  limits_to_enforce: {
    max_wall_time_seconds: 1800, max_candidates: 100, max_actions: 20,
    request_unit: 'CONTROLLED_COLLECTION_ACTION', max_queries: 3, max_batches_per_query: 5,
    max_storage_mb: 50, max_operator_seconds: 600, max_retries_per_batch: 1,
    no_progress_batches: 2, currency: 'VND', max_external_cost: 0,
  },
  data_policy_to_apply: { decision_ref: decisionRef, purpose: 'TECHNICAL_SOURCE_FEASIBILITY',
    export_scope: 'LOCAL_ONLY', output_formats: ['JSONL', 'JSON_SUMMARY'], retention_days: 7,
    retention_scheduler_exists: false, raw_social_data_in_brain: false, credentials_in_evidence: false },
  storage_plan: {
    runtime_base: 'APPDATA/csd-desktop', relative_run_directory: 'source-probes/<run_id>',
    symbolic_storage_ref: 'csd-userdata://source-probes/<run_id>',
    directories_created: false, requires_resolved_path_outside_repository: true,
    files: ['manifest.json', 'evidence-map.json', 'observations.jsonl', 'events.jsonl', 'snapshot.json', 'summary.json'],
  },
  evidence_map: [
    { ref: decisionRef, path: inputFiles[0], kind: 'OPERATIONAL_DECISION', permission_grant: false },
    { ref: assessmentRef, path: inputFiles[6], kind: 'ROUTE_ASSESSMENT', permission_grant: false },
  ],
  pending_inputs: [
    { code: 'PROBE_CONTROLLER_INTEGRATION', owner: 'lead assigns after P01.03 ownership returns',
      details: 'Reuse existing main/browser host: counters, global deadline, sanitizer, writer, Start/Stop; no second host' },
    { code: 'AUTOMATED_ROUTE_CONDITIONS', owner: 'lead',
      details: 'Assessment has no CSD platform permission evidence; resolve disposition on actual basis, not a boolean approval substitute' },
    { code: 'SESSION_SETUP_EVIDENCE', owner: 'operator with lead coordination',
      details: 'CSD profile manual setup; no cookie/token export; do not claim verified account binding' },
    { code: 'PIN_ARTIFACTS_AT_START', owner: 'probe host after reviewed build',
      fields: ['built_code_manifest_sha256', 'effective_configuration_sha256', 'canonical_campaign_sha256',
        'source_matrix_sha256', 'assessment_sha256', 'runtime_versions', 'adapter_version', 'parser_version',
        'rubric_version', 'session_evidence_ref', 'route_disposition_ref'] },
  ],
  stable_preparation_input_hashes: inputs,
  hash_semantics: 'Exact preparation document bytes only; not frozen code/config or a run manifest',
};

const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === '--output')) throw new Error('PREPARATION_ARGUMENTS_INVALID');
const content = JSON.stringify(plan, null, 2) + '\n';
if (args.length) {
  const output = resolve(root, args[1]);
  const evidenceDirectory = realpathSync(resolve(root, '.brain/evidence'));
  if (realpathSync(dirname(output)) !== evidenceDirectory || !/^facebook_source_probe_[a-zA-Z0-9_-]+\.json$/.test(basename(output))) {
    throw new Error('PREPARATION_OUTPUT_DENIED');
  }
  if (existsSync(output)) {
    if (readFileSync(output, 'utf8') !== content) throw new Error('PREPARATION_OUTPUT_EXISTS_USE_NEW_NAME');
  } else writeFileSync(output, content, { flag: 'wx', encoding: 'utf8' });
  console.log(JSON.stringify({ status: plan.status, output, execution_authorized: false, gate_evaluated: false,
    pending_inputs: plan.pending_inputs.map(input => input.code), live_observations: 0 }, null, 2));
} else process.stdout.write(content);
