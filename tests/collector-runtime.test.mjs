import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Exercise the real collection lifecycle with a local browser/observer double.
// No account, network, renderer, or product demo mode is involved.
const context = { stopped: 0, appCalls: 0 };
globalThis.__csdCollectorRuntimeTest = context;
const unavailable = name => `export const ${name}=()=>{throw Error('CLI_BOOTSTRAP_MUST_NOT_RUN')};`;
const replacements = new Map([
  ['electron', "export const app=new Proxy({}, {get(){globalThis.__csdCollectorRuntimeTest.appCalls++;throw Error('EMBEDDED_APP_ACCESS')}});"],
  ['runtime-paths.js', unavailable('runtimePaths')],
  ['profile-repository.js', unavailable('createBrowserProfiles')],
  ['electron-secret-store.js', unavailable('createElectronSecretStore')],
  ['browser-host.js', unavailable('createBrowserHost')],
  ['electron-observer-target.js', 'export const createOwnedObserverResolver=()=>()=>null;'],
  ['response-observer.js', `export const createResponseObserverManager=()=>({
    stopAll(){globalThis.__csdCollectorRuntimeTest.stopped++;},
    async attach(){return {snapshot:()=>({state:'ATTACHED'}),read:async()=>({kind:'END'})};}
  });`],
]);
const hook = registerHooks({
  resolve(specifier, parent, next) {
    const key = specifier === 'electron' ? specifier : specifier.split('/').at(-1);
    const source = replacements.get(key);
    return source ? { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) } : next(specifier, parent);
  },
});
// npm test compiles dependencies into .test-build; it must not need a prior
// application build. Use the same path substitution that packages the runners.
const compiled = new URL('../.test-build/src/', import.meta.url);
const runtimeRoot = existsSync(new URL('infrastructure/browser/threads-collector-store.js', compiled))
  ? compiled.href : new URL('../dist/', import.meta.url).href;
const moduleDirectory = mkdtempSync(join(tmpdir(), 'csd-collector-modules-'));
writeFileSync(join(moduleDirectory, 'discovery-frontier.mjs'), readFileSync(new URL('../scripts/discovery-frontier.mjs', import.meta.url)));
const hostDouble = join(moduleDirectory, 'browser-host.js');
writeFileSync(hostDouble, replacements.get('browser-host.js'));
for (const platform of ['facebook', 'threads']) {
  const source = readFileSync(new URL('../scripts/' + platform + '-collector.mjs', import.meta.url), 'utf8');
  writeFileSync(join(moduleDirectory, platform + '-collector.mjs'), source.replaceAll('../dist/', runtimeRoot)
    .replaceAll(runtimeRoot + 'infrastructure/browser/browser-host.js', pathToFileURL(hostDouble).href));
}
after(() => {
  assert.ok(resolve(moduleDirectory).startsWith(resolve(tmpdir(), 'csd-collector-modules-')));
  rmSync(moduleDirectory, { recursive: true, force: true });
  delete globalThis.__csdCollectorRuntimeTest;
});
const { runFacebookCollector } = await import(pathToFileURL(join(moduleDirectory, 'facebook-collector.mjs')).href);
const { runThreadsCollector } = await import(pathToFileURL(join(moduleDirectory, 'threads-collector.mjs')).href);
hook.deregister();

function setup(platform, overrides = {}) {
  const output = mkdtempSync(join(tmpdir(), 'csd-collector-runtime-'));
  let destroyed = false;
  const debuggerEvents = new EventEmitter();
  const wc = {
    // Electron's native debugger getter is unavailable after host.close destroys
    // webContents. Accessing it in the outer finally must not replace the receipt.
    get debugger() { if (destroyed) throw Error('Object has been destroyed'); return debuggerEvents; },
    isDestroyed: () => destroyed, setBackgroundThrottling() {},
    async loadURL() { throw Error('NAVIGATION_FAILED'); },
    async executeJavaScript() { throw Error('UNEXPECTED_EXECUTION'); },
  };
  const calls = { open: 0, close: 0, shutdown: 0 };
  const host = {
    list: async () => [{ id: 'profile', platform, persistenceError: null }],
    open: async () => { calls.open++; },
    close: async () => { calls.close++; destroyed = true; },
    shutdown: async () => { calls.shutdown++; throw Error('SHARED_HOST_SHUTDOWN'); },
    observerTarget: () => ({ contents: wc, profileId: 'profile', webContentsId: 1, viewGeneration: 1 }),
    ...overrides,
  };
  const config = { runId: 'production-test', output, queries: ['user supplied keyword'], maxScrollsPerQuery: 1,
    maxMinutes: 1, targetNewRecords: 10, targetTotal: 10, settleMs: 2000 };
  const progress = [];
  const run = platform === 'facebook' ? runFacebookCollector : runThreadsCollector;
  return { output, wc, debuggerEvents, calls, host, config, progress,
    run: extra => run({ config, host, profileId: 'profile', onProgress: value => progress.push(value), ...extra }),
    clean() {
      assert.ok(resolve(output).startsWith(resolve(tmpdir(), 'csd-collector-runtime-')));
      rmSync(output, { recursive: true, force: true });
    },
  };
}

test('importing production runners does not bootstrap or exit Electron', () => {
  assert.equal(context.appCalls, 0);
});

