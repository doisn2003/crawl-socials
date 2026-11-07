import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runQueryCollectors } from '../src/application/query-collector.js';
import { createWindowScheduler } from '../src/application/window-scheduler.js';

test('ALL keeps existing keyword windows through CPU bursts and yields only at critical memory', async () => {
  let clock = 10000, cpuBusy = 0, freeBytes = 8e9;
  const scheduler = createWindowScheduler({ now: () => clock, staggerMs: 0, sample: () => ({ freeBytes, totalBytes: 16e9, cpuBusy }) });
  const leases = await Promise.all(Array.from({ length: 6 }, () => scheduler.acquire('facebook', true, () => false)));
  cpuBusy = .99; clock += 2000;
  assert.ok(leases.every(lease => !lease.shouldYield()), 'loading pressure must not cause close/reopen churn');
  freeBytes = 200e6; clock += 2000;
  assert.ok(leases.every(lease => lease.shouldYield()));
  leases.forEach(lease => lease.release());
});
import type { CollectorInput } from '../src/application/production-service.js';

test('a waiting search gets the next Electron slot before the comment worker', async () => {
  const windows = createWindowScheduler({ staggerMs: 0, sample: () => ({ freeBytes: 8e9, totalBytes: 16e9, cpuBusy: .75 }) });
  const stop = () => false;
  const first = await windows.acquire('facebook', false, stop), second = await windows.acquire('threads', false, stop);
  const order: string[] = [];
  const comments = windows.acquire('facebook', false, stop, 'fixture', true).then(lease => { order.push('comments'); return lease; });
  const search = windows.acquire('facebook', false, stop, 'fixture').then(lease => { order.push('search'); return lease; });
  first.release();
  await Promise.resolve();
  second.release();
  const leases = await Promise.all([comments, search]);
  leases.forEach(lease => lease.release());
  assert.deepEqual(order, ['search', 'comments']);
  assert.equal(windows.status().active, 0);
});


test('8 keywords x 2 platforms own 16 independent windows/checkpoints; failed window does not cancel siblings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-query-'));
  const windows = createWindowScheduler({ sample: () => ({ freeBytes: 12e9, totalBytes: 16e9, cpuBusy: 0.1 }), staggerMs: 0 });
  const calls = new Map<string, number>(), childConfigs = new Map<string, string>(); let active = 0, peak = 0;
  try {
    const results = await Promise.all((['facebook', 'threads'] as const).map(platform => {
      const input: CollectorInput = { platform, profileId: 'fixture-' + platform, config: { runId: 'query-test-' + platform,
        output: join(root, platform), queries: Array.from({ length: 8 }, (_, i) => 'keyword ' + i), maxMinutes: 10, windowMode: 'ALL' },
        shouldStop: () => false, onProgress() {} };
      return runQueryCollectors(input, async (child, id) => {
        assert.ok(id); assert.equal((child.config.queries as string[]).length, 1); assert.equal(child.config.maxScrollsPerQuery, 3);
        const count = (calls.get(id) ?? 0) + 1; calls.set(id, count);
        if (childConfigs.has(id)) { assert.equal(JSON.stringify(child.config), childConfigs.get(id)); assert.equal(child.resume, true); }
        else childConfigs.set(id, JSON.stringify(child.config));
        peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
        if (platform === 'facebook' && (child.config.queries as string[])[0] === 'keyword 0') throw Error('WINDOW_CLOSED');
        return { stop_reason: count === 1 ? 'QUERY_BUDGET_COMPLETE' : 'SOURCE_EXHAUSTED', summary: { unique: 0 }, session_flush: 'OK' };
      }, windows);
    }));
    assert.equal(calls.size, 16); assert.equal(peak, 16);
    assert.equal(results[0]!.stop_reason, 'QUERY_WORKER_FAILED'); assert.equal(results[1]!.stop_reason, 'SOURCE_EXHAUSTED');
    const tasks = JSON.parse(readFileSync(join(root, 'facebook', 'runs', 'query-test-facebook', 'query-tasks.json'), 'utf8')).tasks;
    assert.equal(tasks.filter((t: { state: string }) => t.state === 'COMPLETED').length, 7);
    assert.equal(new Set([...childConfigs.values()].map(s => JSON.parse(s).output)).size, 16);
    assert.equal(windows.status().active, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resource pressure yields excess windows and queued user cancellation releases all slots', async () => {
  let clock = 2000, freeBytes = 12e9;
  const windows = createWindowScheduler({ now: () => clock, staggerMs: 0, sample: () => ({ freeBytes, totalBytes: 16e9, cpuBusy: 0 }) });
  const first = await windows.acquire('facebook', true, () => false), second = await windows.acquire('threads', true, () => false);
  freeBytes = 1e8; clock += 2000;
  assert.equal(first.shouldYield(), true); assert.equal(second.shouldYield(), true);
  await assert.rejects(windows.acquire('facebook', true, () => true), /USER_STOP/);
  first.release(); second.release(); assert.equal(windows.status().active, 0);
});

