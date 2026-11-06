import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionService } from '../src/application/production-service.js';
import type { CollectorInput, CollectorReceipt, ProductionHost } from '../src/application/production-service.js';
import type { BrowserProfile } from '../src/domain/browser-profile.js';
import type { Platform, RunState } from '../src/shared/production-api.js';

const fbId = 'csd-00000000-0000-4000-8000-000000000001';
const threadId = 'csd-00000000-0000-4000-8000-000000000002';
const selection = [ { platform: 'facebook' as const, profileId: fbId }, { platform: 'threads' as const, profileId: threadId } ];
function profile(id: string, platform: Platform): BrowserProfile {
  return { id, platform, label: platform, createdAt: '2026-10-29T00:00:00.000Z', accountBinding: { status: 'UNVERIFIED', accountId: null, revision: 0 } };
}
function hostWithProfiles(initial = [profile(fbId, 'facebook'), profile(threadId, 'threads')]) {
  const profiles = initial.slice(), authenticated = new Map(profiles.map(value => [value.id, true]));
  const opened: string[] = [];
  const host: ProductionHost = {
    async list() { return profiles.map(value => ({ ...value, open: false, persistenceError: null })); },
    async sessionStatus(id) { return authenticated.get(id) === true; },
    async create(label, platform) { const value = { ...profile('csd-' + randomUUID(), platform), label }; profiles.push(value); return value; },
    async openLogin(id) { opened.push(id); },
  };
  return { host, profiles, authenticated, opened };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function posts(input: CollectorInput, count: number) {
  const data = Array.from({ length: count }, (_, index) => ({
    post_id: String(1000 + index), text: 'Bài thu từ nguồn ' + input.platform, query: (input.config.queries as string[])[0],
    ...(input.platform === 'facebook' ? { observed_post_url: 'https://www.facebook.com/example/posts/' + index } : { post_url: 'https://www.threads.com/@example/post/' + index }),
  }));
  writeFileSync(join(String(input.config.output), 'posts.jsonl'), data.map(row => JSON.stringify(row)).join('\n') + (data.length ? '\n' : ''));
  return data;
}
async function temporary(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'csd-production-service-'));
  try { await work(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('csd-production-service-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
const completed = async (input: CollectorInput): Promise<CollectorReceipt> => { posts(input, 1); return { stop_reason: 'TARGET_REACHED', summary: { unique: 1 } }; };

test('explicit add-account creates another isolated profile while ordinary login reuses the selected account', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), service = createProductionService({ directory, version: 'test', host: fixture.host, collect: completed });
  await service.login({ platform: 'facebook' }); assert.equal(fixture.profiles.length, 2); assert.equal(fixture.opened.at(-1), fbId);
  await service.login({ platform: 'facebook', createNew: true });
  assert.equal(fixture.profiles.length, 3); assert.notEqual(fixture.opened.at(-1), fbId); assert.equal(fixture.profiles.at(-1)!.label, 'CSD Facebook 2');
  await service.login({ platform: 'facebook', profileId: fbId }); assert.equal(fixture.opened.at(-1), fbId);
  await assert.rejects(service.login({ platform: 'facebook', profileId: fbId, createNew: true }), /LOGIN_INPUT_INVALID/);
}));

