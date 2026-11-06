import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real runner + real durable legacy stores, with synthetic browser/transport only.
// No Electron bootstrap, user profile, network, model, or private fixture is used.
const context = {};
globalThis.__csdOpportunityHookTest = context;
const unavailable = name => `export const ${name}=()=>{throw Error('CLI_BOOTSTRAP_MUST_NOT_RUN')};`;
const parser = name => `export const ${name}=(objects,options)=>globalThis.__csdOpportunityHookTest.parse(objects,options);`;
const replacements = new Map([
  ['electron', "export const app=new Proxy({}, {get(){throw Error('CLI_BOOTSTRAP_MUST_NOT_RUN')}});"],
  ['node:timers/promises', 'export const setTimeout=()=>globalThis.__csdOpportunityHookTest.sleep();'],
  ['runtime-paths.js', unavailable('runtimePaths')],
  ['profile-repository.js', unavailable('createBrowserProfiles')],
  ['electron-secret-store.js', unavailable('createElectronSecretStore')],
  ['browser-host.js', unavailable('createBrowserHost')],
  ['electron-observer-target.js', 'export const createOwnedObserverResolver=()=>()=>null;'],
  ['response-observer.js', 'export const createResponseObserverManager=()=>globalThis.__csdOpportunityHookTest.createManager();'],
  ['facebook-search-embedded-parser.js', parser('parseFacebookEmbeddedSearch')],
  ['threads-search-parser.js', parser('parseThreadsSearch')],
]);
const hook = registerHooks({ resolve(specifier, parent, next) {
  const key = replacements.has(specifier) ? specifier : specifier.split('/').at(-1);
  const source = replacements.get(key);
  return source ? { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) } : next(specifier, parent);
} });
const compiled = new URL('../.test-build/src/', import.meta.url);
const runtimeRoot = existsSync(new URL('infrastructure/browser/threads-collector-store.js', compiled))
  ? compiled.href : new URL('../dist/', import.meta.url).href;
const moduleDirectory = mkdtempSync(join(tmpdir(), 'csd-opportunity-hook-modules-'));
writeFileSync(join(moduleDirectory, 'discovery-frontier.mjs'), readFileSync(new URL('../scripts/discovery-frontier.mjs', import.meta.url)));
const hostDouble = join(moduleDirectory, 'browser-host.js');
writeFileSync(hostDouble, replacements.get('browser-host.js'));
for (const platform of ['facebook', 'threads']) {
  const source = readFileSync(new URL('../scripts/' + platform + '-collector.mjs', import.meta.url), 'utf8');
  writeFileSync(join(moduleDirectory, platform + '-collector.mjs'), source.replaceAll('../dist/', runtimeRoot)
    .replaceAll(runtimeRoot + 'infrastructure/browser/browser-host.js', pathToFileURL(hostDouble).href));
}

const { runFacebookCollector } = await import(pathToFileURL(join(moduleDirectory, 'facebook-collector.mjs')).href);
const { runThreadsCollector } = await import(pathToFileURL(join(moduleDirectory, 'threads-collector.mjs')).href);
hook.deregister();
after(() => {
  assert.ok(resolve(moduleDirectory).startsWith(resolve(tmpdir(), 'csd-opportunity-hook-modules-')));
  rmSync(moduleDirectory, { recursive: true, force: true });
  delete globalThis.__csdOpportunityHookTest;
});