test('optional AI expansion failure is recorded and does not stop raw collection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-query-expansion-'));
  const windows = createWindowScheduler({ sample: () => ({ freeBytes: 12e9, totalBytes: 16e9, cpuBusy: 0 }), staggerMs: 0 });
  let calls = 0, expansions = 0;
  try {
    const input: CollectorInput = { platform: 'facebook', profileId: 'fixture', config: {
      runId: 'expansion-test', output: root, queries: ['piano'], maxMinutes: 10, windowMode: 'ALL' },
      shouldStop: () => false, onProgress() {}, expandQueries: async () => { expansions++; throw Error('MODEL_BUDGET_EXHAUSTED'); } };
    const result = await runQueryCollectors(input, async () => ({ stop_reason: ++calls === 1 ? 'QUERY_BUDGET_COMPLETE' : 'SOURCE_EXHAUSTED', summary: { unique: 0 } }), windows);
    assert.equal(calls, 2); assert.equal(expansions, 1); assert.equal(result.stop_reason, 'QUERY_BUDGET_COMPLETE');
    const saved = JSON.parse(readFileSync(join(root, 'runs', 'expansion-test', 'query-tasks.json'), 'utf8'));
    assert.equal(saved.expansionError, 'MODEL_BUDGET_EXHAUSTED');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('all reserved waves receive a first slice and retain an immutable coordinator deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-query-waves-'));
  const windows = createWindowScheduler({ sample: () => ({ freeBytes: 12e9, totalBytes: 16e9, cpuBusy: 0 }), staggerMs: 0 });
  const visited: string[] = []; let wave = 0;
  try {
    const config = { runId: 'waves-test', output: root, queries: ['initial'], maxMinutes: 720, windowMode: 'ALL', warmPageLimit: 24 };
    const result = await runQueryCollectors({ platform: 'facebook', profileId: 'fixture', config, shouldStop: () => false, onProgress() {},
      expandQueries: async () => ++wave <= 3 ? Array.from({ length: wave === 3 ? 79 : 80 }, (_, i) => `wave ${wave} query ${i}`) : [] },
    async child => { visited.push((child.config.queries as string[])[0]!); return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } }; }, windows);
    assert.equal(visited.length, 240); assert.equal(new Set(visited).size, 240); assert.equal(result.stop_reason, 'SOURCE_EXHAUSTED');
    const manifest = JSON.parse(readFileSync(join(root, 'runs', 'waves-test', 'manifest.json'), 'utf8'));
    const state = JSON.parse(readFileSync(join(root, 'runs', 'waves-test', 'query-tasks.json'), 'utf8'));
    assert.equal(manifest.started_at, state.startedAt); assert.equal(manifest.config.maxMinutes, 720);
    assert.ok(state.tasks.every((task: { elapsedMs?: number }) => typeof task.elapsedMs === 'number'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AUTO keeps loaded windows through a transient CPU spike', async () => {
  let clock = 10000, cpuBusy = .1;
  const windows = createWindowScheduler({ sample: () => ({ freeBytes: 12e9, totalBytes: 16e9, cpuBusy }), now: () => clock, staggerMs: 0 });
  const first = await windows.acquire('facebook', false, () => false, 'profile-a');
  const second = await windows.acquire('facebook', false, () => false, 'profile-b');
  cpuBusy = .99; clock += 1500;
  assert.equal(first.shouldYield(), false); assert.equal(second.shouldYield(), false);
  clock += 6000;
  assert.equal(second.shouldYield(), true);
  first.release(); second.release();
});


