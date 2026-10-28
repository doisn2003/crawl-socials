// Read-only protocol checks. This is not a crawler, permission verifier or G00/G02 evaluator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = ['PAGE', 'PUBLIC_GROUP', 'PUBLIC_PERSONAL'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ref = value => typeof value === 'string' && /^(?:evidence|fixture):\/\/[a-zA-Z0-9/_-]+$/.test(value);
const storageRef = value => typeof value === 'string' && /^csd-userdata:\/\/[a-zA-Z0-9/_-]+$/.test(value);
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction) => '.' + (fraction ?? '').padEnd(3, '0') + 'Z');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function digest(value) { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function freezeDigest(value) { const copy = { ...value }; delete copy.freeze_sha256; return digest(copy); }
function containsSecretField(value) {
  if (Array.isArray(value)) return value.some(containsSecretField);
  return object(value) && Object.entries(value).some(([key, entry]) =>
    /^(?:cookie|cookies|password|authorization|access_token|refresh_token|proxy_password)$/i.test(key) || containsSecretField(entry));
}
function words(value) {
  return Array.isArray(value) && value.length > 0 && value.every(text)
    && new Set(value.map(word => word.normalize('NFC').trim())).size === value.length;
}

export function checkProtocolBundle(bundle) {
  const errors = new Set();
  const require = (condition, code) => { if (!condition) errors.add(code); };
  if (!object(bundle) || !object(bundle.manifest) || !object(bundle.campaign) || !object(bundle.execution)) return ['BUNDLE_INVALID'];
  const { manifest: m, campaign: c, execution: e, previous: p, snapshot: s } = bundle;
  const sections = ['campaign', 'versions', 'clock', 'budgets', 'data_policy'];
  if (!sections.every(key => object(m[key]))) return ['MANIFEST_SHAPE_INVALID'];
  require(!containsSecretField(m), 'SECRETS_FORBIDDEN');
  require(m.protocol_version === '1.0.0', 'PROTOCOL_VERSION_INVALID');
  require(m.status === 'FROZEN', 'MANIFEST_NOT_FROZEN');
  require(text(m.run_id), 'RUN_ID_MISSING');
  require(['SOURCE_PROBE', 'BENCHMARK'].includes(m.run_kind), 'RUN_KIND_INVALID');
  require(['COLD', 'WARM'].includes(m.run_temperature), 'RUN_TEMPERATURE_INVALID');
  require(m.platform === 'FACEBOOK' && c.platform === 'FACEBOOK'
    && m.collection_scope === 'PUBLIC_DISCOVERY' && c.collection_scope === 'PUBLIC_DISCOVERY', 'SCOPE_MISMATCH');
  require(m.campaign.campaign_id === c.campaign_id && m.campaign.contract_version === '1.0.0'
    && c.contract_version === '1.0.0' && c.schema_version === '1.0.0', 'CAMPAIGN_VERSION_MISMATCH');
  require(hash(m.campaign.sha256) && m.campaign.sha256 === digest(c), 'CAMPAIGN_DIGEST_MISMATCH');
  require(c.target?.valid_unique_posts === 1000 && c.target?.max_wall_time_seconds === 86400, 'TARGET_CHANGED');
  require(object(c.source_requirements) && sources.every(source => c.source_requirements[source]?.in_scope === true
    && c.source_requirements[source]?.minimum_valid_unique_posts === 1), 'SOURCE_REQUIREMENTS_CHANGED');
  require(words(c.workload?.keywords) && words(m.selected_queries), 'QUERY_LIST_INVALID');
  if (words(c.workload?.keywords) && words(m.selected_queries)) {
    const initial = c.workload.keywords.map(word => word.normalize('NFC').trim());
    require(m.selected_queries.every(word => initial.includes(word.normalize('NFC').trim())), 'INITIAL_QUERY_OUTSIDE_CAMPAIGN');
  }
  require(c.discovery_policy?.expansion_rule_version === 'coffee-intent-v1'
    && m.versions.rubric_version === 'coffee-intent-v1', 'RUBRIC_VERSION_MISSING');
  for (const key of ['code_sha256', 'configuration_sha256', 'source_matrix_sha256']) {
    require(hash(m.versions[key]), 'ARTIFACT_DIGEST_MISSING');
    require(m.versions[key] === e.artifact_digests?.[key], 'EXECUTION_ARTIFACT_MISMATCH');
  }
  require(['adapter_id', 'adapter_version', 'parser_version'].every(key => text(m.versions[key])
    && !['unversioned', 'unknown', 'pending'].includes(m.versions[key].toLowerCase())), 'IMPLEMENTATION_VERSION_MISSING');
  require(hash(m.freeze_sha256) && m.freeze_sha256 === freezeDigest(m), 'MANIFEST_DIGEST_MISMATCH');
  require(e.manifest_sha256 === m.freeze_sha256 && e.run_id === m.run_id, 'EXECUTION_BINDING_MISMATCH');
  require(m.capture_mode === 'LIVE' && e.capture_mode === 'LIVE'
    && ['BROWSER', 'OFFICIAL_API', 'PROVIDER_REQUEST'].includes(e.origin)
    && e.acquired_in_this_run === true, 'NON_LIVE_EXECUTION');
  require(['START', 'RESUME', 'AUDIT'].includes(e.stage), 'EXECUTION_STAGE_INVALID');

  require(Array.isArray(m.seed_lineage), 'SEED_LINEAGE_INVALID');
  if (Array.isArray(m.seed_lineage)) for (const seed of m.seed_lineage) {
    if (!object(seed)) { errors.add('SEED_LINEAGE_INVALID'); continue; }
    require(seed.kind === 'SOURCE' && sources.includes(seed.source_type) && ref(seed.origin_ref)
      && ref(seed.source_proof_ref) && utc(seed.verified_at), 'SEED_LINEAGE_INVALID');
    try {
      const url = new URL(seed.source_url);
      require(url.protocol === 'https:' && ['facebook.com', 'www.facebook.com'].includes(url.hostname)
        && url.username === '' && url.password === '' && url.port === '', 'SEED_URL_INVALID');
      require(!/\/(?:posts\/|permalink\.php|story\.php)/i.test(url.pathname), 'POST_SEED_FORBIDDEN');
      require(![...url.searchParams.keys()].some(key => /token|password|authorization|signature|session/i.test(key)), 'SECRET_URL_FORBIDDEN');
    } catch { errors.add('SEED_URL_INVALID'); }
    if (m.run_temperature === 'COLD') require(seed.prior_post_dataset_loaded !== true, 'COLD_RUN_PRELOADED');
  }
  // Warm history may aid discovery, but run output still starts empty and needs fresh observations.
  require(e.preloaded_post_count === 0, 'PRELOADED_POSTS_FORBIDDEN');

  const readySources = new Set();
  let selectedRouteCount = 0;
  require(Array.isArray(m.source_readiness) && m.source_readiness.length > 0, 'SOURCE_READINESS_MISSING');
  if (Array.isArray(m.source_readiness)) for (const route of m.source_readiness) {
    if (!object(route)) { errors.add('SOURCE_READINESS_INVALID'); continue; }
    const validSourceTypes = Array.isArray(route.source_types) && route.source_types.length > 0
      && route.source_types.every(type => sources.includes(type));
    require(text(route.route_id) && validSourceTypes, 'SOURCE_READINESS_INVALID');
    require(['UNPROBED', 'OBSERVED'].includes(route.technical_status)
      && ['UNPROVEN', 'OBSERVED'].includes(route.product_fit), 'SOURCE_READINESS_INVALID');
    const ready = ['READY', 'ANONYMOUS'].includes(route.session_status) && ref(route.session_evidence_ref)
      && route.permission_status === 'DOCUMENTED' && ref(route.permission_assessment_ref);
    const selected = route.route_id === m.versions.adapter_id;
    if (selected) selectedRouteCount++;
    // Evidence for a different route cannot make the selected adapter ready.
    if (selected && ready && validSourceTypes) {
      if (m.run_kind !== 'BENCHMARK' || (route.technical_status === 'OBSERVED' && ref(route.technical_evidence_ref))) {
        route.source_types.forEach(source => readySources.add(source));
      }
    }
  }
  require(selectedRouteCount === 1, 'SELECTED_ROUTE_BINDING_INVALID');
  require(readySources.size > 0, 'NO_SOURCE_READY_FOR_PROBE');
  if (m.run_kind === 'BENCHMARK') {
    require(sources.every(source => readySources.has(source)), 'BENCHMARK_SOURCE_EVIDENCE_MISSING');
    require(c.mode === 'BENCHMARK' && c.workload?.confirmation === 'USER_CONFIRMED'
      && Array.isArray(c.open_questions) && c.open_questions.length === 0, 'BENCHMARK_CAMPAIGN_UNRESOLVED');
    require(e.gates?.G00 === 'PASS' && e.gates?.G01 === 'PASS' && ref(e.gates?.evidence_ref), 'BENCHMARK_GATE_EVIDENCE_MISSING');
  }

  const clock = m.clock;
  require(utc(clock.started_at) && utc(clock.deadline_at) && integer(clock.max_wall_time_seconds, 1), 'CLOCK_INVALID');
  require(clock.policy === 'INCLUDES_PAUSE_SLEEP_RETRY_RELOGIN_RESTART' && clock.anomaly_policy === 'STOP'
    && typeof clock.drift_threshold_seconds === 'number' && Number.isFinite(clock.drift_threshold_seconds)
    && clock.drift_threshold_seconds > 0, 'CLOCK_POLICY_INVALID');
  if (utc(clock.started_at) && utc(clock.deadline_at)) {
    require(Date.parse(clock.deadline_at) - Date.parse(clock.started_at) === clock.max_wall_time_seconds * 1000, 'DEADLINE_RESET_OR_INVALID');
    if (m.run_kind === 'BENCHMARK') require(clock.max_wall_time_seconds === 86400, 'BENCHMARK_DURATION_CHANGED');
  }
  require(e.started_at === clock.started_at && e.deadline_at === clock.deadline_at, 'EXECUTION_CLOCK_MISMATCH');
  require(utc(e.now_utc) && typeof e.elapsed_seconds === 'number' && Number.isFinite(e.elapsed_seconds) && e.elapsed_seconds >= 0, 'EXECUTION_CLOCK_INVALID');
  require(e.clock_status === 'TRUSTED', 'CLOCK_UNCERTAIN');
  if (e.stage !== 'AUDIT' && utc(e.now_utc) && utc(clock.started_at) && utc(clock.deadline_at)) {
    require(Date.parse(e.now_utc) >= Date.parse(clock.started_at), 'CLOCK_BACKWARDS');
    require(Date.parse(e.now_utc) < Date.parse(clock.deadline_at), 'COLLECTION_DEADLINE_PASSED');
    require(e.elapsed_seconds >= (Date.parse(e.now_utc) - Date.parse(clock.started_at)) / 1000, 'ELAPSED_TIME_RESET');
    require(e.elapsed_seconds < clock.max_wall_time_seconds, 'COLLECTION_DEADLINE_PASSED');
  }
  if (e.stage === 'RESUME') {
    require(object(p), 'PREVIOUS_STATE_MISSING');
    if (object(p)) {
      require(p.run_id === m.run_id && p.manifest_sha256 === m.freeze_sha256
        && p.started_at === clock.started_at && p.deadline_at === clock.deadline_at, 'RESTART_MUTATED_MANIFEST');
      const checkpointClockValid = utc(p.last_seen_at) && typeof p.elapsed_seconds === 'number'
        && Number.isFinite(p.elapsed_seconds) && p.elapsed_seconds >= 0;
      require(checkpointClockValid, 'CHECKPOINT_CLOCK_INVALID');
      if (checkpointClockValid && utc(clock.started_at) && utc(clock.deadline_at)) {
        const checkpointWallElapsed = (Date.parse(p.last_seen_at) - Date.parse(clock.started_at)) / 1000;
        require(checkpointWallElapsed >= 0 && Date.parse(p.last_seen_at) <= Date.parse(clock.deadline_at)
          && p.elapsed_seconds >= checkpointWallElapsed, 'CHECKPOINT_CLOCK_INVALID');
        require(p.elapsed_seconds - checkpointWallElapsed <= clock.drift_threshold_seconds, 'CLOCK_UNCERTAIN');
        require(p.elapsed_seconds < clock.max_wall_time_seconds
          && Date.parse(p.last_seen_at) < Date.parse(clock.deadline_at), 'COLLECTION_DEADLINE_PASSED');
        if (utc(e.now_utc)) {
          const downtime = (Date.parse(e.now_utc) - Date.parse(p.last_seen_at)) / 1000;
          require(downtime >= 0, 'CLOCK_BACKWARDS');
          if (downtime >= 0) {
            // Preserve high-water elapsed, including drift already accumulated before restart.
            const minimumElapsed = p.elapsed_seconds + downtime;
            require(e.elapsed_seconds >= minimumElapsed, 'ELAPSED_TIME_RESET');
            require(minimumElapsed < clock.max_wall_time_seconds, 'COLLECTION_DEADLINE_PASSED');
          }
        }
      }
    }
  }

  const b = m.budgets;
  require(b.status === 'CONFIRMED' && ref(b.decision_ref), 'BUDGETS_NOT_CONFIRMED');
  require(b.currency === c.budgets?.currency && /^[A-Z]{3}$/.test(b.currency ?? '')
    && typeof b.max_external_cost === 'number' && Number.isFinite(b.max_external_cost) && b.max_external_cost >= 0, 'COST_BUDGET_INVALID');
  require(b.request_unit === 'CONTROLLED_COLLECTION_ACTION', 'REQUEST_UNIT_INVALID');
  require(['max_requests', 'max_queries', 'max_batches_per_query', 'max_candidates', 'max_storage_mb', 'no_progress_batches']
    .every(key => integer(b[key], 1)) && integer(b.max_operator_seconds) && integer(b.max_retries_per_batch), 'BUDGET_LIMIT_INVALID');
  require(Array.isArray(m.selected_queries) && m.selected_queries.length <= b.max_queries, 'QUERY_BUDGET_EXCEEDED');
  const d = m.data_policy;
  require(d.status === 'CONFIRMED' && ref(d.decision_ref), 'DATA_POLICY_NOT_CONFIRMED');
  require(text(d.purpose) && storageRef(d.storage_ref) && integer(d.retention_days, 1)
    && Array.isArray(d.output_formats) && d.output_formats.length > 0
    && d.output_formats.every(format => ['JSONL', 'JSON_SUMMARY', 'CSV'].includes(format))
    && d.export_scope === 'LOCAL_ONLY' && d.credentials_in_evidence === false
    && d.raw_social_data_in_brain === false, 'DATA_POLICY_INVALID');

  if (e.stage === 'AUDIT' || s !== undefined) {
    require(object(s), 'SNAPSHOT_MISSING');
    if (object(s)) {
      require(s.run_id === m.run_id && s.manifest_sha256 === m.freeze_sha256, 'SNAPSHOT_BINDING_MISMATCH');
      require(utc(s.cutoff_at) && utc(e.actual_stop_at), 'CUTOFF_INVALID');
      if (utc(s.cutoff_at) && utc(e.actual_stop_at) && utc(clock.deadline_at)) {
        require(Date.parse(s.cutoff_at) === Math.min(Date.parse(e.actual_stop_at), Date.parse(clock.deadline_at))
          && Date.parse(s.cutoff_at) >= Date.parse(clock.started_at), 'CUTOFF_INVALID');
      }
      require(Array.isArray(s.members), 'SNAPSHOT_MEMBERS_INVALID');
      const claimedValid = bundle.claimed_valid_ids;
      require(Array.isArray(claimedValid) && claimedValid.every(text)
        && new Set(claimedValid).size === claimedValid.length, 'CLAIMED_VALID_IDS_INVALID');
      if (Array.isArray(s.members)) {
        const identities = new Set(s.members.map(member => member?.identity));
        if (Array.isArray(claimedValid)) require(claimedValid.every(id => identities.has(id)), 'CLAIM_OUTSIDE_SNAPSHOT');
        require(hash(s.membership_sha256) && s.membership_sha256 === digest(s.members.map(member => member?.identity)), 'MEMBERSHIP_DIGEST_MISMATCH');
        require(new Set(s.members.map(member => member?.identity)).size === s.members.length, 'DUPLICATE_SNAPSHOT_IDENTITY');
        for (const member of s.members) {
          if (!object(member)) { errors.add('SNAPSHOT_MEMBER_INVALID'); continue; }
          require(text(member.identity) && text(member.observation_id) && text(member.record_version)
            && hash(member.record_sha256) && ref(member.record_ref), 'SNAPSHOT_VERSION_MISSING');
          require(member.capture_mode === 'LIVE' && e.capture_mode === 'LIVE', 'NON_LIVE_SNAPSHOT_MEMBER');
          const acceptedClaim = Array.isArray(claimedValid) && claimedValid.includes(member.identity);
          if (acceptedClaim) {
            require(sources.includes(member.source_type) && member.visibility === 'PUBLIC', 'SNAPSHOT_SOURCE_UNVERIFIED');
            require(member.required_fields_complete === true, 'SNAPSHOT_FIELDS_INCOMPLETE');
            require(Array.isArray(member.evidence) && member.evidence.length > 0, 'SNAPSHOT_EVIDENCE_MISSING');
          }
          require(utc(member.observed_at) && utc(member.persisted_at), 'OBSERVATION_CLOCK_INVALID');
          if (utc(member.observed_at) && utc(member.persisted_at) && utc(s.cutoff_at)) require(
            Date.parse(member.observed_at) >= Date.parse(clock.started_at)
            && Date.parse(member.observed_at) <= Date.parse(member.persisted_at)
            && Date.parse(member.persisted_at) <= Date.parse(s.cutoff_at), 'OBSERVATION_OUTSIDE_CUTOFF');
          require(Array.isArray(member.evidence), 'SNAPSHOT_EVIDENCE_MISSING');
          if (Array.isArray(member.evidence)) for (const evidence of member.evidence) {
            require(object(evidence) && ref(evidence.ref) && text(evidence.version) && hash(evidence.sha256)
              && utc(evidence.persisted_at), 'SNAPSHOT_EVIDENCE_MISSING');
            if (object(evidence) && utc(evidence.persisted_at) && utc(s.cutoff_at)) require(
              Date.parse(evidence.persisted_at) >= Date.parse(clock.started_at)
              && Date.parse(evidence.persisted_at) <= Date.parse(s.cutoff_at), 'EVIDENCE_OUTSIDE_CUTOFF');
          }
        }
      }
      require(hash(s.freeze_sha256) && s.freeze_sha256 === freezeDigest(s)
        && s.freeze_sha256 === e.snapshot_sha256, 'SNAPSHOT_DIGEST_MISMATCH');
    }
  }
  return [...errors].sort();
}

function read(path) { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
function syntheticBundle() {
  const manifest = read('.brain/specs/benchmark_manifest.template.json');
  const campaign = read('.brain/specs/campaign.coffee.json');
  manifest.status = 'FROZEN'; manifest.run_id = 'synthetic-run-not-executable';
  manifest.campaign.sha256 = digest(campaign);
  manifest.versions = { ...manifest.versions, code_sha256: 'a'.repeat(64), configuration_sha256: 'b'.repeat(64),
    source_matrix_sha256: 'c'.repeat(64), adapter_version: 'synthetic-1', parser_version: 'synthetic-1' };
  manifest.clock.started_at = '2026-10-27T00:00:00.000Z'; manifest.clock.deadline_at = '2026-10-27T00:30:00.000Z';
  manifest.budgets.status = 'CONFIRMED'; manifest.budgets.decision_ref = 'fixture://not-a-real-approval';
  manifest.data_policy.status = 'CONFIRMED'; manifest.data_policy.decision_ref = 'fixture://not-a-real-policy';
  manifest.data_policy.storage_ref = 'csd-userdata://synthetic-only';
  Object.assign(manifest.source_readiness[0], { session_status: 'READY', session_evidence_ref: 'fixture://not-a-real-session',
    permission_status: 'DOCUMENTED', permission_assessment_ref: 'fixture://not-a-real-permission' });
  manifest.freeze_sha256 = freezeDigest(manifest);
  const execution = { stage: 'START', run_id: manifest.run_id, manifest_sha256: manifest.freeze_sha256,
    started_at: manifest.clock.started_at, deadline_at: manifest.clock.deadline_at,
    now_utc: manifest.clock.started_at, elapsed_seconds: 0, clock_status: 'TRUSTED',
    capture_mode: 'LIVE', origin: 'BROWSER', acquired_in_this_run: true, preloaded_post_count: 0,
    artifact_digests: { code_sha256: manifest.versions.code_sha256, configuration_sha256: manifest.versions.configuration_sha256,
      source_matrix_sha256: manifest.versions.source_matrix_sha256 } };
  return { fixture_only: true, manifest, campaign, execution };
}
function addSnapshot(bundle) {
  const { manifest: m, execution: e } = bundle;
  e.stage = 'AUDIT'; e.now_utc = '2026-10-28T00:00:00.000Z'; e.actual_stop_at = m.clock.deadline_at;
  const snapshot = { run_id: m.run_id, manifest_sha256: m.freeze_sha256, cutoff_at: m.clock.deadline_at,
    members: [{ identity: 'FACEBOOK:synthetic-post', observation_id: 'synthetic-observation', source_type: 'PAGE', visibility: 'PUBLIC',
      capture_mode: 'LIVE', record_ref: 'fixture://record', record_version: '1', record_sha256: 'd'.repeat(64),
      observed_at: '2026-10-27T00:01:00.000Z', persisted_at: '2026-10-27T00:01:01.000Z', required_fields_complete: true,
      evidence: [{ ref: 'fixture://evidence', version: '1', sha256: 'e'.repeat(64), persisted_at: '2026-10-27T00:01:01.000Z' }] }] };
  snapshot.membership_sha256 = digest(snapshot.members.map(member => member.identity));
  snapshot.freeze_sha256 = freezeDigest(snapshot); e.snapshot_sha256 = snapshot.freeze_sha256;
  bundle.snapshot = snapshot;
  bundle.claimed_valid_ids = ['FACEBOOK:synthetic-post'];
}
function setPath(value, path, replacement) {
  let cursor = value;
  for (const part of path.slice(0, -1)) cursor = cursor[part];
  cursor[path.at(-1)] = replacement;
}
function addResume(bundle) {
  bundle.execution.stage = 'RESUME'; bundle.execution.now_utc = '2026-10-27T00:10:00.000Z'; bundle.execution.elapsed_seconds = 600;
  bundle.previous = { run_id: bundle.manifest.run_id, manifest_sha256: bundle.manifest.freeze_sha256,
    started_at: bundle.manifest.clock.started_at, deadline_at: bundle.manifest.clock.deadline_at,
    last_seen_at: '2026-10-27T00:05:00.000Z', elapsed_seconds: 300 };
}
function refreezeSyntheticManifest(bundle) {
  bundle.manifest.freeze_sha256 = freezeDigest(bundle.manifest);
  bundle.execution.manifest_sha256 = bundle.manifest.freeze_sha256;
}
function selfTest() {
  const results = [];
  const check = (name, body) => { body(); results.push(name); };
  check('synthetic probe permits UNPROBED capability and UNPROVEN fit without circular gate', () => {
    assert.deepEqual(checkProtocolBundle(syntheticBundle()), []);
  });
  check('draft template cannot be treated as frozen live manifest', () => {
    const bundle = syntheticBundle(); bundle.manifest = read('.brain/specs/benchmark_manifest.template.json');
    const errors = checkProtocolBundle(bundle);
    for (const code of ['MANIFEST_NOT_FROZEN', 'BUDGETS_NOT_CONFIRMED', 'DATA_POLICY_NOT_CONFIRMED', 'NO_SOURCE_READY_FOR_PROBE']) assert.ok(errors.includes(code), code);
  });
  for (const fixture of read('tests/fixtures/protocol/invalid-cases.json')) check(fixture.name, () => {
    const bundle = syntheticBundle();
    if (fixture.base === 'AUDIT') addSnapshot(bundle);
    if (fixture.base === 'RESUME') addResume(bundle);
    for (const mutation of fixture.mutations) setPath(bundle, mutation.path, mutation.value);
    const errors = checkProtocolBundle(bundle);
    assert.ok(errors.includes(fixture.expected), fixture.name + ': ' + errors.join(','));
  });
  check('R04 resume preserves high-water plus downtime below drift threshold', () => {
    const bundle = syntheticBundle(); addResume(bundle); bundle.previous.elapsed_seconds = 301;
    assert.deepEqual(checkProtocolBundle(bundle), ['ELAPSED_TIME_RESET']);
    bundle.execution.elapsed_seconds = 601;
    assert.deepEqual(checkProtocolBundle(bundle), []);
  });
  check('R04 accumulated elapsed reaches deadline before UTC deadline', () => {
    const bundle = syntheticBundle(); addResume(bundle); bundle.previous.elapsed_seconds = 301;
    bundle.execution.now_utc = '2026-10-27T00:29:58.000Z'; bundle.execution.elapsed_seconds = 1799;
    assert.deepEqual(checkProtocolBundle(bundle), []);
    bundle.execution.now_utc = '2026-10-27T00:29:59.000Z';
    assert.deepEqual(checkProtocolBundle(bundle), ['COLLECTION_DEADLINE_PASSED', 'ELAPSED_TIME_RESET']);
    bundle.execution.elapsed_seconds = 1800;
    assert.deepEqual(checkProtocolBundle(bundle), ['COLLECTION_DEADLINE_PASSED']);
  });
  check('selected adapter cannot borrow a different ready route', () => {
    const bundle = syntheticBundle(); bundle.manifest.source_readiness[0].route_id = 'FB_API_MANAGED_PAGE';
    refreezeSyntheticManifest(bundle);
    assert.deepEqual(checkProtocolBundle(bundle), ['NO_SOURCE_READY_FOR_PROBE', 'SELECTED_ROUTE_BINDING_INVALID']);
  });
  check('unready selected route cannot borrow another ready entry', () => {
    const bundle = syntheticBundle();
    bundle.manifest.source_readiness.push({ ...bundle.manifest.source_readiness[0], route_id: 'FB_API_MANAGED_PAGE' });
    bundle.manifest.source_readiness[0].permission_status = 'UNRESOLVED';
    refreezeSyntheticManifest(bundle);
    assert.deepEqual(checkProtocolBundle(bundle), ['NO_SOURCE_READY_FOR_PROBE']);
    bundle.manifest.source_readiness[0].permission_status = 'DOCUMENTED';
    bundle.manifest.source_readiness[1].permission_status = 'UNRESOLVED';
    refreezeSyntheticManifest(bundle);
    assert.deepEqual(checkProtocolBundle(bundle), []);
  });
  check('duplicate selected route entries are ambiguous and rejected', () => {
    const bundle = syntheticBundle(); bundle.manifest.source_readiness.push({ ...bundle.manifest.source_readiness[0] });
    refreezeSyntheticManifest(bundle);
    assert.deepEqual(checkProtocolBundle(bundle), ['SELECTED_ROUTE_BINDING_INVALID']);
  });
  check('audit may occur later with unchanged frozen evidence', () => {
    const bundle = syntheticBundle(); addSnapshot(bundle); assert.deepEqual(checkProtocolBundle(bundle), []);
  });
  check('unverified candidate stays frozen without being claimed as valid', () => {
    const bundle = syntheticBundle(); addSnapshot(bundle); bundle.claimed_valid_ids = [];
    Object.assign(bundle.snapshot.members[0], { source_type: 'UNKNOWN', visibility: 'UNKNOWN', required_fields_complete: false, evidence: [] });
    bundle.snapshot.freeze_sha256 = freezeDigest(bundle.snapshot);
    bundle.execution.snapshot_sha256 = bundle.snapshot.freeze_sha256;
    assert.deepEqual(checkProtocolBundle(bundle), []);
    bundle.claimed_valid_ids = ['FACEBOOK:synthetic-post'];
    for (const code of ['SNAPSHOT_SOURCE_UNVERIFIED', 'SNAPSHOT_FIELDS_INCOMPLETE', 'SNAPSHOT_EVIDENCE_MISSING']) {
      assert.ok(checkProtocolBundle(bundle).includes(code), code);
    }
  });
  check('snapshot content changed and rehashed cannot replace host freeze digest', () => {
    const bundle = syntheticBundle(); addSnapshot(bundle); bundle.snapshot.members[0].record_version = '2';
    bundle.snapshot.freeze_sha256 = freezeDigest(bundle.snapshot);
    assert.ok(checkProtocolBundle(bundle).includes('SNAPSHOT_DIGEST_MISMATCH'));
  });
  return { check: 'P00.04 offline protocol invariants', protocol_version: '1.0.0', date: '2026-10-27',
    result: 'PASS', tests: results.length, results, execution_authorized: false, live_observations: 0,
    limitations: ['Synthetic claims only; no real permission, budget or session verified', 'Read-only checker; no crawler or production scheduler implemented'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  try {
    let report;
    if (args.includes('--self-test')) report = selfTest();
    else if (option('--bundle')) {
      const errors = checkProtocolBundle(read(option('--bundle')));
      report = { check: 'P00.04 manifest consistency', result: errors.length ? 'FAIL' : 'CONSISTENT_CLAIMS_ONLY', errors,
        execution_authorized: false, gate_evaluated: false };
      if (errors.length) process.exitCode = 1;
    } else throw new Error('Use --self-test or --bundle <json>');
    const output = JSON.stringify(report, null, 2) + '\n';
    if (option('--output')) writeFileSync(resolve(root, option('--output')), output, 'utf8');
    process.stdout.write(output);
  } catch (error) {
    // Self-test failures contain only synthetic data. Never print arbitrary manifest values.
    console.error(args.includes('--self-test') ? 'PROTOCOL_SELF_TEST_FAILED: ' + error.message : 'PROTOCOL_CHECK_INPUT_INVALID');
    process.exitCode = 1;
  }
}