function setup(platform, queries = ['cafe work', 'cafe date']) {
  const output = mkdtempSync(join(tmpdir(), 'csd-opportunity-hooks-'));
  const debug = new EventEmitter(), events = [], parsedOptions = [];
  let attached = false, destroyed = false, url = '', currentObserver, pendingResponse = null, stalled = false, admission = true;
  let closed = 0, attachCount = 0, dropped = 0;
  debug.isAttached = () => attached;
  debug.sendCommand = async () => ({});
  const records = id => [{ platform, post_id: String(id), shortcode: 'Code' + id, text: id === 1 ? '' : 'Synthetic discussion',
    post_url: 'https://www.threads.com/@synthetic/post/Code' + id,
    observed_post_url: 'https://www.facebook.com/groups/99/posts/' + id + '/',
    source_type: 'GROUP', visibility: 'PUBLIC', query: new URL(url).searchParams.get('q'),
    entity_type: id === 2 ? 'COMMENT' : 'POST', is_reply: id === 2, root_post_id: id === 2 ? null : String(id),
    parent_id: null, needs_context: true, media_refs: [{ type: 'IMAGE', url: 'https://example.test/image.jpg' }] }];
  const wc = { debugger: debug, isDestroyed: () => destroyed, setBackgroundThrottling() {}, getURL: () => url,
    async loadURL(value) { assert.equal(attached, true); url = value; events.push('load:' + new URL(value).searchParams.get('q')); },
    async executeJavaScript(script) {
      if (script.includes('script[type=') && !script.includes('mainText:')) return [JSON.stringify({ records: records(new URL(url).searchParams.get('q') === queries[0] ? 1 : 2) })];
      if (script.includes('.scrollTo(')) return { before: 0, after: 1000, height: 1400, client: 400 };
      return { url, text: 'Synthetic discussion', mainText: 'Synthetic discussion', login: false, barrier: false,
        alerts: '', alert: '', links: [], root: {}, scrollers: [] };
    },
  };
  const manager = { stopAll() {
    if (currentObserver?.state === 'ATTACHED') {
      currentObserver.state = 'STOPPED'; attached = false;
      if (pendingResponse) { pendingResponse = null; dropped++; }
      currentObserver.waiter?.({ kind: 'END' }); currentObserver.waiter = null;
    }
  }, async attach() {
    assert.equal(attached, false, 'search must reacquire after conversation detaches'); attached = true; attachCount++;
    const observer = { state: 'ATTACHED', waiter: null,
      snapshot() { return { state: this.state, pendingRequests: pendingResponse ? 1 : 0, activeReads: 0, queuedResults: 0, bufferedBytes: 0 }; },
      pauseRequests() { admission = false; }, resumeRequests() { admission = true; },
      async read() { if (this.state === 'STOPPED') return { kind: 'END' }; return new Promise(resolve => { this.waiter = resolve; }); },
    };
    admission = true; currentObserver = observer; return observer;
  } };
  const scheduleResponse = () => {
    if (!admission) return false;
    pendingResponse = records(99);
    debug.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'late-search', request: {
      url: platform === 'facebook' ? 'https://www.facebook.com/api/graphql/' : 'https://www.threads.com/graphql',
      postData: 'fb_api_req_friendly_name=SearchCometResultsPaginatedResultsQuery',
    } });
    return true;
  };
  Object.assign(context, {
    createManager: () => manager,
    parse(objects, options) { parsedOptions.push(options); return { connections: 1, has_next_page: false, skipped: [], records: objects.flatMap(o => o.records || []) }; },
    async sleep() {
      if (pendingResponse && !stalled && currentObserver?.state === 'ATTACHED') {
        const response = pendingResponse; pendingResponse = null;
        const waiter = currentObserver.waiter; currentObserver.waiter = null;
        assert.ok(waiter, 'one reader should already be waiting');
        waiter({ kind: 'EVENT', event: { kind: 'BODY', transportRequestId: 'late-search', status: 200,
          body: Buffer.from(JSON.stringify({ records: response })) } });
      }
      await new Promise(setImmediate);
    },
  });
  const host = { list: async () => [{ id: 'profile', platform, persistenceError: null }], open: async () => { destroyed = false; },
    close: async () => { closed++; destroyed = true; events.push('close'); },
    shutdown: async () => { throw Error('SHARED_HOST_SHUTDOWN'); },
    observerTarget: () => ({ contents: wc, profileId: 'profile', webContentsId: 1, viewGeneration: 1 }) };
  const config = { runId: 'hooks-test', output, queries, modes: ['top'], maxScrollsPerQuery: 1,
    maxMinutes: 1, targetNewRecords: 10, targetTotal: 10, settleMs: 2000, includeContextCandidates: true };
  const run = platform === 'facebook' ? runFacebookCollector : runThreadsCollector;
  return { output, wc, debug, events, parsedOptions, config,
    get attached() { return attached; }, get closed() { return closed; }, get attachCount() { return attachCount; }, get dropped() { return dropped; },
    get admitting() { return admission; },
    legacy: () => existsSync(join(output, 'posts.jsonl')) ? readFileSync(join(output, 'posts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [],
    scheduleLate: scheduleResponse,
    scheduleStalled() { stalled = true; scheduleResponse(); },
    releasePending() { stalled = false; },
    navigateConversation() { url = platform === 'facebook' ? 'https://www.facebook.com/groups/99/posts/1/' : 'https://www.threads.com/@synthetic/post/Code1'; },
    run: options => run({ config, host, profileId: 'profile', ...options }),
    clean() { assert.ok(resolve(output).startsWith(resolve(tmpdir(), 'csd-opportunity-hooks-'))); rmSync(output, { recursive: true, force: true }); },
  };
}

test('Facebook supports a 50000 raw envelope and a 5000 unfiltered target with finite limits', async () => {
  for (const target of [5000, 10000, 50000]) {
    const s = setup('facebook');
    try {
      s.config.targetNewRecords = target;
      const receipt = await s.run({});
      assert.equal(receipt.stop_reason, 'SOURCE_EXHAUSTED');
      assert.equal(s.closed, 1);
    } finally { s.clean(); }
  }
  for (const [target, intent] of [[5001, false], [5001, 'true'], [50001, true]]) {
    const s = setup('facebook');
    try {
      s.config.targetNewRecords = target; s.config.includeContextCandidates = intent;
      await assert.rejects(s.run({}), /CONFIG_INVALID/);
      assert.equal(s.attachCount, 0);
    } finally { s.clean(); }
  }
});

for (const platform of ['facebook', 'threads']) {
  test(`${platform}: durable raw callback precedes legacy save, detached conversation handoff resumes next search`, async () => {
    const s = setup(platform), observed = [], yields = [];
    try {
      const receipt = await s.run({
        onRecords: async (rows, provenance) => {
          assert.ok(rows.every(r => !s.legacy().some(old => old.post_id === r.post_id)));
          await new Promise(setImmediate); observed.push(...rows);
          assert.equal(provenance.platform, platform); assert.ok(provenance.observed_at);
        },
        beforeNextPage: async () => { s.events.push('backpressure'); },
        onQueryEnd: async ({ window, profileId, platform: source, query }) => {
          assert.equal(window, s.wc); assert.equal(profileId, 'profile'); assert.equal(source, platform);
          assert.equal(query, s.config.queries[yields.length], 'handoff must identify the query that yielded this profile');
          assert.equal(s.attached, false); assert.equal(s.debug.listenerCount('message'), 0);
          assert.equal(s.closed, 0); yields.push(s.legacy().length); s.navigateConversation();
        },
      });
      assert.equal(receipt.stop_reason, 'SOURCE_EXHAUSTED'); assert.deepEqual(yields, [1, 2]);
      assert.equal(s.attachCount, 2); assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
      assert.deepEqual(s.events, ['backpressure', 'load:cafe work', 'backpressure', 'backpressure', 'load:cafe date', 'backpressure', 'close']);
      assert.ok(s.parsedOptions.every(o => o.includeContextCandidates === true));
      assert.equal(observed[0].text, ''); assert.equal(observed[0].media_refs.length, 1);
      assert.equal(observed[1].entity_type, 'COMMENT'); assert.equal(observed[1].root_post_id, null);
    } finally { s.clean(); }
  });

  test(`${platform}: Stop raised during conversation prevents the next query and releases the profile`, async () => {
    const s = setup(platform); let stop = false;
    try {
      const receipt = await s.run({ shouldStop: () => stop, onQueryEnd: async () => { stop = true; s.navigateConversation(); } });
      assert.equal(receipt.stop_reason, 'USER_STOP'); assert.equal(s.attachCount, 1); assert.equal(s.closed, 1);
      assert.equal(s.debug.listenerCount('message'), 0);
      assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 1);
    } finally { s.clean(); }
  });

  test(`${platform}: discovery limits preserve their reason and durable rows instead of becoming user Stop`, async () => {
    for (const reason of ['INTENT_TARGET_REACHED', 'RAW_BUDGET_REACHED', 'MODEL_PAUSED', 'STORAGE_RUN_BYTES_REACHED', 'STORAGE_DISK_RESERVE_REACHED']) {
      const s = setup(platform); let limit = null, handoffs = 0;
      try {
        const receipt = await s.run({ shouldStop: () => false, collectionLimitReason: () => limit,
          onRecords: async () => { limit = reason; }, onQueryEnd: async () => { handoffs++; } });
        assert.equal(receipt.stop_reason, reason); assert.notEqual(receipt.stop_reason, 'USER_STOP');
        assert.deepEqual(s.legacy().map(r => r.post_id), ['1']);
        assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 0);
        assert.equal(handoffs, 0, 'a mid-query limit leaves final enrichment to the service after profile release');
        assert.equal(s.attachCount, 1); assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
      } finally { s.clean(); }
    }
  });

  test(`${platform}: storage admission checks the first navigation and zero-scroll query transitions`, async () => {
    for (const blockedAt of [1, 2]) {
      const s = setup(platform); let checks = 0, limit = null;
      s.config.maxScrollsPerQuery = 0;
      try {
        const receipt = await s.run({ collectionLimitReason: () => limit,
          beforeNextPage: async () => { if (++checks === blockedAt) limit = 'STORAGE_DISK_RESERVE_REACHED'; } });
        assert.equal(receipt.stop_reason, 'STORAGE_DISK_RESERVE_REACHED');
        assert.equal(s.events.filter(event => event.startsWith('load:')).length, blockedAt - 1);
        assert.equal(s.legacy().length, blockedAt - 1, 'already observed rows survive storage admission stop');
        assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], blockedAt - 1);
        assert.equal(s.closed, 1);
      } finally { s.clean(); }
    }
  });

  test(`${platform}: discovery limit reached during a detached yield does not cancel bounded conversation work`, async () => {
    for (const reason of ['INTENT_TARGET_REACHED', 'RAW_BUDGET_REACHED']) {
      const s = setup(platform); let limit = null, captured = 0;
      try {
        const receipt = await s.run({ shouldStop: () => false, collectionLimitReason: () => limit,
          onQueryEnd: async ({ shouldStop }) => {
            assert.equal(s.attached, false); assert.equal(s.debug.listenerCount('message'), 0);
            limit = reason;
            for (let i = 0; i < 3 && !shouldStop(); i++) {
              s.navigateConversation(); await new Promise(setImmediate); captured++;
            }
            assert.equal(shouldStop(), false, 'the hook only observes user Stop, STOP file, or run deadline');
          } });
        assert.equal(captured, 3); assert.equal(receipt.stop_reason, reason);
        assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 1);
        assert.equal(s.attachCount, 1, 'a new search must not start after the discovery limit');
        assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
      } finally { s.clean(); }
    }
  });

  test(`${platform}: a STOP file is visible inside conversation yield and takes precedence over a discovery limit`, async () => {
    const s = setup(platform); let limit = null;
    try {
      const receipt = await s.run({ collectionLimitReason: () => limit, onQueryEnd: async ({ shouldStop }) => {
        assert.equal(shouldStop(), false); limit = 'RAW_BUDGET_REACHED';
        writeFileSync(join(s.output, 'runs', s.config.runId, 'STOP'), '');
        assert.equal(shouldStop(), true); s.navigateConversation();
      } });
      assert.equal(receipt.stop_reason, 'USER_STOP'); assert.equal(s.attachCount, 1);
      assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
    } finally { s.clean(); }
  });

  test(`${platform}: failed durable raw save cannot advance the checkpoint or report successful completion`, async () => {
    const s = setup(platform); let handoffs = 0;
    try {
      const receipt = await s.run({ onRecords: async () => { throw Error('RAW_DISK_FULL'); }, onQueryEnd: async () => { handoffs++; } });
      assert.equal(receipt.stop_reason, 'RAW_DISK_FULL'); assert.equal(s.legacy().length, 0); assert.equal(handoffs, 0);
      assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 0);
      assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
    } finally { s.clean(); }
  });

  test(`${platform}: a received pending search response is drained before conversation navigation`, async () => {
    const s = setup(platform, ['cafe work']); let scheduled = false; const observed = [];
    try {
      const receipt = await s.run({ onRecords: async rows => {
        observed.push(...rows);
        if (!scheduled) { scheduled = true; s.scheduleLate(); }
      }, onQueryEnd: async () => {
        assert.equal(s.dropped, 0, 'handoff must not invalidate a pending captured response');
        assert.deepEqual(observed.map(r => r.post_id).sort(), ['1', '99']);
      } });
      assert.equal(receipt.stop_reason, 'SOURCE_EXHAUSTED');
      assert.deepEqual(s.legacy().map(r => r.post_id).sort(), ['1', '99']);
      assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 1);
    } finally { s.clean(); }
  });

  test(`${platform}: page barrier tolerates ongoing network while handoff drains a finite admitted request set`, async () => {
    const s = setup(platform, ['cafe work']); let handoffs = 0, refusedFuture = 0;
    const parse = context.parse, sleep = context.sleep;
    context.parse = (objects, options) => ({ ...parse(objects, options), has_next_page: true });
    context.sleep = async () => { if (!s.admitting) s.releasePending(); await sleep(); };
    try {
      const receipt = await s.run({ onRecords: async rows => {
        if (rows.some(row => row.post_id === '1')) s.scheduleStalled();
        if (rows.some(row => row.post_id === '99') && !s.scheduleLate()) refusedFuture++;
      }, onQueryEnd: async () => {
        handoffs++; assert.equal(s.admitting, false); assert.equal(s.dropped, 0);
        assert.deepEqual(s.legacy().map(row => row.post_id).sort(), ['1', '99']);
      } });
      assert.equal(receipt.stop_reason, 'QUERY_BUDGET_COMPLETE'); assert.equal(handoffs, 1);
      assert.equal(refusedFuture, 1, 'a new response cycle cannot extend an already-frozen capture boundary');
      assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
    } finally { s.clean(); }
  });

  test(`${platform}: quiescence timeout keeps the query checkpoint incomplete and exports durable rows`, async () => {
    const s = setup(platform, ['cafe work']); let handoffs = 0;
    try {
      const receipt = await s.run({ onRecords: async () => { s.scheduleStalled(); }, onQueryEnd: async () => { handoffs++; } });
      assert.equal(receipt.stop_reason, 'CAPTURE_DRAIN_TIMEOUT'); assert.equal(handoffs, 0);
      assert.equal(receipt.checkpoint[platform === 'facebook' ? 'query_index' : 'job_index'], 0);
      assert.deepEqual(s.legacy().map(r => r.post_id), ['1']);
      assert.equal(s.closed, 1); assert.equal(s.debug.listenerCount('message'), 0);
    } finally { s.clean(); }
  });
}