test('CPU yield waits until resumed replay reaches a fresh durable page, while critical memory yields immediately', async () => {
  const root = mkdtempSync(join(tmpdir(), 'csd-replay-pressure-'));
  try {
    for (const critical of [false, true]) {
      const windows = { acquire: async () => ({release() {}, shouldYield: () => true}),
        status: () => ({ freeBytes: critical ? 100e6 : 8e9 }) } as unknown as ReturnType<typeof createWindowScheduler>;
      await runQueryCollectors({ platform: 'threads', profileId: 'fixture', shouldStop: () => false, onProgress() {},
        config: { runId: 'pressure-' + critical, output: join(root, String(critical)), queries: ['cafe'], maxMinutes: 10, warmPageLimit: 24 } },
      async child => {
        assert.equal(child.collectionLimitReason?.(), critical ? 'RESOURCE_YIELD' : null);
        child.onProgress({ event: 'YIELD', replaying: true });
        assert.equal(child.collectionLimitReason?.(), critical ? 'RESOURCE_YIELD' : null);
        child.onProgress({ event: 'YIELD', replaying: false });
        assert.equal(child.collectionLimitReason?.(), 'RESOURCE_YIELD');
        return { stop_reason: 'SOURCE_EXHAUSTED', summary: { unique: 0 } };
      }, windows);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('stalled native frontiers receive only two durable cooldown recoveries without false exhaustion', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-stalled-native-'));let calls=0,clock=Date.now();
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  try {
    const result=await runQueryCollectors({platform:'threads',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'stalled-native',output:root,queries:['cafe chill'],maxMinutes:10}},async()=>{
        calls++;return {stop_reason:calls===1?'QUERY_BUDGET_COMPLETE':'SOURCE_EXHAUSTED',summary:{unique:0},
          checkpoint:{discovery_frontier:{jobs:[{state:'STALLED',reason:'NO_PROGRESS'},{state:'EXHAUSTED',reason:'NATIVE_END_OBSERVED'}]}}};
      },windows,{now:()=>clock,sleep:async ms=>{assert.equal(windows.status().active,0);clock+=ms;}});
    assert.equal(calls,3);assert.equal(result.stop_reason,'QUERY_BUDGET_COMPLETE');
    const saved=JSON.parse(readFileSync(join(root,'runs/stalled-native/query-tasks.json'),'utf8'));
    assert.equal(saved.tasks[0].reason,'NO_PROGRESS');assert.equal(saved.tasks[0].state,'STOPPED');assert.equal(saved.tasks[0].stallRecoveries,2);
    await runQueryCollectors({platform:'threads',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'stalled-native',output:root,queries:['cafe chill'],maxMinutes:10}},async()=>{throw Error('RECOVERY_MUST_NOT_RESET');},windows,{now:()=>clock});
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('Stop interrupts stall cooldown and resume retains its remaining wait', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-stall-stop-'));let clock=Date.now(),stop=false,calls=0;
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  const config={runId:'stall-stop',output:root,queries:['cafe'],maxMinutes:10};
  const collect=async()=>{calls++;return {stop_reason:'NO_PROGRESS',summary:{unique:0}};};
  try {
    const result=await runQueryCollectors({platform:'facebook',profileId:'fixture',config,shouldStop:()=>stop,onProgress(){}},collect,windows,
      {now:()=>clock,sleep:async ms=>{clock+=ms;stop=true;}});
    assert.equal(calls,1);assert.equal(result.stop_reason,'USER_STOP');
    const saved=JSON.parse(readFileSync(join(root,'runs/stall-stop/query-tasks.json'),'utf8'));
    assert.ok(saved.tasks[0].retryAt>clock);assert.equal(saved.tasks[0].stallRecoveries,1);
    stop=false;let waited=0;
    await runQueryCollectors({platform:'facebook',profileId:'fixture',config,shouldStop:()=>stop,onProgress(){}},
      async child=>{assert.ok(waited>=29750);assert.equal(child.recoverStalled,true);calls++;return {stop_reason:'SOURCE_EXHAUSTED',summary:{unique:0}};},windows,
      {now:()=>clock,sleep:async ms=>{clock+=ms;waited+=ms;}});
    assert.equal(calls,2);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('expansion sees all known queries and every new query runs before deeper work', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-known-query-'));
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  const known:string[][]=[],visited:string[]=[];
  try {
    await runQueryCollectors({platform:'facebook',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'known-query',output:root,queries:['initial'],maxMinutes:10},
      expandQueries:async request=>{known.push(request?.knownQueries??[]);return known.length===1?['new branch']:[];}},
      async child=>{visited.push((child.config.queries as string[])[0]!);return {stop_reason:'SOURCE_EXHAUSTED',summary:{unique:0}};},windows);
    assert.deepEqual(known,[['initial'],['initial','new branch']]);assert.deepEqual(visited,['initial','new branch']);
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('campaign deadline still ends cooldown recovery before another browser is opened', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-stall-deadline-'));let clock=Date.now(),calls=0;
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  try {
    const result=await runQueryCollectors({platform:'facebook',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'stall-deadline',output:root,queries:['cafe'],maxMinutes:1}},
      async()=>{calls++;return {stop_reason:'NO_PROGRESS',summary:{unique:0}};},windows,{now:()=>clock,sleep:async ms=>{clock+=ms;}});
    assert.equal(calls,2);assert.equal(result.stop_reason,'RUN_DEADLINE');assert.equal(windows.status().active,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('renderer revision grants one recovery without resetting prior stall counters or ledger-independent config', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-render-recovery-'));let clock=Date.now(),calls=0;
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  const config={runId:'render-recovery',output:root,queries:['cafe'],maxMinutes:10};
  const input:CollectorInput={platform:'facebook',profileId:'fixture',config,shouldStop:()=>false,onProgress(){}};
  const runtime={now:()=>clock,sleep:async(ms:number)=>{clock+=ms;}};
  try {
    await runQueryCollectors(input,async()=>({stop_reason:'NO_PROGRESS',summary:{unique:0}}),windows,runtime);
    const file=join(root,'runs/render-recovery/query-tasks.json'),old=JSON.parse(readFileSync(file,'utf8'));
    delete old.collectorRevision;writeFileSync(file,JSON.stringify(old));
    await runQueryCollectors(input,async child=>{calls++;assert.equal(child.recoverStalled,true);return {stop_reason:'NO_PROGRESS',summary:{unique:0}};},windows,runtime);
    const saved=JSON.parse(readFileSync(file,'utf8'));assert.equal(calls,1);assert.equal(saved.tasks[0].stallRecoveries,2);
    assert.equal(saved.renderingMigration.previous[0].stallRecoveries,2);assert.equal(saved.fingerprint,old.fingerprint);assert.equal(saved.startedAt,old.startedAt);
    await runQueryCollectors(input,async()=>{throw Error('MIGRATION_MUST_NOT_REPEAT');},windows,runtime);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('empty initial coverage preflight does not disable target-driven later waves', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-preflight-waves-'));const requests:unknown[]=[];const visited:string[]=[];
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  try {
    await runQueryCollectors({platform:'facebook',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'preflight-waves',output:root,queries:['initial'],maxMinutes:10},
      expandQueries:async request=>{requests.push(request);return request?.completeInitial?[]:requests.length===2?['new branch']:[];}},
      async child=>{visited.push((child.config.queries as string[])[0]!);return {stop_reason:'SOURCE_EXHAUSTED',summary:{unique:0}};},windows);
    assert.deepEqual(visited,['initial','new branch']);assert.equal(requests.length,3);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('invalid expansion remains visibly incomplete with bounded retries while existing collection continues', async () => {
  const root=mkdtempSync(join(tmpdir(),'csd-incomplete-wave-'));let expands=0,collects=0;
  const windows=createWindowScheduler({sample:()=>({freeBytes:12e9,totalBytes:16e9,cpuBusy:0}),staggerMs:0});
  try {
    const result=await runQueryCollectors({platform:'facebook',profileId:'fixture',shouldStop:()=>false,onProgress(){},
      config:{runId:'incomplete-wave',output:root,queries:['initial'],maxMinutes:10},
      expandQueries:async()=>{expands++;throw Error('QUERY_COVERAGE_INCOMPLETE');}},
      async()=>({stop_reason:++collects<4?'QUERY_BUDGET_COMPLETE':'SOURCE_EXHAUSTED',summary:{unique:0}}),windows);
    const saved=JSON.parse(readFileSync(join(root,'runs/incomplete-wave/query-tasks.json'),'utf8'));
    assert.equal(expands,3);assert.equal(collects,4);assert.equal(result.stop_reason,'QUERY_BUDGET_COMPLETE');assert.equal(saved.expansionExhausted,false);assert.equal(saved.expansionDeferred,true);assert.equal(saved.expansionError,'QUERY_COVERAGE_INCOMPLETE');
  } finally {rmSync(root,{recursive:true,force:true});}
});