test('same-network accounts have independent writers and one deduplicated durable platform export', async () => temporary(async directory => {
  const secondId = 'csd-00000000-0000-4000-8000-000000000003';
  const fixture = hostWithProfiles([profile(fbId, 'facebook'), profile(secondId, 'facebook')]), outputs: string[] = [], ids: string[] = [];
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    outputs.push(String(input.config.output)); ids.push(String(input.config.runId));
    const data = [{ post_id: 'shared', observed_post_url: 'https://www.facebook.com/example/posts/shared', text: 'Bài chung' },
      { post_id: input.profileId, observed_post_url: 'https://www.facebook.com/example/posts/' + input.profileId, text: 'Bài riêng' }];
    writeFileSync(join(String(input.config.output), 'posts.jsonl'), data.map(row => JSON.stringify(row)).join('\n') + '\n');
    return { stop_reason: input.profileId === fbId ? 'ACCOUNT_BARRIER' : 'TARGET_REACHED', summary: { unique: 2 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  await service.start({ profiles: [fbId, secondId].map(profileId => ({ platform: 'facebook', profileId })) }); await service.settled();
  const result = service.results();
  assert.equal(new Set(outputs).size, 2); assert.equal(new Set(ids).size, 2);
  assert.ok(outputs.every(path => path.includes('profiles')));
  assert.equal(result.facebook.length, 3); assert.deepEqual(result.run.platforms.map(p => p.count), [2, 2]);
  assert.equal(result.run.platforms[1]!.state, 'COMPLETED', 'one account barrier does not cancel healthy siblings');
  const persisted = JSON.parse(readFileSync(join(result.run.outputDirectory, 'facebook', 'posts.json'), 'utf8'));
  assert.equal(persisted.length, 3);
  const restarted = createProductionService({ directory, version: 'test', host: fixture.host, collect: completed });
  assert.equal(restarted.results().facebook.length, 3); assert.equal(restarted.readRunState(result.run.id)?.platforms.length, 2);
}));

test('crawl requires user keywords, valid profile UUIDs and an authenticated account for each selected platform', async () => temporary(async directory => {
  const fixture = hostWithProfiles(); let calls = 0;
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => { calls++; return completed(input); } });
  assert.deepEqual((await service.getState()).config.keywords, []);
  await assert.rejects(service.start({ profiles: [selection[0]] }), /KEYWORDS_REQUIRED/);
  service.saveConfig({ keywords: ['đề tài của người dùng'], minimumPosts: 1 });
  for (const profiles of [[], [selection[0], selection[0]], [{ platform: 'facebook', profileId: 'arbitrary' }], [{ ...selection[0], url: 'https://example.com' }]]) {
    await assert.rejects(service.start({ profiles }), /COLLECTION_INPUT_INVALID/);
  }
  fixture.authenticated.set(fbId, false);
  await assert.rejects(service.start({ profiles: [selection[0]] }), /LOGIN_REQUIRED/);
  await assert.rejects(service.start({ profiles: [{ platform: 'threads', profileId: fbId }] }), /LOGIN_REQUIRED/);
  assert.equal(calls, 0);
  assert.equal((await service.getState()).run, null);
}));

test('each selected network receives the full minimum and the combined JSON contains both durable collections', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), calls: CollectorInput[] = [];
  const service = createProductionService({ directory, version: '1.0.0', host: fixture.host, collect: async input => {
    calls.push(input); posts(input, 2); input.onProgress({ total: 2, event: 'BATCH' });
    return { stop_reason: 'TARGET_REACHED', summary: { unique: 2 } };
  } });
  service.saveConfig({ keywords: ['cà phê', 'quán sách'], minimumPosts: 2 });
  await service.start({ profiles: selection }); await service.settled();
  assert.deepEqual(calls.map(value => value.platform), ['facebook', 'threads']);
  assert.equal(calls[0]!.config.targetNewRecords, 2); assert.equal(calls[1]!.config.targetTotal, 2);
  assert.deepEqual(calls[0]!.config.queries, ['cà phê', 'quán sách']);
  assert.notEqual(calls[0]!.config.output, calls[1]!.config.output);
  const result = service.results();
  assert.equal(result.run.state, 'COMPLETED');
  assert.deepEqual(result.run.platforms.map(value => value.count), [2, 2]);
  assert.equal(result.facebook.length, 2); assert.equal(result.threads.length, 2);
  const json = JSON.parse(readFileSync(join(result.run.outputDirectory, 'results.json'), 'utf8'));
  assert.equal(json.facebook.length, 2); assert.equal(json.threads.length, 2);
  assert.equal(result.run.preview.length, 4);
}));

