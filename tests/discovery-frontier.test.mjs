import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryFrontier, extendWarmSlice, MAX_DISCOVERY_REPLAY_PAGES } from '../scripts/discovery-frontier.mjs';

const input = (platform = 'threads') => ({ platform, runId: 'synthetic-frontier', pageBudget: 20,
  jobs: platform === 'threads' ? [{ query: 'synthetic topic', mode: 'top' }, { query: 'synthetic topic', mode: 'recent' }] : [{ query: 'synthetic topic' }],
  checkpoint: platform === 'threads' ? { job_index: 0, batch_sequence: 0 } : { query_index: 0, scroll_index: 0, batch_sequence: 0 } });
const reopened = (original, frontier) => createDiscoveryFrontier({ ...original, checkpoint: { ...original.checkpoint, discovery_frontier: frontier.snapshot() }, checkpointExisted: true });

test('warm slices retain a productive page within novelty, fairness and replay limits', () => {
  const slice = { allowed: true, replayDepth: 0, maxScroll: 3 };
  const options = { currentScroll: 3, gained: 4, pageBudget: 3, warmPageLimit: 9, canContinue: true };
  assert.equal(extendWarmSlice(slice, { ...options, canContinue: false }), false);
  assert.equal(extendWarmSlice(slice, { ...options, gained: 0 }), false);
  assert.equal(extendWarmSlice(slice, options), true); assert.equal(slice.maxScroll, 6);
  assert.equal(extendWarmSlice(slice, { ...options, currentScroll: 6 }), true); assert.equal(slice.maxScroll, 9);
  assert.equal(extendWarmSlice(slice, { ...options, currentScroll: 9 }), false);
  const deep = { replayDepth: 399, maxScroll: 402 };
  assert.equal(extendWarmSlice(deep, { ...options, currentScroll: 402, maxReplayPages: 400 }), true);
  assert.equal(deep.maxScroll, 403, 'cannot silently exceed the checkpoint replay ceiling');
});

test('large immutable query portfolio and longer frontier remain resumable', () => {
  const original = { ...input(), maxReplayPages: 400, jobs: Array.from({ length: 240 }, (_, i) => ({ query: 'topic ' + i, mode: 'recent' })) };
  const frontier = createDiscoveryFrontier(original); frontier.begin(0); frontier.page(0, 220); frontier.finish(0, 'PAGE_BUDGET_REACHED');
  assert.equal(reopened(original, frontier).begin(0).replayDepth, 220);
  assert.equal(frontier.snapshot().jobs.length, 240);
});

test('page budget preserves continuation and mode identity while native end is the only exhaustion proof', () => {
  const original = input(), frontier = createDiscoveryFrontier(original);
  assert.notEqual(frontier.snapshot().jobs[0].id, frontier.snapshot().jobs[1].id);
  assert.deepEqual(frontier.begin(0), { allowed: true, replayDepth: 0, maxScroll: 20 });
  frontier.page(0, 20); frontier.finish(0, 'PAGE_BUDGET_REACHED');
  frontier.begin(1); frontier.page(1, 2); frontier.finish(1, 'NATIVE_END_OBSERVED');
  const restored = reopened(original, frontier);
  assert.deepEqual(restored.indices(), [], 'budget slices do not run again without explicit Resume');
  assert.deepEqual(restored.indices({ resume: true }), [0]);
  assert.deepEqual(restored.begin(0), { allowed: true, replayDepth: 20, maxScroll: 40 });
  restored.page(0, 21); restored.finish(0, 'NO_PROGRESS');
  assert.equal(restored.snapshot().jobs[0].state, 'STALLED'); assert.equal(restored.stopReason(), 'QUERY_BUDGET_COMPLETE');
  assert.deepEqual(reopened(original, restored).indices({ resume: true }), [0], 'duplicate stagnation is resumable, not native exhaustion');
});

