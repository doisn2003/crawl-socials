import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick, setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import type { ObserverEvent, ObserverLimits, ObserverOwner, ResponseObserver } from '../src/application/ports/response-observer.js';
import { createResponseObserverManager } from '../src/infrastructure/browser/response-observer.js';
import { ReplayObserverTarget } from '../src/infrastructure/browser/replay-observer-target.js';
import { runObserverReplay } from '../src/infrastructure/browser/replay-fixture.js';
const owner: ObserverOwner = { profileId: 'csd-11111111-1111-4111-8111-111111111111', webContentsId: 1, viewGeneration: 1 };
const url = 'http://127.0.0.1:1234/capture?token=synthetic-not-exported';
async function setup(work: (ctx: { target: ReplayObserverTarget; handle: ResponseObserver; manager: ReturnType<typeof createResponseObserverManager>;
  setOwner: (next: ObserverOwner) => void }) => Promise<void>, limits: Partial<ObserverLimits> = {}) {
  const target = new ReplayObserverTarget(1); let current = owner;
  const manager = createResponseObserverManager({ resolveOwned: candidate => JSON.stringify(candidate) === JSON.stringify(current) ? target : null,
    urlAllowed: input => input === url, limits: { maxRunMs: 1000, commandTimeoutMs: 50, requestTimeoutMs: 80, ...limits } });
  try { const handle = await manager.attach(owner, 'REPLAY'); await work({ target, handle, manager, setOwner: next => { current = next; } }); }
  finally { manager.stopAll(); await tick(); }
}
function request(target: ReplayObserverTarget, id: string, method = 'GET') {
  target.emitMessage('Network.requestWillBeSent', { requestId: id, type: 'Fetch', request: { url, method,
    headers: { cookie: 'never-captured' }, postData: 'never-captured' } });
}
function response(target: ReplayObserverTarget, id: string, body: unknown = { body: 'fixture', base64Encoded: false }) {
  target.setBody(id, body);
  target.emitMessage('Network.responseReceived', { requestId: id, response: { url, status: 200, mimeType: 'text/plain', headers: { 'set-cookie': 'never-captured' } } });
  target.emitMessage('Network.loadingFinished', { requestId: id, encodedDataLength: 0 });
}
async function event(handle: ResponseObserver, match: (value: ObserverEvent) => boolean): Promise<ObserverEvent> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const read = await handle.read(200);
    if (read.kind === 'EVENT' && match(read.event)) return read.event;
    if (read.kind === 'END' || read.kind === 'TIMEOUT') break;
  }
  assert.fail('Expected observer event');
}
test('transport waits for loadingFinished, preserves empty/Unicode/base64 bodies and does not export secrets/URL', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE');
  request(target, 'one', 'POST'); target.setBody('one', { body: '', base64Encoded: false });
  target.emitMessage('Network.responseReceived', { requestId: 'one', response: { url, status: 204, mimeType: 'text/plain' } });
  assert.equal((await handle.read(5)).kind, 'TIMEOUT');
  target.emitMessage('Network.loadingFinished', { requestId: 'one' });
  const empty = await event(handle, e => e.kind === 'BODY'); assert.equal(empty.kind, 'BODY');
  if (empty.kind === 'BODY') { assert.equal(empty.body.byteLength, 0); assert.equal(empty.method, 'POST'); assert.equal(empty.status, 204); }
  request(target, 'two'); response(target, 'two', { body: Buffer.from('cà phê ☕').toString('base64'), base64Encoded: true });
  const encoded = await event(handle, e => e.kind === 'BODY');
  if (encoded.kind === 'BODY') assert.equal(Buffer.from(encoded.body).toString('utf8'), 'cà phê ☕');
  const serialized = JSON.stringify(encoded); assert.equal(serialized.includes('token'), false); assert.equal(serialized.includes('cookie'), false);
  assert.equal(encoded.captureMode, 'REPLAY');
}));
test('idempotent attach does not duplicate listeners and a foreign debugger is never stolen', () => setup(async ({ target, handle, manager }) => {
  assert.equal(await manager.attach(owner, 'REPLAY'), handle); assert.equal(target.listenerCount(), 5);
  handle.suspend(); assert.equal(target.listenerCount(), 0); assert.equal(target.debuggerAttached(), false);
  target.attachDebugger(); await handle.resume();
  assert.equal((await event(handle, e => e.kind === 'ERROR')).kind, 'ERROR');
  assert.equal(target.debuggerAttached(), true); assert.equal(target.listenerCount(), 0);
}));
test('navigation cancels old pending generation and rejects late response body completion', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE');
  let release!: (value: unknown) => void;
  const late = new Promise(resolve => { release = resolve; });
  request(target, 'old'); response(target, 'old', late); await tick();
  const oldGeneration = handle.snapshot().captureGeneration; target.navigate();
  release({ body: 'stale', base64Encoded: false }); await tick();
  await event(handle, e => e.kind === 'STATE' && e.code === 'NAVIGATION_RESET');
  request(target, 'new'); response(target, 'new', { body: 'new', base64Encoded: false });
  const captured = await event(handle, e => e.kind === 'BODY');
  if (captured.kind === 'BODY') assert.equal(Buffer.from(captured.body).toString(), 'new');
  assert.ok(captured.captureGeneration > oldGeneration);
}));
test('detach/close clean listeners, cancel pending records, and cannot deliver late body data', async () => {
  for (const close of ['externalDetach', 'destroy'] as const) await setup(async ({ target, handle }) => {
    await event(handle, e => e.kind === 'STATE');
    request(target, 'pending'); target[close]();
    const result = await event(handle, e => e.kind === 'ERROR');
    assert.ok(result.kind === 'ERROR' && ['DEBUGGER_DETACHED', 'TARGET_DESTROYED'].includes(result.code));
    response(target, 'pending'); assert.equal((await handle.read(5)).kind, 'END');
    assert.equal(target.listenerCount(), 0); assert.equal(handle.snapshot().pendingRequests, 0);
  });
});
test('suspend/resume uses fresh capture generation, keeps deadline, and blocks concurrent readers', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE');
  request(target, 'pending'); handle.suspend();
  assert.equal(handle.snapshot().pendingRequests, 0); assert.equal(target.listenerCount(), 0);
  await event(handle, e => e.kind === 'STATE' && e.code === 'SUSPENDED');
  const pendingRead = handle.read(100); await assert.rejects(handle.read(), /OBSERVER_READER_BUSY/);
  await handle.resume(); const resumed = await pendingRead; assert.equal(resumed.kind, 'EVENT');
  assert.equal(target.listenerCount(), 5); request(target, 'new'); response(target, 'new');
  await event(handle, e => e.kind === 'BODY');
}));
test('native body failure, invalid base64, request timeout and network failure have distinct fixed errors', async () => {
  for (const scenario of ['body', 'decode', 'request', 'network'] as const) await setup(async ({ target, handle }) => {
    await event(handle, e => e.kind === 'STATE'); request(target, scenario);
    if (scenario === 'body') response(target, scenario, Promise.resolve().then(() => { throw new Error('secret-native-text'); }));
    if (scenario === 'decode') response(target, scenario, { body: '!!!', base64Encoded: true });
    if (scenario === 'network') target.emitMessage('Network.loadingFailed', { requestId: scenario, errorText: 'secret-native-text' });
    const result = await event(handle, e => e.kind === 'ERROR');
    assert.equal(result.kind === 'ERROR' && result.code, { body: 'BODY_UNREADABLE', decode: 'BODY_DECODE_FAILED', request: 'REQUEST_TIMEOUT', network: 'NETWORK_FAILED' }[scenario]);
    assert.equal(JSON.stringify(result).includes('secret-native-text'), false);
  });
});
test('hanging native body command times out, detaches and cannot be multiplied by reattach', () => setup(async ({ target, handle, manager }) => {
  await event(handle, e => e.kind === 'STATE'); request(target, 'hang'); response(target, 'hang', new Promise(() => {}));
  const failed = await event(handle, e => e.kind === 'ERROR'); assert.equal(failed.kind === 'ERROR' && failed.code, 'COMMAND_TIMEOUT');
  assert.equal(target.listenerCount(), 0); assert.equal(target.debuggerAttached(), false);
  assert.equal(handle.snapshot().activeReads, 0);
  const before = target.commands.length, next = await manager.attach(owner, 'REPLAY');
  await event(next, e => e.kind === 'ERROR'); assert.equal(target.commands.length, before);
}));
test('ownership changes cancel a pending result and another profile cannot claim the target', () => setup(async ({ target, handle, manager, setOwner }) => {
  await assert.rejects(manager.attach({ ...owner, webContentsId: 2 }, 'REPLAY'), /OBSERVER_OWNER_MISMATCH/);
  request(target, 'owned'); setOwner({ ...owner, viewGeneration: 2 }); response(target, 'owned');
  const failed = await event(handle, e => e.kind === 'ERROR'); assert.equal(failed.kind === 'ERROR' && failed.code, 'OWNER_CHANGED');
  assert.equal(target.listenerCount(), 0);
}));
test('pending and queue overflow stop explicitly while preserving their configured bounds', async () => {
  await setup(async ({ target, handle }) => {
    request(target, 'a'); request(target, 'b'); request(target, 'c');
    const result = await event(handle, e => e.kind === 'ERROR'); assert.equal(result.kind === 'ERROR' && result.code, 'PENDING_LIMIT');
    assert.ok(handle.snapshot().pendingRequests <= 2);
  }, { maxPendingRequests: 2, maxConcurrentReads: 1 });
  await setup(async ({ target, handle }) => {
    await event(handle, e => e.kind === 'STATE');
    request(target, 'a'); response(target, 'a'); await tick();
    request(target, 'b'); response(target, 'b'); await tick();
    assert.ok(handle.snapshot().queuedResults <= 2);
    const result = await event(handle, e => e.kind === 'ERROR'); assert.equal(result.kind === 'ERROR' && result.code, 'RESULT_QUEUE_LIMIT');
  }, { maxResults: 2 });
});
test('encoded hint and post-decode byte limits reject huge responses without reporting a valid empty body', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE'); request(target, 'large'); response(target, 'large', { body: '☕☕☕', base64Encoded: false });
  const result = await event(handle, e => e.kind === 'ERROR'); assert.equal(result.kind === 'ERROR' && result.code, 'BODY_TOO_LARGE');
  assert.equal(handle.snapshot().capturedResponses, 0);
  request(target, 'hint'); target.emitMessage('Network.loadingFinished', { requestId: 'hint', encodedDataLength: 100 });
  const hint = await event(handle, e => e.kind === 'ERROR'); assert.equal(hint.kind === 'ERROR' && hint.code, 'BODY_TOO_LARGE');
}, { maxBodyBytes: 4, maxBufferedBytes: 8 }));
test('total byte, buffer, count and run deadline limits stay distinct', async () => {
  for (const kind of ['total', 'buffer', 'count', 'deadline'] as const) await setup(async ({ target, handle }) => {
    await event(handle, e => e.kind === 'STATE');
    if (kind !== 'deadline') {
      request(target, 'a'); response(target, 'a'); await tick();
      if (kind !== 'buffer') await event(handle, e => e.kind === 'BODY');
      request(target, 'b'); response(target, 'b');
      await tick();
    }
    const result = await event(handle, e => e.kind === 'ERROR');
    assert.equal(result.kind === 'ERROR' && result.code, { total: 'TOTAL_BYTES_LIMIT', buffer: 'BUFFER_LIMIT', count: 'CAPTURE_LIMIT', deadline: 'RUN_DEADLINE' }[kind]);
  }, { ...(kind === 'total' ? { maxTotalCapturedBytes: 8 } : {}), ...(kind === 'buffer' ? { maxBodyBytes: 8, maxBufferedBytes: 8 } : {}),
    ...(kind === 'count' ? { maxCapturedResponses: 1 } : {}), ...(kind === 'deadline' ? { maxRunMs: 20 } : {}) });
});
test('DevTools policy stops an active capture even when native debugger does not detach automatically', () => setup(async ({ target, handle, manager }) => {
  await event(handle, e => e.kind === 'STATE'); request(target, 'pending'); target.openDevTools();
  const stopped = await event(handle, e => e.kind === 'ERROR'); assert.equal(stopped.kind === 'ERROR' && stopped.code, 'DEVTOOLS_OPENED');
  assert.equal(target.listenerCount(), 0); assert.equal(target.debuggerAttached(), false);
  const refused = await manager.attach(owner, 'REPLAY');
  const busy = await event(refused, e => e.kind === 'ERROR'); assert.equal(busy.kind === 'ERROR' && busy.code, 'DEBUGGER_IN_USE');
  target.closeDevTools(); const resumed = await manager.attach(owner, 'REPLAY');
  await event(resumed, e => e.kind === 'STATE'); assert.equal(target.listenerCount(), 5);
}));
test('native promises cancelled by navigation still consume bounded shared capacity until they actually settle', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE');
  const releases: ((value: unknown) => void)[] = [];
  try {
    for (const id of ['a', 'b']) {
      request(target, id); response(target, id, new Promise(resolve => { releases.push(resolve); })); await tick();
      target.navigate(); await event(handle, e => e.kind === 'STATE'); await tick();
    }
    request(target, 'c'); response(target, 'c');
    const stopped = await event(handle, e => e.kind === 'ERROR'); assert.equal(stopped.kind === 'ERROR' && stopped.code, 'COMMAND_CAPACITY');
    assert.equal(target.commands.filter(command => command.method === 'Network.getResponseBody').length, 2);
    assert.equal(handle.snapshot().rawCommandsInFlight, 2);
  } finally { for (const release of releases) release({ body: 'late', base64Encoded: false }); await tick(); }
}, { maxObservers: 1, maxConcurrentReads: 1 }));
test('partial listener bind failure cleans already-bound hooks and releases the debugger', async () => {
  const target = new ReplayObserverTarget(1); target.onNavigation = () => { throw new Error('synthetic bind failure'); };
  const manager = createResponseObserverManager({ resolveOwned: () => target, urlAllowed: () => true });
  try {
    const handle = await manager.attach(owner, 'FIXTURE'); const failure = await event(handle, e => e.kind === 'ERROR');
    assert.equal(failure.kind === 'ERROR' && failure.code, 'ATTACH_FAILED');
    assert.equal(target.listenerCount(), 0); assert.equal(target.debuggerAttached(), false);
  } finally { manager.stopAll(); }
});
test('filtered MIME and child target traffic differ from mismatched or malformed response errors', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE'); request(target, 'mime');
  target.emitMessage('Network.responseReceived', { requestId: 'mime', response: { url, status: 200, mimeType: 'image/png' } });
  target.emitMessage('Network.requestWillBeSent', { requestId: 'child', type: 'Fetch', request: { url, method: 'GET' } }, true);
  assert.equal((await handle.read(5)).kind, 'TIMEOUT'); assert.equal(handle.snapshot().filtered.MIME_FILTERED, 1); assert.equal(handle.snapshot().filtered.CHILD_TARGET, 1);
  request(target, 'mismatch'); target.emitMessage('Network.responseReceived', { requestId: 'mismatch', response: { url: url + '&different=1', status: 200, mimeType: 'text/plain' } });
  const mismatch = await event(handle, e => e.kind === 'ERROR'); assert.equal(mismatch.kind === 'ERROR' && mismatch.code, 'RESPONSE_MISMATCH');
  request(target, 'invalid'); target.emitMessage('Network.responseReceived', { requestId: 'invalid', response: { url, status: '200', mimeType: 'text/plain' } });
  const invalid = await event(handle, e => e.kind === 'ERROR'); assert.equal(invalid.kind === 'ERROR' && invalid.code, 'RESPONSE_INVALID');
}));
test('suspend cannot reset the run deadline; replay payload cannot promote capture mode to LIVE', async () => {
  await setup(async ({ target, handle }) => {
    await event(handle, e => e.kind === 'STATE'); handle.suspend(); await event(handle, e => e.kind === 'STATE');
    await sleep(30); const before = target.commands.length; await handle.resume();
    const expired = await event(handle, e => e.kind === 'ERROR'); assert.equal(expired.kind === 'ERROR' && expired.code, 'RUN_DEADLINE');
    assert.equal(target.commands.length, before);
  }, { maxRunMs: 20 });
  const data = JSON.parse(readFileSync('tests/fixtures/observer/replay.json', 'utf8')); assert.equal(data.captureMode, 'LIVE');
  const replay = await runObserverReplay(data); assert.equal(replay.result, 'CAPTURED');
  assert.ok(replay.captures.every(capture => capture.captureMode === 'REPLAY')); assert.equal(replay.verifiedValidUniquePosts, 0);
});
test('stop racing a cancelled resume cannot resurrect debugger attachment', () => setup(async ({ target, handle }) => {
  await event(handle, e => e.kind === 'STATE'); handle.suspend(); await event(handle, e => e.kind === 'STATE');
  let release!: (value: unknown) => void;
  target.enableResult = new Promise(resolve => { release = resolve; });
  const first = handle.resume(); await tick(); handle.suspend();
  const racing = handle.resume(); handle.stop();
  try {
    await first; await assert.rejects(racing, /OBSERVER_NOT_RESUMABLE/);
    assert.equal(handle.snapshot().state, 'STOPPED'); assert.equal(target.debuggerAttached(), false); assert.equal(target.listenerCount(), 0);
  } finally { release({}); await tick(); }
}));
test('queued body is invalidated if ownership changes before the consumer reads it', () => setup(async ({ target, handle, setOwner }) => {
  await event(handle, e => e.kind === 'STATE'); request(target, 'queued'); response(target, 'queued'); await tick();
  assert.equal(handle.snapshot().queuedResults, 1); setOwner({ ...owner, viewGeneration: 2 });
  const result = await event(handle, e => e.kind === 'ERROR'); assert.equal(result.kind === 'ERROR' && result.code, 'OWNER_CHANGED');
  assert.equal(handle.snapshot().bufferedBytes, 0); assert.equal((await handle.read(5)).kind, 'END');
}));