for (const firstPlatform of ['facebook', 'threads'] as const) {
  test(`both networks start together and ${firstPlatform} can finish without ending the other`, async () => temporary(async directory => {
    const holds = { facebook: deferred<void>(), threads: deferred<void>() }, calls: CollectorInput[] = [];
    const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
      calls.push(input); input.onProgress({ total: input.platform === 'facebook' ? 2 : 3 });
      await holds[input.platform].promise;
      return completed(input);
    } });
    service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
    try {
      await service.start({ profiles: selection });
      assert.deepEqual(calls.map(value => value.platform).sort(), ['facebook', 'threads']);
      assert.deepEqual(calls.map(value => value.profileId), [fbId, threadId]);
      assert.deepEqual(service.progress()!.platforms.map(value => value.state), ['RUNNING', 'RUNNING']);
      let finished = false; void service.settled().then(() => { finished = true; });
      holds[firstPlatform].resolve(); await new Promise<void>(setImmediate);
      const other = firstPlatform === 'facebook' ? 'threads' : 'facebook';
      const progress = service.progress()!;
      assert.equal(progress.state, 'RUNNING'); assert.equal(finished, false);
      assert.equal(progress.platforms.find(value => value.platform === firstPlatform)!.state, 'COMPLETED');
      assert.equal(progress.platforms.find(value => value.platform === other)!.state, 'RUNNING');
      assert.equal(progress.platforms.find(value => value.platform === other)!.count, other === 'facebook' ? 2 : 3);
      assert.equal(calls.find(value => value.platform === other)!.shouldStop(), false);
      assert.throws(() => service.results(), /RESULTS_UNAVAILABLE/);
      await assert.rejects(service.start({ profiles: selection }), /COLLECTION_BUSY/);
    } finally {
      holds.facebook.resolve(); holds.threads.resolve(); await service.settled();
    }
    assert.equal(service.results().run.state, 'COMPLETED');
    assert.deepEqual(service.results().run.platforms.map(value => value.count), [1, 1]);
  }));
}

test('concurrent starts cannot launch duplicate runs or mutate active configuration', async () => temporary(async directory => {
  const hold = deferred<void>(), fixture = hostWithProfiles(); let calls = 0;
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    calls++; await hold.promise; return completed(input);
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  const first = service.start({ profiles: [selection[0]] });
  await assert.rejects(service.start({ profiles: [selection[0]] }), /COLLECTION_BUSY/);
  await first;
  assert.throws(() => service.saveConfig({ keywords: ['changed'], minimumPosts: 2 }), /COLLECTION_BUSY/);
  await assert.rejects(service.login({ platform: 'facebook' }), /COLLECTION_BUSY/);
  assert.throws(() => service.results(), /RESULTS_UNAVAILABLE/);
  hold.resolve(); await service.settled(); assert.equal(calls, 1);
}));

test('Stop signals both active networks and waits for both to preserve their partial JSON', async () => temporary(async directory => {
  const holds = { facebook: deferred<void>(), threads: deferred<void>() }, calls: CollectorInput[] = [];
  const fixture = hostWithProfiles();
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    calls.push(input); posts(input, 1); await holds[input.platform].promise;
    return { stop_reason: 'USER_STOP', summary: { unique: 1 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 10 });
  try {
    await service.start({ profiles: selection });
    assert.equal(calls.length, 2);
    assert.equal((await service.stop()).run!.state, 'STOPPING');
    assert.ok(calls.every(input => input.shouldStop()));
    holds.facebook.resolve(); await new Promise<void>(setImmediate);
    assert.equal(service.progress()!.state, 'STOPPING');
    assert.equal((await service.getState()).run!.finishedAt, null);
    assert.throws(() => service.results(), /RESULTS_UNAVAILABLE/);
  } finally { holds.facebook.resolve(); holds.threads.resolve(); await service.settled(); }
  const result = service.results();
  assert.equal(result.run.state, 'STOPPED');
  assert.deepEqual(result.run.platforms.map(value => value.state), ['STOPPED', 'STOPPED']);
  assert.equal(result.facebook.length, 1); assert.equal(result.threads.length, 1);
  const json = JSON.parse(readFileSync(join(result.run.outputDirectory, 'results.json'), 'utf8'));
  assert.equal(json.facebook.length, 1); assert.equal(json.threads.length, 1);
}));

