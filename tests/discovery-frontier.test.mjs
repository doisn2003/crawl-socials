import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryFrontier, extendWarmSlice, MAX_DISCOVERY_REPLAY_PAGES, createDiscoveryDiagnostics, settleDiscoveryPage } from '../scripts/discovery-frontier.mjs';

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
  assert.deepEqual(frontier.begin(0), { allowed: true, replayDepth: 0, maxScroll: 20, emptyPages: 0 });
  frontier.page(0, 20); frontier.finish(0, 'PAGE_BUDGET_REACHED');
  frontier.begin(1); frontier.page(1, 2); frontier.finish(1, 'NATIVE_END_OBSERVED');
  const restored = reopened(original, frontier);
  assert.deepEqual(restored.indices(), [], 'budget slices do not run again without explicit Resume');
  assert.deepEqual(restored.indices({ resume: true }), [0]);
  assert.deepEqual(restored.begin(0), { allowed: true, replayDepth: 20, maxScroll: 40, emptyPages: 0 });
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
  assert.deepEqual(recovered.begin(0), { allowed: true, replayDepth: 7, maxScroll: 27, emptyPages: 0 });
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


test('four empty fresh pages remain detectable across three-page slices and repeated replay', () => {
  const original = { ...input(), pageBudget: 3 }; let f = createDiscoveryFrontier(original);
  f.begin(0); for(let depth=1;depth<=3;depth++)f.page(0,depth,0); f.finish(0,'PAGE_BUDGET_REACHED');
  f=reopened(original,f);assert.equal(f.begin(0).emptyPages,3);
  f.page(0,1,0);f.page(0,2,0);f.page(0,3,0);assert.equal(f.snapshot().jobs[0].empty_pages,3,'replay does not add or erase stagnation');
  f.page(0,4,0);assert.equal(f.snapshot().jobs[0].empty_pages,4);f.finish(0,'NO_PROGRESS');
  assert.equal(f.snapshot().jobs[0].state,'STALLED');assert.notEqual(f.stopReason(),'SOURCE_EXHAUSTED');
  f=reopened(original,f);f.begin(0);f.page(0,2,1);assert.equal(f.snapshot().jobs[0].empty_pages,0,'new records during replay reset stagnation');
});


test('stagnation recovery clears empty counts, preserves depth and cannot reset its allowance by reopening', () => {
  const original={...input('facebook'),pageBudget:3};let frontier=createDiscoveryFrontier(original);
  for(let retry=0;retry<3;retry++) {
    const slice=frontier.begin(0);assert.equal(slice.allowed,true);assert.equal(slice.emptyPages,0);
    for(let i=1;i<=3;i++)frontier.page(0,slice.replayDepth+i,0);
    frontier.finish(0,'NO_PROGRESS');frontier=reopened(original,frontier);
  }
  assert.deepEqual(frontier.begin(0),{allowed:false,replayDepth:9,maxScroll:0,reason:'NO_PROGRESS'});
  assert.equal(frontier.snapshot().jobs[0].recovery_attempts,2);assert.notEqual(frontier.stopReason(),'SOURCE_EXHAUSTED');
});

test('discovery diagnostics distinguish no request, uncaptured response, parser and duplicate causes', () => {
  const d=createDiscoveryDiagnostics(),before=d.snapshot();
  assert.equal(d.diagnose(before),'NO_SEARCH_REQUEST_OBSERVED');
  d.add('search_requests');assert.equal(d.diagnose(before),'SEARCH_RESPONSE_NOT_CAPTURED');
  assert.equal(d.diagnose(before,{pendingRequests:1}),'RESPONSE_PENDING');
  d.add('response_bodies');d.add('unsupported_responses');assert.equal(d.diagnose(before),'RESPONSE_SHAPE_UNSUPPORTED');
  d.add('parsed_batches');assert.equal(d.diagnose(before),'NO_PARSED_ROOTS');
  d.add('parsed_records',5);assert.equal(d.diagnose(before),'DUPLICATE_ROOTS');
  assert.equal(d.diagnose(before,{gained:1}),'NEW_ROOTS');assert.equal(d.diagnose(before,{hasNext:false}),'NATIVE_END_OBSERVED');
});

test('page settling gives pending responses bounded grace without blocking cancellation', async () => {
  let clock=0,count=0,refreshes=0;const diagnostics=createDiscoveryDiagnostics();
  const base={settleMs:3000,now:()=>clock,sleep:async ms=>{clock+=ms;},check(){},refresh:async()=>{refreshes++;if(clock>=5000)count=2;},
    pending:()=>1,count:()=>count,beforeCount:0,diagnostics};
  await settleDiscoveryPage(base);assert.equal(clock,5000);assert.equal(count,2);assert.equal(diagnostics.snapshot().loading_waits,2);
  clock=0;count=0;await settleDiscoveryPage({...base,refresh:async()=>{}});assert.equal(clock,15000,'a stuck request cannot wait forever');
  clock=0;await assert.rejects(settleDiscoveryPage({...base,refresh:async()=>{},check(){if(clock>=4000)throw Error('USER_STOP');}}),/USER_STOP/);
});


test('ordinary slices skip stalled modes until the coordinator grants a cooldown recovery', () => {
  const original=input(),f=createDiscoveryFrontier(original);
  f.begin(0);f.page(0,3,0);f.finish(0,'NO_PROGRESS');
  f.begin(1);f.page(1,3,2);f.finish(1,'PAGE_BUDGET_REACHED');
  assert.deepEqual(f.indices({resume:true,recoverStalled:false}),[1]);
  assert.deepEqual(f.indices({resume:true,recoverStalled:true}),[0,1]);
});
