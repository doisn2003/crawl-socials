import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

// During source-only development the running app owns dist; exercise the test-compiled parser instead.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../dist/infrastructure/browser/threads-reply-root-parser.js' && context.parentURL?.endsWith('/scripts/threads-reply-root-collector.mjs')) return next(new URL('../.test-build/src/infrastructure/browser/threads-reply-root-parser.js', import.meta.url).href, context);
  return next(specifier, context);
} });
const { resolveThreadsReplyRoot } = await import('../scripts/threads-reply-root-collector.mjs');
hooks.deregister();
const candidate = { id: '102', url: 'https://www.threads.com/@reply/post/Reply' };
const root = { pk: '100', code: 'Root', user: { username: 'synthetic' }, caption: { text: '' }, text_post_app_info: { is_reply: false } };
const reply = { pk: '102', code: 'Reply', user: { username: 'reply' }, caption: { text: 'Where is this?' }, text_post_app_info: { is_reply: true, containing_thread: { posts: { edges: [{ node: root }] } } } };
function fakeWindow(payload, { login = false, location = candidate.url } = {}) {
  const debuggerApi = new EventEmitter(); let attached = false, loads = 0;
  Object.assign(debuggerApi, { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; }, sendCommand: async () => ({}) });
  return { debugger: debuggerApi, isDestroyed: () => false, stop() {}, async loadURL() { loads++; }, get loads() { return loads; }, async executeJavaScript(script) {
    if (script.includes('password:')) return { url: location, password: login, alerts: '' };
    if (script.includes('script[type=')) return [JSON.stringify(payload)];
    throw Error('UNEXPECTED_SCRIPT');
  } };
}
const options = window => ({ window, candidate, runId: 'synthetic-resolver', maxMs: 1000, settleMs: 0 });

test('Reply resolver persists verified root/comments and releases debugger without closing caller window', async () => {
  const window = fakeWindow({ data: { media: reply } }), rows = [];
  const receipt = await resolveThreadsReplyRoot({ ...options(window), onObservations: async observations => rows.push(...observations) });
  assert.equal(receipt.status, 'RESOLVED'); assert.equal(receipt.root.id, '100'); assert.equal(window.loads, 1);
  assert.deepEqual(rows.map(o => [o.entity_type, o.entity_id]), [['POST', '100'], ['COMMENT', '102']]); assert.equal(window.debugger.isAttached(), false);
});
test('Reply without root proof stays unresolved and durable instead of becoming an accepted post', async () => {
  const window = fakeWindow({ data: { media: { ...reply, text_post_app_info: { is_reply: true } } } }), rows = [];
  const receipt = await resolveThreadsReplyRoot({ ...options(window), onObservations: async observations => rows.push(...observations) });
  assert.equal(receipt.status, 'UNRESOLVED'); assert.equal(receipt.root, null); assert.equal(rows[0].entity_type, 'CANDIDATE'); assert.equal(rows[0].root_post_id, null);
});
test('Stop before capture does not acquire or navigate; account barrier is inaccessible', async () => {
  const stopped = fakeWindow({});
  assert.equal((await resolveThreadsReplyRoot({ ...options(stopped), shouldStop: () => true })).stop_reason, 'USER_STOP'); assert.equal(stopped.loads, 0);
  const blocked = fakeWindow({}, { login: true });
  assert.equal((await resolveThreadsReplyRoot(options(blocked))).status, 'INACCESSIBLE'); assert.equal(blocked.debugger.isAttached(), false);
});
test('Persistence errors propagate after cleanup; busy caller debugger is untouched', async () => {
  const window = fakeWindow({ data: { media: reply } });
  await assert.rejects(resolveThreadsReplyRoot({ ...options(window), onObservations: async () => { throw Error('DISK_FULL'); } }), /DISK_FULL/);
  assert.equal(window.debugger.isAttached(), false);
  window.debugger.attach(); await assert.rejects(resolveThreadsReplyRoot(options(window)), /WINDOW_BUSY/); assert.equal(window.debugger.isAttached(), true);
});
test('Native response payload resolves explicit ancestry across bodies without leaking unrelated media', async () => {
  const window = fakeWindow({}), rows = [];
  const candidatePayload = { data: { media: { ...reply, text_post_app_info: { is_reply: true, root_post_id: '100' } } } };
  const bodyById = new Map([['candidate', candidatePayload], ['root', { data: { media: root } }], ['other', { data: { media: { ...root, pk: '999', code: 'Other' } } }]]);
  window.debugger.sendCommand = async (method, value) => method === 'Network.getResponseBody' ? { body: JSON.stringify(bodyById.get(value.requestId)), base64Encoded: false } : {};
  window.loadURL = async () => {
    for (const requestId of bodyById.keys()) {
      window.debugger.emit('message', {}, 'Network.responseReceived', { requestId, response: { url: 'https://www.threads.com/graphql/query', status: 200, mimeType: 'application/json' } });
      window.debugger.emit('message', {}, 'Network.loadingFinished', { requestId, encodedDataLength: 200 });
    }
  };
  const receipt = await resolveThreadsReplyRoot({ ...options(window), onObservations: async observations => rows.push(...observations) });
  assert.equal(receipt.status, 'RESOLVED'); assert.equal(receipt.response_bodies, 3); assert.equal(receipt.root.id, '100');
  assert.deepEqual(rows.map(o => o.entity_id).sort(), ['100', '102']);
  assert.ok(rows.every(o => o.provenance.method === 'REPLY_ROOT_CAPTURE'));
  assert.match(rows[0].provenance.locator, /BROWSER_RESPONSE/);
});
test('Unexpected navigation and HTTP account barriers do not report a successful resolver job', async () => {
  const moved = fakeWindow({}, { location: 'https://www.threads.com/@reply/post/Other' });
  const changed = await resolveThreadsReplyRoot(options(moved));
  assert.equal(changed.status, 'RETRYABLE_ERROR'); assert.equal(changed.stop_reason, 'NAVIGATION_CHANGED');
  const blocked = fakeWindow({});
  blocked.loadURL = async () => {
    blocked.debugger.emit('message', {}, 'Network.responseReceived', { requestId: 'blocked', response: { url: 'https://www.threads.com/graphql/query', status: 429, mimeType: 'application/json' } });
    blocked.debugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'blocked', encodedDataLength: 20 });
  };
  const receipt = await resolveThreadsReplyRoot(options(blocked));
  assert.equal(receipt.status, 'INACCESSIBLE'); assert.equal(receipt.stop_reason, 'ACCOUNT_BARRIER'); assert.equal(blocked.debugger.isAttached(), false);
});