test('Stop during simultaneous collector setup stops both sources without creating posts', async () => temporary(async directory => {
  const hold = deferred<void>(), entered = deferred<CollectorInput>(); let calls = 0;
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    calls++; entered.resolve(input); await hold.promise;
    assert.equal(input.shouldStop(), true);
    // The collector has not navigated or written a post yet.
    throw Error('USER_STOP');
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  await service.start({ profiles: selection }); await entered.promise;
  await service.stop(); hold.resolve(); await service.settled();
  const result = service.results();
  assert.equal(calls, 2);
  assert.equal(result.run.state, 'STOPPED');
  assert.deepEqual(result.run.platforms.map(value => ({ state: value.state, reason: value.reason, count: value.count })), [
    { state: 'STOPPED', reason: 'USER_STOP', count: 0 },
    { state: 'STOPPED', reason: 'USER_STOP', count: 0 },
  ]);
  assert.deepEqual(result.facebook, []); assert.deepEqual(result.threads, []);
  const json = JSON.parse(readFileSync(join(result.run.outputDirectory, 'results.json'), 'utf8'));
  assert.deepEqual(json.facebook, []); assert.deepEqual(json.threads, []);
}));

test('Stop while both sessions are being rechecked prevents either collector from opening', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), hold = deferred<void>(), reached = deferred<void>();
  const checks = new Map<string, number>(); let waiting = 0, calls = 0;
  fixture.host.sessionStatus = async id => {
    const count = (checks.get(id) || 0) + 1; checks.set(id, count);
    if (count === 2) { if (++waiting === 2) reached.resolve(); await hold.promise; }
    return true;
  };
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    calls++; return completed(input);
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  const started = service.start({ profiles: selection });
  try {
    await reached.promise; await service.stop();
  } finally { hold.resolve(); await started; await service.settled(); }
  assert.equal(calls, 0);
  assert.equal(service.results().run.state, 'STOPPED');
  assert.deepEqual(service.results().run.platforms.map(value => value.reason), ['USER_STOP', 'USER_STOP']);
}));

test('a failed session flush overrides a reached target while preserving exported post data', async () => temporary(async directory => {
  let sessionFlush = 'OK';
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    posts(input, 1);
    return { stop_reason: 'TARGET_REACHED', summary: { unique: 1 }, session_flush: sessionFlush };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  await service.start({ profiles: [selection[0]] }); await service.settled();
  assert.equal(service.results().run.state, 'COMPLETED');
  sessionFlush = 'FAILED';
  await service.start({ profiles: [selection[0]] }); await service.settled();
  const result = service.results();
  assert.equal(result.run.state, 'FAILED');
  assert.equal(result.run.platforms[0]!.state, 'FAILED');
  assert.equal(result.run.platforms[0]!.reason, 'SESSION_SAVE_FAILED');
  assert.equal(result.run.platforms[0]!.count, 1);
  assert.equal(result.facebook.length, 1);
  assert.equal(JSON.parse(readFileSync(join(result.run.outputDirectory, 'results.json'), 'utf8')).facebook.length, 1);
}));

test('a collector failure preserves its partial data and allows the other selected network to finish', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), hold = deferred<void>();
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    posts(input, 1); if (input.platform === 'facebook') throw Error('ACCOUNT_BARRIER');
    await hold.promise;
    return { stop_reason: 'TARGET_REACHED', summary: { unique: 1 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  try {
    await service.start({ profiles: selection }); await new Promise<void>(setImmediate);
    assert.equal(service.progress()!.state, 'RUNNING');
    assert.deepEqual(service.progress()!.platforms.map(value => value.state), ['FAILED', 'RUNNING']);
    assert.throws(() => service.results(), /RESULTS_UNAVAILABLE/);
    await assert.rejects(service.start({ profiles: selection }), /COLLECTION_BUSY/);
  } finally { hold.resolve(); await service.settled(); }
  const result = service.results();
  assert.equal(result.run.state, 'FAILED'); assert.equal(result.facebook.length, 1); assert.equal(result.threads.length, 1);
  assert.equal(result.run.platforms[0]!.reason, 'ACCOUNT_BARRIER'); assert.equal(result.run.platforms[1]!.state, 'COMPLETED');
  assert.equal((await service.getState()).accounts.find(value => value.id === fbId)!.authenticated, false);
}));

