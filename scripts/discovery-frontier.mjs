import { createHash } from 'node:crypto';

// A native search URL cannot resume a scroll cursor. Revisit the same URL, replay a
// bounded observed prefix, then spend a new page slice. These are scroll depths,
// not an assertion that the feed still has the same contents or pagination.
export const MAX_DISCOVERY_REPLAY_PAGES = 100;
/** Keep a productive page loaded for bounded extra slices; no cursor/API replay. */
export function extendWarmSlice(slice, { currentScroll, gained, pageBudget, warmPageLimit = pageBudget, maxReplayPages = MAX_DISCOVERY_REPLAY_PAGES, canContinue = false }) {
  if (!canContinue || gained <= 0 || currentScroll !== slice.maxScroll || pageBudget < 1) return false;
  const limit = Math.min(slice.replayDepth + warmPageLimit, maxReplayPages + pageBudget);
  if (slice.maxScroll >= limit) return false;
  slice.maxScroll = Math.min(limit, slice.maxScroll + pageBudget); return true;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const states = new Set(['PENDING', 'RUNNING', 'BUDGET_LIMITED', 'EXHAUSTED', 'STALLED']);
const reasons = new Set([null, 'PAGE_BUDGET_REACHED', 'NATIVE_END_OBSERVED', 'NO_PROGRESS', 'REPLAY_BUDGET_REACHED', 'LEGACY_DEPTH_UNKNOWN']);
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

export function createDiscoveryFrontier({ platform, runId, jobs, pageBudget, checkpoint, checkpointExisted = false, maxReplayPages = MAX_DISCOVERY_REPLAY_PAGES }) {
  if (!['facebook', 'threads'].includes(platform) || typeof runId !== 'string' || !runId || !Array.isArray(jobs) || !jobs.length || jobs.length > 480
      || !integer(pageBudget, 200) || !integer(maxReplayPages, 2000) || maxReplayPages < 1 || !checkpoint || typeof checkpoint !== 'object') throw Error('DISCOVERY_FRONTIER_INVALID');
  const definitions = jobs.map((job, index) => {
    if (!job || typeof job.query !== 'string' || !job.query.trim() || job.query.length > 200
        || (platform === 'threads' ? !['top', 'recent'].includes(job.mode) : job.mode !== undefined)) throw Error('DISCOVERY_FRONTIER_INVALID');
    return { id: hash([platform, job.query, job.mode ?? null]), index, query: job.query, mode: job.mode ?? null };
  });
  if (new Set(definitions.map(job => job.id)).size !== definitions.length) throw Error('DISCOVERY_FRONTIER_DUPLICATE_JOB');
  const planHash = hash([platform, definitions]);
  const position = platform === 'facebook' ? checkpoint.query_index : checkpoint.job_index;
  if (!integer(position, jobs.length) || !integer(checkpoint.batch_sequence, Number.MAX_SAFE_INTEGER)) throw Error('DISCOVERY_FRONTIER_INVALID');
  let frontier;
  if (checkpoint.discovery_frontier !== undefined) {
    const saved = checkpoint.discovery_frontier;
    if (!saved || saved.schema_version !== 1 || saved.run_id !== runId || saved.platform !== platform || saved.plan_sha256 !== planHash
        || !Array.isArray(saved.jobs) || saved.jobs.length !== definitions.length) throw Error('DISCOVERY_FRONTIER_MISMATCH');
    saved.jobs.forEach((job, index) => {
      const expected = definitions[index];
      if (!job || job.id !== expected.id || job.index !== index || job.query !== expected.query || job.mode !== expected.mode
          || !states.has(job.state) || !integer(job.depth, maxReplayPages + pageBudget)
          || !integer(job.slices, Number.MAX_SAFE_INTEGER) || !reasons.has(job.reason)
          || (job.state === 'EXHAUSTED' && job.reason !== 'NATIVE_END_OBSERVED')
          || (job.state === 'PENDING' && (job.depth !== 0 || job.slices !== 0 || job.reason !== null))) throw Error('DISCOVERY_FRONTIER_INVALID');
    });
    frontier = structuredClone(saved);
  } else {
    frontier = { schema_version: 1, run_id: runId, platform, plan_sha256: planHash, jobs: definitions.map(job => {
      const prior = checkpointExisted && job.index < position;
      const interrupted = checkpointExisted && job.index === position && checkpoint.batch_sequence > 0;
      // Old checkpoints never proved exhausted. Threads did not store depth, so
      // conservatively replay its former slice instead of stopping at duplicates.
      const depth = prior ? pageBudget : interrupted ? platform === 'facebook' && integer(checkpoint.scroll_index, pageBudget) ? checkpoint.scroll_index : pageBudget : 0;
      return { ...job, state: prior ? 'BUDGET_LIMITED' : interrupted ? 'RUNNING' : 'PENDING', depth,
        slices: prior ? 1 : 0, reason: prior || interrupted ? 'LEGACY_DEPTH_UNKNOWN' : null };
    }) };
  }
  const at = index => { const job = frontier.jobs[index]; if (!job) throw Error('DISCOVERY_FRONTIER_INVALID'); return job; };
  return {
    snapshot: () => structuredClone(frontier),
    indices: ({ resume = false } = {}) => frontier.jobs.filter(job => job.state === 'PENDING' || job.state === 'RUNNING'
      || (resume && job.state !== 'EXHAUSTED')).map(job => job.index),
    begin(index) {
      const job = at(index), replayDepth = job.depth;
      if (job.state === 'EXHAUSTED') throw Error('DISCOVERY_FRONTIER_EXHAUSTED');
      if (replayDepth > maxReplayPages) {
        job.state = 'BUDGET_LIMITED'; job.reason = 'REPLAY_BUDGET_REACHED';
        return { allowed: false, replayDepth, maxScroll: 0 };
      }
      job.state = 'RUNNING'; job.reason = null;
      return { allowed: true, replayDepth, maxScroll: replayDepth + pageBudget };
    },
    // Call only after all currently received records are durably persisted.
    page(index, depth) {
      const job = at(index);
      if (job.state !== 'RUNNING' || !integer(depth, maxReplayPages + pageBudget)) throw Error('DISCOVERY_FRONTIER_INVALID');
      job.depth = Math.max(job.depth, depth);
    },
    finish(index, reason) {
      const job = at(index);
      if (job.state !== 'RUNNING' || !['PAGE_BUDGET_REACHED', 'NATIVE_END_OBSERVED', 'NO_PROGRESS'].includes(reason)) throw Error('DISCOVERY_FRONTIER_INVALID');
      job.state = reason === 'NATIVE_END_OBSERVED' ? 'EXHAUSTED' : reason === 'NO_PROGRESS' ? 'STALLED' : 'BUDGET_LIMITED';
      job.reason = reason; job.slices++;
    },
    stopReason() {
      if (frontier.jobs.every(job => job.state === 'EXHAUSTED')) return 'SOURCE_EXHAUSTED';
      if (frontier.jobs.some(job => job.reason === 'REPLAY_BUDGET_REACHED')) return 'REPLAY_BUDGET_REACHED';
      return 'QUERY_BUDGET_COMPLETE';
    },
  };
}