for (const platform of ['facebook', 'threads']) {
  test(`${platform}: failed navigation exports partial JSON, closes only its profile, and removes listeners`, async () => {
    const s = setup(platform);
    try {
      const result = await s.run();
      assert.equal(result.stop_reason, 'NAVIGATION_FAILED');
      assert.equal(result.summary.unique, 0);
      assert.deepEqual(JSON.parse(readFileSync(join(s.output, 'posts.json'), 'utf8')), []);
      assert.equal(s.calls.open, 1);
      assert.equal(s.calls.close, 1);
      assert.equal(s.calls.shutdown, 0);
      assert.equal(s.debuggerEvents.listenerCount('message'), 0);
      assert.equal(s.progress.at(-1).event, 'STOP');
      assert.equal(s.progress.at(-1).total, 0);
      assert.ok(s.progress.every(row => Object.keys(row).every(key =>
        ['event', 'total', 'new_this_run', 'query', 'query_index', 'job_index', 'stop_reason'].includes(key))));
      assert.equal(context.appCalls, 0);
    } finally { s.clean(); }
  });

  test(`${platform}: Stop before execution does not open a session`, async () => {
    const s = setup(platform);
    try {
      await assert.rejects(s.run({ shouldStop: () => true }), /USER_STOP/);
      assert.equal(s.calls.open, 0);
      assert.equal(s.calls.shutdown, 0);
    } finally { s.clean(); }
  });

  test(`${platform}: an open failure still releases the owned profile`, async () => {
    const s = setup(platform, { open: async () => { throw Error('OPEN_FAILED'); } });
    try {
      await assert.rejects(s.run(), /OPEN_FAILED/);
      assert.equal(s.calls.close, 1);
      assert.equal(s.calls.shutdown, 0);
    } finally { s.clean(); }
  });

  test(`${platform}: missing account prevents collection`, async () => {
    const s = setup(platform, { list: async () => [] });
    try {
      await assert.rejects(s.run(), /PROFILE_SELECTION_REQUIRED/);
      assert.equal(s.calls.open, 0);
    } finally { s.clean(); }
  });

  test(`${platform}: a failed session flush remains visible even when final cleanup succeeds`, async () => {
    let closes = 0;
    const s = setup(platform, { close: async () => { if (++closes === 1) throw Error('SESSION_SAVE_FAILED'); } });
    try {
      const receipt = await s.run();
      assert.notEqual(receipt.session_flush, 'OK');
      assert.equal(closes, 2);
      assert.equal(s.debuggerEvents.listenerCount('message'), 0);
      assert.equal(s.calls.shutdown, 0);
    } finally { s.clean(); }
  });

  test(`${platform}: persistent session flush failure rejects and still removes the observer listener`, async () => {
    const s = setup(platform, { close: async () => { throw Error('SESSION_SAVE_FAILED'); } });
    try {
      await assert.rejects(s.run(), /SESSION_SAVE_FAILED/);
      assert.equal(s.debuggerEvents.listenerCount('message'), 0);
      assert.equal(s.calls.shutdown, 0);
    } finally { s.clean(); }
  });
}

test('both real runners open separate profiles on a shared host before either closes', async () => {
  const facebook = setup('facebook'), threads = setup('threads');
  let releaseFacebook, releaseThreads;
  const holds = {
    facebook: new Promise(resolve => { releaseFacebook = resolve; }),
    threads: new Promise(resolve => { releaseThreads = resolve; }),
  };
  const sources = { facebook, threads };
  for (const platform of ['facebook', 'threads']) {
    sources[platform].wc.loadURL = async () => { await holds[platform]; throw Error('NAVIGATION_FAILED'); };
  }
  const sharedHost = {
    list: async () => ['facebook', 'threads'].map(platform => ({ id: platform, platform, persistenceError: null })),
    open: id => sources[id].host.open(),
    close: id => sources[id].host.close(),
    shutdown: async () => { throw Error('SHARED_HOST_SHUTDOWN'); },
    observerTarget: id => ({ contents: sources[id].wc, profileId: id, webContentsId: id === 'facebook' ? 1 : 2, viewGeneration: 1 }),
  };
  const work = [
    runFacebookCollector({ config: facebook.config, host: sharedHost, profileId: 'facebook' }),
    runThreadsCollector({ config: threads.config, host: sharedHost, profileId: 'threads' }),
  ];
  try {
    await new Promise(setImmediate);
    assert.equal(facebook.calls.open, 1); assert.equal(threads.calls.open, 1);
    assert.equal(facebook.calls.close, 0); assert.equal(threads.calls.close, 0);
    assert.equal(facebook.debuggerEvents.listenerCount('message'), 1);
    assert.equal(threads.debuggerEvents.listenerCount('message'), 1);
    releaseFacebook();
    const receipt = await work[0];
    assert.equal(receipt.session_flush, 'OK');
    assert.equal(facebook.calls.close, 1); assert.equal(threads.calls.close, 0);
    assert.equal(threads.debuggerEvents.listenerCount('message'), 1);
    releaseThreads(); await work[1];
    assert.equal(threads.calls.close, 1);
    assert.equal(threads.debuggerEvents.listenerCount('message'), 0);
    assert.equal(context.appCalls, 0);
  } finally {
    releaseFacebook(); releaseThreads(); await Promise.allSettled(work);
    facebook.clean(); threads.clean();
  }
});

test('Threads CLI requires the user to supply keywords, with no sample defaults', () => {
  const result = spawnSync(process.execPath, ['scripts/run-threads-collector.mjs'], { cwd: resolve('.'), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Provide --query/);
});
