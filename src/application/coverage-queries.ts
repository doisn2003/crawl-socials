import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { contentHash } from '../domain/conversation.js';
import { MAX_DISCOVERY_QUERIES } from '../domain/discovery-contract.js';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import type { ModelGateway } from './ports/model-gateway.js';
import { ModelGatewayError } from './ports/model-gateway.js';
import { BREADTH_POLICY, coverageWaveRequest, parseCoverageWave, portfolioDiagnostics, queryKey,
  type PortfolioQuery, type BucketOutcome, type BreadthDiagnostics } from './coverage-portfolio.js';

export interface CoverageExpansionRequest { knownQueries?: string[]; completeInitial?: boolean }
export interface CoverageExpansionContext {
  allowModel: boolean; accepted: number; raw: number; pending: number;
  queryYield?: readonly { platform: string; query: string; observed: number; accepted: number }[];
}
const MAX_ATTEMPTS = 6, WAVE_SIZE = 48, MAX_CALLS_PER_REQUEST = 2;
const locks = new Map<string, Promise<unknown>>();
interface Attempt {
  wave: number; state: 'STARTED' | 'COMPLETE' | 'FAILED'; queries: PortfolioQuery[]; buckets?: BucketOutcome[];
  request_hash?: string; model?: string; rejected?: number; reason?: string; coverage_policy?: string;
}
interface ExpansionState {
  version: 3; fingerprint: string; state: 'FROZEN_RESERVE' | 'ACTIVE' | 'EXHAUSTED' | 'LIMITED'; queries: string[];
  waves: { query_id: string; wave: number; family_id: string; facet_ids: string[] }[];
  attempts: Attempt[]; coverage: BreadthDiagnostics; stop_reason?: string;
}