test('shutdown signals both sources and waits for each profile cleanup before resolving', async () => temporary(async directory => {
  const holds = { facebook: deferred<void>(), threads: deferred<void>() }, calls: CollectorInput[] = [];
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    calls.push(input); posts(input, 1); await holds[input.platform].promise;
    return { stop_reason: 'USER_STOP', summary: { unique: 1 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 10 });
  try {
    await service.start({ profiles: selection }); assert.equal(calls.length, 2);
    let closed = false; const shutdown = service.shutdown().then(() => { closed = true; });
    assert.ok(calls.every(input => input.shouldStop()));
    holds.threads.resolve(); await new Promise<void>(setImmediate);
    assert.equal(closed, false);
    holds.facebook.resolve(); await shutdown;
    assert.equal(closed, true);
    assert.deepEqual(service.results().run.platforms.map(value => value.count), [1, 1]);
  } finally { holds.facebook.resolve(); holds.threads.resolve(); await service.settled(); }
}));

test('an unexpected source finalization failure cannot unlock a run while the other collector is active', async () => temporary(async directory => {
  const hold = deferred<void>(); let threadsInput: CollectorInput | undefined;
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    if (input.platform === 'facebook') {
      writeFileSync(join(String(input.config.output), 'posts.jsonl'), 'invalid committed record\n');
    } else { threadsInput = input; await hold.promise; posts(input, 1); }
    return { stop_reason: 'TARGET_REACHED', summary: { unique: 1 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  try {
    await service.start({ profiles: selection }); await new Promise<void>(setImmediate);
    assert.ok(threadsInput); assert.equal(threadsInput.shouldStop(), false);
    assert.equal(service.progress()!.state, 'RUNNING');
    assert.equal((await service.getState()).run!.finishedAt, null);
    await assert.rejects(service.start({ profiles: selection }), /COLLECTION_BUSY/);
    await service.stop(); assert.equal(threadsInput.shouldStop(), true);
  } finally { hold.resolve(); await service.settled(); }
  const final = service.progress()!;
  assert.equal(final.state, 'FAILED');
  assert.equal(final.platforms[0]!.reason, 'COLLECTION_DATA_INVALID');
  assert.equal(final.platforms[1]!.state, 'COMPLETED');
  assert.equal(final.platforms[1]!.count, 1);
}));

test('restart marks an unfinished run interrupted and recovers committed JSONL without a torn final line', async () => temporary(async directory => {
  const id = 'crawl-' + randomUUID(), outputDirectory = join(directory, 'collections', id);
  const run: RunState = { id, outputDirectory, state: 'RUNNING', startedAt: '2026-10-29T00:00:00.000Z', finishedAt: null,
    minimumPosts: 10, keywords: ['x'], platforms: [ { ...selection[0]!, state: 'RUNNING', count: 0, reason: null },
      { ...selection[1]!, state: 'QUEUED', count: 0, reason: null } ], preview: [] };
  mkdirSync(join(outputDirectory, 'facebook'), { recursive: true });
  writeFileSync(join(outputDirectory, 'facebook', 'posts.jsonl'), JSON.stringify({ post_id: '1', text: 'đã ghi', query: 'x' }) + '\n{"post_id":');
  writeFileSync(join(directory, 'latest-run.json'), JSON.stringify(run));
  let calls = 0;
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => { calls++; return completed(input); } });
  const result = service.results();
  assert.equal(result.run.state, 'INTERRUPTED'); assert.equal(result.run.platforms[0]!.count, 1);
  assert.deepEqual(result.run.platforms.map(value => value.reason), ['APP_INTERRUPTED', 'APP_INTERRUPTED']);
  assert.equal(result.facebook.length, 1); assert.equal(calls, 0);
  assert.equal(JSON.parse(readFileSync(join(directory, 'latest-run.json'), 'utf8')).state, 'INTERRUPTED');
}));