test('bounded replay reports pending frontier without erasing depth or claiming source exhaustion', () => {
  const original = input('facebook'), frontier = createDiscoveryFrontier(original);
  frontier.begin(0); frontier.page(0, MAX_DISCOVERY_REPLAY_PAGES + 1); frontier.finish(0, 'PAGE_BUDGET_REACHED');
  const restored = reopened(original, frontier);
  assert.deepEqual(restored.begin(0), { allowed: false, replayDepth: 101, maxScroll: 0 });
  assert.equal(restored.stopReason(), 'REPLAY_BUDGET_REACHED'); assert.equal(restored.snapshot().jobs[0].state, 'BUDGET_LIMITED');
  assert.deepEqual(restored.indices({ resume: true }), [0]);
});

test('checkpoint snapshots are detached and an uncommitted page replays safely', () => {
  const original = input(), frontier = createDiscoveryFrontier(original);
  frontier.begin(0); frontier.page(0, 7);
  const committed = frontier.snapshot(); frontier.page(0, 8);
  assert.equal(committed.jobs[0].depth, 7);
  const recovered = createDiscoveryFrontier({ ...original, checkpoint: { ...original.checkpoint, discovery_frontier: committed }, checkpointExisted: true });
  assert.deepEqual(recovered.begin(0), { allowed: true, replayDepth: 7, maxScroll: 27 });
  recovered.page(0, 1); assert.equal(recovered.snapshot().jobs[0].depth, 7, 'replay must not decrease known depth');
});

test('old completed intent checkpoints retain conservative continuation rather than inventing exhaustion', () => {
  const original = input();
  const frontier = createDiscoveryFrontier({ ...original, checkpoint: { job_index: 2, batch_sequence: 8 }, checkpointExisted: true });
  assert.deepEqual(frontier.indices({ resume: true }), [0, 1]);
  assert.ok(frontier.snapshot().jobs.every(job => job.state === 'BUDGET_LIMITED' && job.depth === 20 && job.reason === 'LEGACY_DEPTH_UNKNOWN'));
  const interrupted = createDiscoveryFrontier({ ...original, checkpoint: { job_index: 0, batch_sequence: 4 }, checkpointExisted: true });
  assert.equal(interrupted.begin(0).replayDepth, 20, 'old Threads in-progress checkpoints did not know depth');
  const facebook = createDiscoveryFrontier({ ...input('facebook'), checkpoint: { query_index: 0, scroll_index: 6, batch_sequence: 4 }, checkpointExisted: true });
  assert.equal(facebook.begin(0).replayDepth, 6);
});

test('invalid, tampered or query/mode-mismatched frontier fails closed', () => {
  const original = input(), frontier = createDiscoveryFrontier(original), saved = frontier.snapshot();
  const changes = [value => { value.run_id = 'different'; }, value => { value.plan_sha256 = '0'.repeat(64); }, value => { value.jobs.pop(); },
    value => { value.jobs[0].query = 'different query'; }, value => { value.jobs[0].mode = 'recent'; }, value => { value.jobs[0].id = 'wrong'; },
    value => { value.jobs[0].state = 'EXHAUSTED'; value.jobs[0].reason = 'NO_PROGRESS'; }, value => { value.jobs[0].depth = -1; },
    value => { value.jobs[0].depth = 99999; }, value => { value.jobs[0].slices = 0.5; }];
  for (const mutate of changes) {
    const changed = structuredClone(saved); mutate(changed);
    assert.throws(() => createDiscoveryFrontier({ ...original, checkpoint: { ...original.checkpoint, discovery_frontier: changed } }), /DISCOVERY_FRONTIER_(INVALID|MISMATCH)/);
  }
  assert.throws(() => createDiscoveryFrontier({ ...original, jobs: [...original.jobs].reverse(), checkpoint: { ...original.checkpoint, discovery_frontier: saved } }), /DISCOVERY_FRONTIER_MISMATCH/);
  assert.throws(() => createDiscoveryFrontier({ ...original, jobs: [original.jobs[0], original.jobs[0]] }), /DISCOVERY_FRONTIER_DUPLICATE_JOB/);
});