export function initialDiscoveryQueries(campaign: CampaignPlan, platform: 'facebook' | 'threads'): string[] {
  return campaign.queries.filter(q => q.platforms.includes(platform) && (!campaign.discovery_plan || q.wave === 0)).map(q => q.text);
}
export function readCoverageDiagnostics(directory: string): BreadthDiagnostics | null {
  const file = join(directory, 'coverage-query-expansion.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { coverage?: BreadthDiagnostics }).coverage ?? null : null;
}

/** Shared durable waves; preflight completes breadth before collection without changing the acceptance recipe. */
export function createCoverageExpansion(directory: string, campaign: CampaignPlan, gateway: ModelGateway, signal: AbortSignal,
  context?: () => CoverageExpansionContext) {
  const file = resolve(join(directory, 'coverage-query-expansion.json')), fingerprint = contentHash(campaign);
  const reserve = campaign.discovery_plan?.queries.filter(q => q.wave > 0) ?? [];
  const base = campaign.queries.map(q => q.text);
  const waves = reserve.map(q => ({ query_id: q.query_id, wave: q.wave, family_id: q.family_id, facet_ids: q.facet_ids }));
  function save(state: ExpansionState) {
    state.coverage = portfolioDiagnostics(campaign, state.attempts, state.queries); atomicJson(file, state);
  }
  function read(): ExpansionState {
    if (!existsSync(file)) return { version: 3, fingerprint, state: 'FROZEN_RESERVE', queries: reserve.map(q => q.text), waves, attempts: [],
      coverage: portfolioDiagnostics(campaign, [], reserve.map(q => q.text)) };
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Omit<ExpansionState, 'version'> & { version?: number };
    if (saved.fingerprint !== fingerprint || !Array.isArray(saved.queries) || saved.queries.some(q => typeof q !== 'string' || !q.trim())
      || new Set([...base, ...saved.queries].map(queryKey)).size > MAX_DISCOVERY_QUERIES) throw Error('QUERY_EXPANSION_STATE_INVALID');
    if (saved.version === 2 || saved.version === 3) {
      if (!['FROZEN_RESERVE', 'ACTIVE', 'EXHAUSTED', 'LIMITED'].includes(saved.state)
        || reserve.some(q => !saved.queries.some(text => queryKey(text) === queryKey(q.text)))
        || !Array.isArray(saved.attempts) || saved.attempts.length > MAX_ATTEMPTS
        || saved.attempts.some((a, index) => a.wave !== index + 1 || !['STARTED', 'COMPLETE', 'FAILED'].includes(a.state) || !Array.isArray(a.queries))) throw Error('QUERY_EXPANSION_STATE_INVALID');
      // Reconsider old soft-count exhaustion under the new breadth contract, preserving every spent attempt/query.
      return { ...saved, version: 3, state: saved.version === 2 ? 'ACTIVE' : saved.state,
        coverage: portfolioDiagnostics(campaign, saved.attempts, saved.queries) };
    }
    const oldState = String(saved.state);
    if (saved.version !== undefined || !['FROZEN_RESERVE', 'STARTED', 'COMPLETE', 'FAILED'].includes(oldState)) throw Error('QUERY_EXPANSION_STATE_INVALID');
    const queries = [...new Set([...reserve.map(q => q.text), ...saved.queries])];
    const attempts: Attempt[] = oldState === 'FROZEN_RESERVE' ? [] : [{ wave: 1, state: oldState === 'COMPLETE' ? 'COMPLETE' : 'FAILED', queries: [], reason: 'LEGACY_ATTEMPT_PRESERVED' }];
    return { version: 3, fingerprint, state: 'ACTIVE', queries, waves, attempts, coverage: portfolioDiagnostics(campaign, attempts, queries) };
  }
  async function expand(request?: CoverageExpansionRequest): Promise<string[]> {
    signal.throwIfAborted();
    const state = read();
    const known = new Set((request?.knownQueries ?? base.filter(q => !reserve.some(r => queryKey(r.text) === queryKey(q)))).map(queryKey));
    const missing = () => state.queries.filter(q => !known.has(queryKey(q)));
    const current = context?.();
    save(state);
    if ((!request?.completeInitial && missing().length) || (request?.completeInitial && state.coverage.state === 'COMPLETE')) return missing();
    if (campaign.filter_mode === 'OFF' || !current?.allowModel || current.accepted >= campaign.suitable_target) return missing();
    const terminal = () => state.state === 'EXHAUSTED' || state.state === 'LIMITED' || state.attempts.length >= MAX_ATTEMPTS;
    if (terminal()) {
      if (missing().length) return missing();
      if (state.coverage.state !== 'COMPLETE') throw Error('QUERY_COVERAGE_INCOMPLETE');
      return [];
    }
    const branches = campaign.intent_resolution?.plan.branches.filter(b => b.scope === 'CORE') ?? [];
    if (!branches.length) return missing();
    for (let call = 0; call < MAX_CALLS_PER_REQUEST && state.attempts.length < MAX_ATTEMPTS; call++) {
      signal.throwIfAborted();
      const live = context?.() ?? current;
      if (!live.allowModel || live.accepted >= campaign.suitable_target || gateway.summary().remaining_usd < 0.01) return missing();
      const existing = [...new Map([...base, ...state.queries].map(q => [queryKey(q), q])).values()];
      const remaining = MAX_DISCOVERY_QUERIES - existing.length;
      if (remaining <= 0) { state.state = 'EXHAUSTED'; state.stop_reason = 'QUERY_LIMIT'; save(state); break; }
      const generation = coverageWaveRequest(campaign, existing, state.attempts, Math.min(WAVE_SIZE, remaining),
        { target: campaign.suitable_target, accepted: live.accepted, raw: live.raw, pending: live.pending },
        (live.queryYield ?? []).slice(0, MAX_DISCOVERY_QUERIES * 2), signal);
      const attempt: Attempt = { wave: state.attempts.length + 1, state: 'STARTED', queries: [], coverage_policy: BREADTH_POLICY };
      state.attempts.push(attempt); state.state = 'ACTIVE'; save(state);
      try {
        const result = await gateway.generateJson(generation);
        attempt.request_hash = result.request_hash; attempt.model = result.model;
        const parsed = parseCoverageWave(result.value, generation, campaign, existing);
        attempt.queries = parsed.queries; attempt.buckets = parsed.buckets;
        attempt.rejected = parsed.buckets.reduce((n, b) => n + b.rejected, 0);
        attempt.state = !parsed.queries.length && attempt.rejected ? 'FAILED' : 'COMPLETE';
        state.queries.push(...parsed.queries.map(q => q.text)); save(state);
        if (state.coverage.total_queries >= MAX_DISCOVERY_QUERIES) { state.state = 'EXHAUSTED'; state.stop_reason = 'QUERY_LIMIT'; save(state); break; }
        if (parsed.queries.length && (!request?.completeInitial || state.coverage.state === 'COMPLETE')) return missing();
        const unsupported = parsed.buckets.every(b => b.state === 'NOT_APPLICABLE');
        if (unsupported) { state.state = 'LIMITED'; state.stop_reason = 'NO_GROUNDED_DIRECTIONS'; save(state); break; }
        // Missing/invalid slots receive one bounded repair in this invocation. Valid work stays durable.
      } catch (error) {
        if (error instanceof ModelGatewayError && error.invocation_id === null) {
          // A proven pre-dispatch budget/auth/abort failure has not used an inference attempt.
          // Dispatched and interrupted STARTED entries retain their historical allowance.
          if (state.attempts.at(-1) === attempt) state.attempts.pop();
          save(state); throw error;
        }
        attempt.state = 'FAILED'; save(state);
        // Transport/auth/monetary failures must not become semantic retries or exhausted source coverage.
        if (!(error instanceof Error) || !['QUERY_EXPANSION_INVALID', 'QUERY_EXPANSION_UNGROUNDED'].includes(error.message)) throw error;
        if (call + 1 >= MAX_CALLS_PER_REQUEST) throw error;
      }
    }
    if (state.attempts.length >= MAX_ATTEMPTS) { state.stop_reason = 'EXPANSION_ATTEMPT_LIMIT'; save(state); }
    if (missing().length) return missing();
    if (state.coverage.state !== 'COMPLETE') throw Error('QUERY_COVERAGE_INCOMPLETE');
    if (!terminal()) throw Error('QUERY_EXPANSION_INVALID');
    return [];
  }
  return (request?: CoverageExpansionRequest): Promise<string[]> => {
    const previous = locks.get(file) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => expand(request)); locks.set(file, work);
    return work.finally(() => { if (locks.get(file) === work) locks.delete(file); });
  };
}