test('initial persistence failure releases the start lock so the user can retry', async () => temporary(async directory => {
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: completed });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  const obstruction = join(directory, 'latest-run.json.next'); mkdirSync(obstruction);
  await assert.rejects(service.start({ profiles: [selection[0]] }));
  rmdirSync(obstruction);
  assert.equal((await service.getState()).run, null);
  service.saveConfig({ keywords: ['retry'], minimumPosts: 1 });
  await service.start({ profiles: [selection[0]] }); await service.settled();
  assert.equal(service.results().run.state, 'COMPLETED');
}));

test('a progress persistence exception is surfaced as a failed source while committed records remain exportable', async () => temporary(async directory => {
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    posts(input, 1); const obstruction = join(directory, 'latest-run.json.next'); mkdirSync(obstruction);
    let failure: unknown;
    try { input.onProgress({ total: 1 }); }
    catch (error) { failure = error; }
    finally { rmdirSync(obstruction); }
    assert.ok(failure, 'progress persistence errors must not be swallowed');
    throw Error('PERSISTENCE_FAILED');
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 10 });
  await service.start({ profiles: [selection[0]] }); await service.settled();
  const result = service.results();
  assert.equal(result.run.state, 'FAILED'); assert.equal(result.run.platforms[0]!.reason, 'PERSISTENCE_FAILED');
  assert.equal(result.facebook.length, 1);
}));

test('completion uses durable records even when a collector receipt overstates its total', async () => temporary(async directory => {
  const service = createProductionService({ directory, version: 'test', host: hostWithProfiles().host, collect: async input => {
    posts(input, 1); return { stop_reason: 'TARGET_REACHED', summary: { unique: 10 } };
  } });
  service.saveConfig({ keywords: ['x'], minimumPosts: 10 });
  await service.start({ profiles: [selection[0]] }); await service.settled();
  assert.equal(service.results().run.platforms[0]!.count, 1);
  assert.notEqual(service.results().run.state, 'COMPLETED');
}));

test('concurrent first logins do not create duplicate profiles', async () => temporary(async directory => {
  const fixture = hostWithProfiles([]);
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: completed });
  const results = await Promise.allSettled([service.login({ platform: 'facebook' }), service.login({ platform: 'facebook' })]);
  assert.ok(results.some(value => value.status === 'fulfilled'));
  for (const value of results) if (value.status === 'rejected') assert.match(String(value.reason), /BUSY|PENDING/);
  assert.equal(fixture.profiles.length, 1);
}));

test('a pending login cannot navigate a profile into authentication while a crawl starts', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), hold = deferred<void>(), entered = deferred<void>();
  const originalList = fixture.host.list;
  fixture.host.list = async () => { entered.resolve(); await hold.promise; return originalList(); };
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: completed });
  service.saveConfig({ keywords: ['x'], minimumPosts: 1 });
  const login = service.login({ platform: 'facebook' }); await entered.promise;
  const start = service.start({ profiles: [selection[0]] });
  // Attach rejection checking before releasing the asynchronous login operation.
  const rejected = assert.rejects(start, /BUSY|PENDING/); hold.resolve(); await login; await rejected;
  assert.equal((await service.getState()).run, null);
}));

test('terminal progress is detached and exposes no account, keyword, path or post data', async () => temporary(async directory => {
  const fixture = hostWithProfiles(), entered = deferred<void>(), hold = deferred<void>();
  const service = createProductionService({ directory, version: 'test', host: fixture.host, collect: async input => {
    input.onProgress({ total: 42 }); entered.resolve(); await hold.promise;
    return { stop_reason: 'USER_STOP', summary: { unique: 0 } };
  } });
  assert.equal(service.progress(), null);
  service.saveConfig({ keywords: ['private keyword'], minimumPosts: 1000 });
  await service.start({ profiles: [selection[0]] }); await entered.promise;
  try {
    const progress = service.progress()!;
    assert.deepEqual(Object.keys(progress).sort(), ['id', 'minimumPosts', 'platforms', 'state']);
    assert.deepEqual(Object.keys(progress.platforms[0]!).sort(), ['count', 'platform', 'reason', 'state']);
    assert.equal(progress.platforms[0]!.count, 42); progress.platforms[0]!.count = 999;
    assert.equal(service.progress()!.platforms[0]!.count, 42);
  } finally { hold.resolve(); await service.settled(); }
}));