test('Threads duplicate response batches do not reset the unique-record exhaustion counter', async () => {
  const s = setup('threads', ['cafe work']); let scrolls = 0;
  s.config.maxScrollsPerQuery = 20;
  const parse = context.parse, execute = s.wc.executeJavaScript;
  context.parse = (objects, options) => ({ ...parse(objects, options), has_next_page: true });
  s.wc.executeJavaScript = async script => {
    if (script.includes('.scrollTo(')) { scrolls++; s.scheduleLate(); }
    return execute(script);
  };
  try {
    const receipt = await s.run();
    assert.equal(receipt.stop_reason, 'QUERY_BUDGET_COMPLETE');
    assert.equal(scrolls, 5, 'one productive page followed by four duplicate-only pages must yield the query');
    assert.deepEqual(s.legacy().map(r => r.post_id).sort(), ['1', '99']);
    const events = readFileSync(join(s.output, 'runs', s.config.runId, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(event => event.event === 'NO_PROGRESS').length, 1);
    assert.equal(events.filter(event => event.event === 'YIELD').at(-1).no_progress, 4);
    assert.equal(receipt.checkpoint.discovery_frontier.jobs[0].state, 'STALLED');
    assert.equal(receipt.diagnostics[0].last_diagnosis, 'DUPLICATE_ROOTS');
    assert.equal(receipt.diagnostics[0].search_requests, 5);assert.equal(receipt.diagnostics[0].response_bodies, 5);
    await s.run({resume:true,recoverStalled:false});assert.equal(scrolls,5,'ordinary continuation does not bypass cooldown');
    const recovered=await s.run({resume:true,recoverStalled:true});
    assert.equal(scrolls,14,'recovery replays five pages then tries four fresh pages rather than immediately re-stalling');
    assert.equal(recovered.checkpoint.discovery_frontier.jobs[0].recovery_attempts,1);
  } finally { s.clean(); }
});

function paginatedSetup(platform, pageBudget = 6, nativeEnd = Infinity) {
  const s = setup(platform, ['synthetic topic']); let depth = 0, loads = 0;
  s.config.maxScrollsPerQuery = pageBudget; s.config.targetNewRecords = 1000; s.config.targetTotal = 1000;
  const load = s.wc.loadURL, execute = s.wc.executeJavaScript, parse = context.parse;
  const record = () => {
    const id = String(100 + depth);
    return { platform, post_id: id, shortcode: 'Code' + id, text: 'Synthetic discussion', query: s.config.queries[0],
      post_url: 'https://www.threads.com/@synthetic/post/Code' + id, observed_post_url: 'https://www.facebook.com/groups/99/posts/' + id + '/',
      source_type: 'GROUP', visibility: 'PUBLIC', entity_type: 'POST', root_post_id: id, parent_id: null, media_refs: [] };
  };
  s.wc.loadURL = async value => { depth = 0; loads++; await load(value); };
  s.wc.executeJavaScript = async script => {
    if (script.includes('.scrollTo(')) { depth++; s.scheduleLate(); }
    if (script.includes('script[type=') && !script.includes('mainText:')) {
      return [JSON.stringify({ records: [record()] })];
    }
    return execute(script);
  };
  context.parse = (objects, options) => {
    const parsed = parse(objects, options);
    return { ...parsed, records: parsed.records.map(row => row.post_id === '99' ? record() : row), has_next_page: depth >= nativeEnd ? false : true };
  };
  return { ...s, depth: () => depth, loads: () => loads };
}

for (const platform of ['facebook', 'threads']) {
  test(`${platform}: productive warm slices reach deeper pages without another navigation`, async () => {
    const s = paginatedSetup(platform, 3); s.config.warmPageLimit = 9;
    try {
      const receipt = await s.run({ continueQuerySlice: () => true });
      assert.equal(s.loads(), 1); assert.equal(s.depth(), 9); assert.equal(s.legacy().length, 10);
      assert.equal(receipt.checkpoint.discovery_frontier.jobs[0].depth, 9);
      assert.equal(receipt.stop_reason, 'QUERY_BUDGET_COMPLETE');
      assert.equal(receipt.diagnostics[0].new_roots,10);assert.equal(receipt.diagnostics[0].scrolls,9);
      assert.equal(receipt.diagnostics[0].last_diagnosis,'NEW_ROOTS');
    } finally { s.clean(); }
  });

  test(`${platform}: explicit Resume continues budget-limited query beyond duplicate prefix under the same deadline`, async () => {
    const s = paginatedSetup(platform);
    try {
      const first = await s.run({});
      assert.equal(first.stop_reason, 'QUERY_BUDGET_COMPLETE'); assert.equal(first.checkpoint.discovery_frontier.jobs[0].state, 'BUDGET_LIMITED');
      assert.equal(first.checkpoint.discovery_frontier.jobs[0].depth, 6); assert.equal(s.legacy().length, 7);
      const manifestPath = join(s.output, 'runs', s.config.runId, 'manifest.json'), manifest = readFileSync(manifestPath);
      const second = await s.run({ resume: true });
      assert.equal(second.stop_reason, 'QUERY_BUDGET_COMPLETE'); assert.equal(second.checkpoint.discovery_frontier.jobs[0].depth, 12);
      assert.equal(s.legacy().length, 13, 'known duplicate pages must not prevent reaching the next unseen page');
      assert.equal(s.loads(), 2); assert.deepEqual(readFileSync(manifestPath), manifest, 'Resume must not reset its original deadline/config');
      const events = readFileSync(join(s.output, 'runs', s.config.runId, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(events.filter(event => event.event === 'YIELD' && event.replaying).length, 6);
    } finally { s.clean(); }
  });

  test(`${platform}: interruption after durable raw but before depth checkpoint safely replays without dropping or double-counting`, async () => {
    const s = paginatedSetup(platform, 12); let stop = false;
    try {
      const first = await s.run({ shouldStop: () => stop, onRecords: async rows => { if (rows.some(row => row.post_id === '109')) stop = true; } });
      assert.equal(first.stop_reason, 'USER_STOP'); assert.equal(first.checkpoint.discovery_frontier.jobs[0].state, 'RUNNING');
      assert.equal(first.checkpoint.discovery_frontier.jobs[0].depth, 8); assert.equal(s.legacy().length, 10);
      stop = false; const second = await s.run({ resume: true });
      assert.equal(second.checkpoint.discovery_frontier.jobs[0].depth, 20); assert.equal(s.legacy().length, 21);
      assert.equal(s.legacy().filter(row => row.post_id === '109').length, 1);
    } finally { s.clean(); }
  });

  test(`${platform}: native end is exhausted and Resume never invents a continuation`, async () => {
    const s = paginatedSetup(platform, 6, 2);
    try {
      const first = await s.run({}); assert.equal(first.stop_reason, 'SOURCE_EXHAUSTED');
      assert.equal(first.checkpoint.discovery_frontier.jobs[0].state, 'EXHAUSTED'); assert.equal(first.checkpoint.discovery_frontier.jobs[0].reason, 'NATIVE_END_OBSERVED');
      await s.run({ resume: true }); assert.equal(s.loads(), 1); assert.equal(s.legacy().length, 3);
    } finally { s.clean(); }
  });

  test(`${platform}: continuation still honors the campaign raw stop and original run deadline`, async () => {
    const s = paginatedSetup(platform); let limit = null;
    try {
      await s.run({});
      const second = await s.run({ resume: true, collectionLimitReason: () => limit,
        onRecords: async rows => { if (rows.some(row => row.post_id === '108')) limit = 'RAW_BUDGET_REACHED'; } });
      assert.equal(second.stop_reason, 'RAW_BUDGET_REACHED'); assert.equal(s.legacy().length, 9);
      assert.equal(second.checkpoint.discovery_frontier.jobs[0].state, 'RUNNING');
      const checkpointPath = join(s.output, 'runs', s.config.runId, 'checkpoint.json'), before = readFileSync(checkpointPath);
      const manifestPath = join(s.output, 'runs', s.config.runId, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.started_at = new Date(Date.now() - 120000).toISOString(); writeFileSync(manifestPath, JSON.stringify(manifest));
      await assert.rejects(s.run({ resume: true }), /RUN_DEADLINE_EXPIRED_USE_NEW_RUN_ID/);
      assert.equal(s.loads(), 2); assert.deepEqual(readFileSync(checkpointPath), before);
    } finally { s.clean(); }
  });
}
