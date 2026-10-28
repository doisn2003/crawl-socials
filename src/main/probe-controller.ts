import { randomUUID } from 'node:crypto';
import type { ObserverEvent, ResponseObserver } from '../application/ports/response-observer.js';
import { digest, emptyCounters, PROBE_LIMITS, PROBE_QUERIES, sanitizeProbeCapture } from './probe-contract.js';
import type { ProbeCounters, ProbeLimits, ProbeReason, ProbeStatus } from './probe-contract.js';
import type { ProbeWriter } from './probe-writer.js';

export interface ProbeDriverSession {
  // Only the trusted local fixture driver is implemented. No route-approved/LIVE boolean exists.
  beginSegment(maxRunMs: number): Promise<ResponseObserver>;
  action(action: 'NAVIGATE_FIXTURE' | 'FETCH_FIXTURE_BATCH', query: number, batch: number, signal: AbortSignal): Promise<void>;
  release(): void;
}
export interface ProbeDriver {
  acquire(profileId: string, lost: (reason: ProbeReason) => void): ProbeDriverSession;
}
export interface ProbeExtractor {
  // Future parser seam: counts remain unverified. It cannot claim valid posts or persist arbitrary payload.
  inspect(event: ObserverEvent): { candidateCount: number; continuation: 'ADVANCED' | 'REPEATED' | 'UNKNOWN' };
}
interface Run {
  id: string; profileId: string; state: ProbeStatus['state']; start: number; mono: number; deadline: number;
  elapsed: number; lastWall: number; reason: ProbeReason | null; counters: ProbeCounters;
  writer: ProbeWriter; session: ProbeDriverSession | null; observer: ResponseObserver | null;
  abort: AbortController; timer: ReturnType<typeof setInterval> | null; done: Promise<void>;
  operatorStart: number | null; cutoff: number | null;
}
export function createProbeController(input: {
  driver: ProbeDriver | null;
  freeze: () => { versions: Record<string, unknown>; buildInputs: unknown; evidence: unknown; campaign: unknown };
  writer: (runId: string, maxBytes: number) => ProbeWriter;
  clock?: { wall: () => number; mono: () => number };
  limits?: Partial<{ -readonly [K in keyof ProbeLimits]: number }>;
  extractor?: ProbeExtractor;
}) {
  const limits = { ...PROBE_LIMITS, ...input.limits };
  for (const key of Object.keys(PROBE_LIMITS) as (keyof ProbeLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > PROBE_LIMITS[key]) throw new Error('PROBE_LIMITS_INVALID');
  }
  const clock = input.clock || { wall: Date.now, mono: () => performance.now() };
  let current: Run | null = null;
  const running = (run: Run) => current === run && (run.state === 'STARTING' || run.state === 'RUNNING');
  function requestStop(run: Run, reason: ProbeReason) {
    if (!running(run)) return;
    run.reason = reason; run.state = 'STOPPING';
    run.cutoff = Math.min(clock.wall(), run.deadline);
    run.abort.abort(); run.observer?.stop();
    if (run.timer) { clearInterval(run.timer); run.timer = null; }
  }
  function guard(run: Run): boolean {
    if (!running(run)) return false;
    const wall = clock.wall(), monoElapsed = clock.mono() - run.mono, wallElapsed = wall - run.start;
    run.elapsed = Math.max(run.elapsed, wallElapsed, monoElapsed);
    if (wall < run.lastWall || monoElapsed < 0 || Math.abs(wallElapsed - monoElapsed) > 2000) requestStop(run, 'CLOCK_UNCERTAIN');
    run.lastWall = wall;
    if (running(run) && (wall >= run.deadline || run.elapsed >= limits.wallMs)) requestStop(run, 'DEADLINE_REACHED');
    if (running(run) && run.operatorStart !== null && run.counters.operatorMs + run.elapsed - run.operatorStart >= limits.operatorMs) requestStop(run, 'OPERATOR_LIMIT');
    return running(run);
  }
  function ledger(run: Run, event: Parameters<ProbeWriter['ledger']>[0]['event'], details: Partial<Parameters<ProbeWriter['ledger']>[0]> = {}) {
    if (!guard(run)) return;
    run.writer.ledger({ ...details, event, at: new Date(clock.wall()).toISOString(), elapsed_ms: Math.ceil(run.elapsed) });
  }
  function fail(run: Run, error: unknown) {
    requestStop(run, error instanceof Error && error.message === 'PROBE_STORAGE_LIMIT' ? 'STORAGE_LIMIT' : 'WRITE_FAILED');
  }
  async function action(run: Run, type: 'NAVIGATE_FIXTURE' | 'FETCH_FIXTURE_BATCH', query: number, batch: number, retry: number) {
    if (!guard(run)) return false;
    if (run.counters.actions >= limits.actions) { requestStop(run, 'ACTION_LIMIT'); return false; }
    // Account durably before invoking the driver; cancellation/failure still consumes the action.
    run.counters.actions++;
    if (retry) run.counters.retries++;
    try { ledger(run, 'ACTION', { action: type, query, batch, retry }); }
    catch (error) { fail(run, error); return false; }
    if (!guard(run)) return false;
    let cancel = () => {};
    const abortWait = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error('PROBE_CANCELLED'));
      if (run.abort.signal.aborted) reject(new Error('PROBE_CANCELLED'));
      else run.abort.signal.addEventListener('abort', cancel, { once: true });
    });
    try { await Promise.race([run.session!.action(type, query, batch, run.abort.signal), abortWait]); return guard(run); }
    catch { if (guard(run)) requestStop(run, 'DRIVER_ERROR'); return false; }
    finally { run.abort.signal.removeEventListener('abort', cancel); }
  }
  let lastProgress: 'ADVANCED' | 'REPEATED' | 'UNKNOWN' = 'UNKNOWN';
  async function readBatch(run: Run, query: number, batch: number): Promise<'CAPTURED' | 'TRANSIENT' | 'STOP'> {
    const observer = run.observer!;
    for (let reads = 0; reads < 64 && guard(run); reads++) {
      const read = await observer.read(Math.max(1, Math.min(2000, run.deadline - clock.wall())));
      if (!guard(run)) return 'STOP';
      if (read.kind !== 'EVENT') {
        if (read.kind === 'TIMEOUT') return 'TRANSIENT';
        requestStop(run, 'OBSERVER_ERROR'); return 'STOP';
      }
      const event = read.event;
      if (event.kind === 'STATE') {
        if (['ATTACHED', 'NAVIGATION_RESET'].includes(event.code)) continue;
        requestStop(run, 'OBSERVER_ERROR'); return 'STOP';
      }
      if (event.kind === 'ERROR') {
        if (['NETWORK_FAILED', 'REQUEST_TIMEOUT'].includes(event.code) && observer.snapshot().state === 'ATTACHED') return 'TRANSIENT';
        requestStop(run, event.code === 'DEVTOOLS_OPENED' ? 'DEVTOOLS_OPENED' : event.code === 'TARGET_DESTROYED' ? 'TARGET_CLOSED' : 'OBSERVER_ERROR'); return 'STOP';
      }
      if (event.kind !== 'BODY') { requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
      if (event.captureMode !== 'FIXTURE') { requestStop(run, 'COVERAGE_LOST'); return 'STOP'; }
      if (event.status === 401) { requestStop(run, 'AUTH_REQUIRED'); return 'STOP'; }
      if (event.status === 403) { requestStop(run, 'ACCESS_DENIED'); return 'STOP'; }
      const diagnostic = sanitizeProbeCapture(event);
      if (!diagnostic) { requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
      if (run.counters.diagnosticCaptures >= limits.diagnosticRecords) { requestStop(run, 'DIAGNOSTIC_LIMIT'); return 'STOP'; }
      if (input.extractor) {
        let count: number;
        try { const result = input.extractor.inspect(event); count = result.candidateCount; lastProgress = result.continuation; }
        catch { requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
        if (!['ADVANCED', 'REPEATED', 'UNKNOWN'].includes(lastProgress)) { requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
        if (!Number.isSafeInteger(count) || count < 0) { requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
        if ((run.counters.candidates || 0) + count > limits.candidates) { requestStop(run, 'CANDIDATE_LIMIT'); return 'STOP'; }
        run.counters.candidates = (run.counters.candidates || 0) + count;
      }
      run.counters.diagnosticCaptures++; run.counters.capturedBodyBytes += event.body.byteLength;
      try {
        if (!guard(run)) return 'STOP';
        const stored = run.writer.observe(diagnostic, { runId: run.id, startedAt: run.start, deadlineAt: run.deadline, query, batch, segment: run.counters.segments });
        if (!stored) { if (guard(run)) requestStop(run, 'SCHEMA_FAILURE'); return 'STOP'; }
      } catch (error) { fail(run, error); return 'STOP'; }
      if (input.extractor && run.counters.candidates === limits.candidates) requestStop(run, 'CANDIDATE_LIMIT');
      return 'CAPTURED';
    }
    if (guard(run)) requestStop(run, 'OBSERVER_ERROR'); return 'STOP';
  }
  async function execute(run: Run) {
    try {
      if (!guard(run)) return;
      run.session = input.driver!.acquire(run.profileId, reason => requestStop(run, reason));
      if (!guard(run)) return;
      run.state = 'RUNNING';
      if (!await action(run, 'NAVIGATE_FIXTURE', 0, 0, 0)) return;
      for (let query = 0; query < PROBE_QUERIES.length && guard(run); query++) {
        let noProgress = 0;
        for (let batch = 1; batch <= limits.batchesPerQuery && guard(run); batch++) {
          if (run.counters.actions >= limits.actions) { requestStop(run, 'ACTION_LIMIT'); break; }
          run.counters.batches[query] = batch;
          ledger(run, 'BATCH', { query, batch });
          const beforeCandidates = run.counters.candidates;
          let outcome: 'CAPTURED' | 'TRANSIENT' | 'STOP' = 'TRANSIENT';
          for (let retry = 0; retry <= limits.retriesPerBatch && outcome === 'TRANSIENT' && guard(run); retry++) {
            // A fresh transport generation also excludes late responses from a timed-out attempt.
            run.observer?.stop(); run.counters.segments++;
            ledger(run, 'SEGMENT', { query, batch, retry });
            run.observer = await run.session.beginSegment(Math.min(limits.segmentMs, Math.max(1, Math.floor(limits.wallMs - run.elapsed))));
            if (!guard(run)) { run.observer.stop(); break; }
            if (run.observer.snapshot().state !== 'ATTACHED') { requestStop(run, 'OBSERVER_ERROR'); break; }
            if (!await action(run, 'FETCH_FIXTURE_BATCH', query, batch, retry)) break;
            outcome = await readBatch(run, query, batch);
          }
          run.observer?.stop(); run.observer = null;
          if (outcome === 'TRANSIENT' && guard(run)) { requestStop(run, 'READ_TIMEOUT'); break; }
          if (input.extractor && outcome === 'CAPTURED') {
            // Without an observed cursor/identity parser we cannot infer source progress/end.
            noProgress = run.counters.candidates === beforeCandidates && lastProgress === 'REPEATED' ? noProgress + 1 : 0;
            if (noProgress >= limits.noProgressBatches) { requestStop(run, 'NO_PROGRESS'); break; }
          }
        }
      }
      if (guard(run)) requestStop(run, 'COMPLETED_FIXTURE');
    } catch (error) {
      if (guard(run)) requestStop(run, error instanceof Error && error.message === 'PROBE_STORAGE_LIMIT' ? 'STORAGE_LIMIT' : 'DRIVER_ERROR');
    } finally {
      if (running(run)) requestStop(run, 'DRIVER_ERROR');
      run.observer?.stop(); run.observer = null;
      try { run.session?.release(); } catch { run.reason = 'DRIVER_ERROR'; }
      run.session = null;
      const stopped = clock.wall();
      if (run.operatorStart !== null) { run.counters.operatorMs += Math.max(0, Math.min(limits.operatorMs, run.elapsed - run.operatorStart)); run.operatorStart = null; }
      try {
        run.writer.finalize({ cutoff: Math.max(run.start, run.cutoff ?? Math.min(stopped, run.deadline)), stoppedAt: stopped,
          summary: { run_id: run.id, protocol_version: '1.0.0', capture_mode: 'FIXTURE', benchmark_eligible: false,
            started_at: new Date(run.start).toISOString(), deadline_at: new Date(run.deadline).toISOString(), stopped_at: new Date(stopped).toISOString(),
            cutoff_at: new Date(Math.max(run.start, run.cutoff ?? Math.min(stopped, run.deadline))).toISOString(),
            stop_reason: run.reason, counters: run.counters, elapsed_high_water_ms: Math.ceil(run.elapsed), last_seen_at: new Date(run.lastWall).toISOString(),
            verified_valid_unique_posts: 0, candidate_status: input.extractor ? 'UNVERIFIED_TEST_EXTRACTOR' : 'UNKNOWN',
            source_counts: { PAGE: null, PUBLIC_GROUP: null, PUBLIC_PERSONAL: null }, relevance: 'UNVERIFIED',
            request_telemetry_coverage: 'CONTROLLED_ACTIONS_ONLY_NOT_ALL_HTTP', driver: 'LOCAL_FIXTURE_V1',
            facebook_driver: 'NOT_IMPLEMENTED', parser: 'NOT_IMPLEMENTED', resume: 'UNSUPPORTED_NEW_ID_REQUIRED',
            actual_persisted_bytes_before_finalization: run.writer.bytes() } });
      } catch { run.reason = 'WRITE_FAILED'; }
      run.state = 'STOPPED';
    }
  }
  function status(): ProbeStatus {
    const run = current; if (run) guard(run);
    return { state: run?.state || 'IDLE', runId: run?.id || null, captureMode: run ? 'FIXTURE' : null,
      startedAt: run ? new Date(run.start).toISOString() : null, deadlineAt: run ? new Date(run.deadline).toISOString() : null,
      reason: run?.reason || null, counters: structuredClone(run?.counters || emptyCounters()), persistedBytes: run?.writer.bytes() || 0,
      verifiedValidUniquePosts: 0, sourceCounts: { PAGE: null, PUBLIC_GROUP: null, PUBLIC_PERSONAL: null }, outputRef: run?.writer.outputRef || null };
  }
  return {
    config: () => ({ available: input.driver !== null, captureMode: input.driver ? 'FIXTURE' as const : null,
      liveAvailable: false as const, facebookDriver: 'NOT_IMPLEMENTED' as const, parser: 'NOT_IMPLEMENTED' as const,
      queries: [...PROBE_QUERIES], limits: { ...limits }, resume: 'UNSUPPORTED_NEW_ID_REQUIRED' as const }),
    start(profileId: string) {
      if (!input.driver) throw new Error('PROBE_LIVE_UNAVAILABLE');
      if (current && current.state !== 'STOPPED') throw new Error('PROBE_ALREADY_RUNNING');
      const start = clock.wall(), mono = clock.mono(), id = 'probe-' + randomUUID();
      const frozen = input.freeze(), writer = input.writer(id, limits.storageBytes);
      const manifest = { manifest_version: 1, protocol_version: '1.0.0', status: 'FROZEN', run_id: id, run_kind: 'SOURCE_PROBE',
        capture_mode: 'FIXTURE', started_at: new Date(start).toISOString(), deadline_at: new Date(start + limits.wallMs).toISOString(),
        profile_id: profileId, selected_queries: [...PROBE_QUERIES], limits, versions: frozen.versions,
        canonical_campaign_sha256: digest(frozen.campaign), source_readiness: { session: 'FIXTURE_ONLY', technical: 'FIXTURE_VERIFIED_FACEBOOK_UNPROBED',
          permission: 'UNRESOLVED_NO_META_GRANT', product_fit: 'UNPROVEN' },
        budget_decision_ref: 'evidence://lead-probe-limits-2026-10-27', evidence: frozen.evidence,
        data_policy: { retention_days: 7, local_only: true, raw_body: false, external_cost_vnd: 0 },
        driver_version: 'local-fixture-v1', parser_version: 'diagnostic-metadata-v1_FACEBOOK_NOT_IMPLEMENTED',
        rubric_version: 'coffee-intent-v1', clock_policy: 'INCLUDES_PAUSE_SLEEP_RETRY_RELOGIN_RESTART',
        resume: 'UNSUPPORTED_NEW_ID_REQUIRED', benchmark_eligible: false };
      writer.initialize({ ...manifest, freeze_sha256: digest(manifest) }, frozen.buildInputs);
      const run: Run = { id, profileId, state: 'STARTING', start, mono, deadline: start + limits.wallMs,
        elapsed: 0, lastWall: start, reason: null, counters: emptyCounters(), writer, session: null,
        observer: null, abort: new AbortController(), timer: null, done: Promise.resolve(), operatorStart: null, cutoff: null };
      if (input.extractor) run.counters.candidates = 0;
      current = run;
      run.timer = setInterval(() => guard(run), 100); run.timer.unref();
      run.done = Promise.resolve().then(() => execute(run));
      return status();
    },
    status,
    async stop(reason: ProbeReason = 'OPERATOR_STOP') { const run = current; if (run) { requestStop(run, reason); await run.done; } return status(); },
    async wait() { await current?.done; return status(); },
    ownsProfile: (profileId: string) => current?.profileId === profileId && current.state !== 'STOPPED',
    interrupt: (reason: ProbeReason) => { if (current) requestStop(current, reason); },
    operator(active: boolean) {
      const run = current; if (!run || !guard(run)) throw new Error('PROBE_NOT_RUNNING');
      if (active && run.operatorStart === null) { run.operatorStart = run.elapsed; ledger(run, 'OPERATOR_BEGIN'); }
      if (!active && run.operatorStart !== null) { run.counters.operatorMs += Math.max(0, run.elapsed - run.operatorStart); run.operatorStart = null; ledger(run, 'OPERATOR_END'); }
      return status();
    },
  };
}
export type ProbeController = ReturnType<typeof createProbeController>;
