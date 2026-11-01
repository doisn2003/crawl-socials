import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseThreadsReplyRoot } from '../dist/infrastructure/browser/threads-reply-root-parser.js';

const hosts = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
const hash = value => createHash('sha256').update(value).digest('hex');
const decode = text => { const clean = text.replace(/^for\s*\(;;\);/, ''); try { return [JSON.parse(clean)]; } catch { return clean.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } };
async function timed(work, ms, code) { let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); } finally { clearTimeout(timer); } }
const stateScript = `({url:location.href,password:!!document.querySelector('input[type="password"]'),alerts:[...document.querySelectorAll('[role="alert"],[role="dialog"]')].map(e=>e.innerText).join(' ').slice(0,4000)})`;

/** Resolve one observed reply permalink through the existing session. Never searches or creates an inferred root. */
export async function resolveThreadsReplyRoot({ window: wc, candidate, runId, onObservations = async () => {}, onPayload = null, shouldStop = () => false, maxMs = 20000, settleMs = 1500 }) {
  if (!/^\d+$/.test(candidate?.id) || typeof candidate?.url !== 'string' || !runId || !Number.isFinite(maxMs) || maxMs < 1000 || maxMs > 30000 || !Number.isFinite(settleMs) || settleMs < 0 || settleMs > 5000) throw Error('REPLY_ROOT_CONFIG_INVALID');
  const expected = new URL(candidate.url), shortcode = expected.pathname.match(/^\/@[^/]+\/post\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  if (expected.protocol !== 'https:' || !hosts.has(expected.hostname) || expected.username || expected.password || expected.port || !shortcode) throw Error('REPLY_ROOT_URL_INVALID');
  if (candidate.root_id !== undefined && !/^\d+$/.test(candidate.root_id)) throw Error('REPLY_ROOT_CONFIG_INVALID');
  const start = Date.now(), receipt = { status: 'UNRESOLVED', root: null, candidate_found: false, proof: null, stop_reason: 'ROOT_RELATIONSHIP_UNPROVEN', observed_count: 0, response_bodies: 0, elapsed_ms: 0 };
  if (shouldStop()) return { ...receipt, stop_reason: 'USER_STOP' };
  if (wc.isDestroyed() || wc.debugger.isAttached()) throw Error('REPLY_ROOT_WINDOW_BUSY');
  let closing = false, captureError = null, capturedBytes = 0, parsed = null, method = 'EMBEDDED_DOCUMENT_JSON';
  const objects = [], origins = [], digests = new Set(), pending = new Set(), requests = new Map();
  const remaining = () => Math.max(1, maxMs - (Date.now() - start));
  const add = (text, source) => {
    const digest = hash(text); if (digests.has(digest)) return;
    if (Buffer.byteLength(text) > 12 * 1024 * 1024 || capturedBytes + Buffer.byteLength(text) > 32 * 1024 * 1024 || digests.size >= 80) { captureError = 'CAPTURE_RESOURCE_LIMIT'; return; }
    const decoded = decode(text);
    const errors = JSON.stringify(decoded.flatMap(value => value?.errors || value?.error || []));
    if (/rate.?limit|challenge|checkpoint|login required|temporarily blocked/i.test(errors)) captureError = 'ACCOUNT_BARRIER';
    digests.add(digest); capturedBytes += Buffer.byteLength(text);
    for (const value of decoded) { origins.push({ index: objects.length, method: source, sha256: digest }); objects.push(value); }
    if (onPayload) onPayload(decoded, { method: source, sha256: digest });
    if (source === 'BROWSER_RESPONSE') method = source;
  };
  const onMessage = (_event, event, p, child) => {
    if (closing || child) return;
    if (event === 'Network.responseReceived') {
      try {
        const url = new URL(p.response.url);
        if (hosts.has(url.hostname) && /graphql|\/api\//.test(url.pathname) && /json|javascript|text\/plain|text\/html/.test(p.response.mimeType)) {
          if (requests.size >= 80) { captureError = 'CAPTURE_RESOURCE_LIMIT'; return; }
          requests.set(p.requestId, p.response.status);
        }
      } catch { /* Non-platform response. */ }
    }
    if (event === 'Network.loadingFailed' && requests.has(p.requestId)) { requests.delete(p.requestId); captureError ??= 'RESPONSE_LOAD_FAILED'; }
    if (event !== 'Network.loadingFinished' || !requests.has(p.requestId)) return;
    const status = requests.get(p.requestId); requests.delete(p.requestId);
    if ([401, 403, 429].includes(status)) { captureError = 'ACCOUNT_BARRIER'; return; }
    if (p.encodedDataLength > 12 * 1024 * 1024 || pending.size >= 16 || receipt.response_bodies >= 40) { captureError = 'CAPTURE_RESOURCE_LIMIT'; return; }
    receipt.response_bodies++;
    const task = timed(wc.debugger.sendCommand('Network.getResponseBody', { requestId: p.requestId }), Math.min(8000, remaining()), 'BODY_TIMEOUT').then(body => {
      if (closing) return;
      add(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body, 'BROWSER_RESPONSE');
    }).catch(() => { captureError ??= 'RESPONSE_READ_FAILED'; });
    pending.add(task); void task.finally(() => pending.delete(task));
  };
  const parse = () => parseThreadsReplyRoot(objects, { candidateId: candidate.id, url: candidate.url, observedAt: new Date().toISOString(), runId, method, ...(candidate.root_id ? { expectedRootId: candidate.root_id } : {}) });
  try {
    wc.debugger.attach('1.3'); wc.debugger.on('message', onMessage); await timed(wc.debugger.sendCommand('Network.enable'), Math.min(5000, remaining()), 'REPLY_ROOT_DEBUGGER_TIMEOUT');
    await timed(wc.loadURL(candidate.url), remaining(), 'REPLY_ROOT_NAVIGATION_TIMEOUT');
    for (let step = 0; step < 3; step++) {
      if (shouldStop()) { receipt.stop_reason = 'USER_STOP'; break; }
      if (remaining() <= 1) { receipt.stop_reason = 'TIME_BUDGET'; break; }
      await sleep(Math.min(settleMs, remaining()));
      const state = await timed(wc.executeJavaScript(stateScript), Math.min(8000, remaining()), 'REPLY_ROOT_RENDERER_TIMEOUT');
      const actual = new URL(state.url);
      if (state.password || /\/(login|checkpoint|challenge)/.test(actual.pathname) || /temporarily blocked|try again later|tạm thời bị chặn/i.test(state.alerts)) { captureError = 'ACCOUNT_BARRIER'; break; }
      if (!hosts.has(actual.hostname) || actual.protocol !== 'https:' || actual.pathname.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] !== shortcode) { receipt.stop_reason = 'NAVIGATION_CHANGED'; break; }
      const embedded = await timed(wc.executeJavaScript(`(()=>{let n=0;const a=[];for(const e of document.querySelectorAll('script[type="application/json"]')){const s=e.textContent||'';n+=s.length;if(n>24000000||a.length>=200)throw Error('EMBEDDED_LIMIT');a.push(s);}return a;})()`), Math.min(8000, remaining()), 'REPLY_ROOT_RENDERER_TIMEOUT');
      for (const text of embedded) add(text, 'EMBEDDED_DOCUMENT_JSON');
      await timed(Promise.allSettled([...pending]), Math.min(8000, remaining()), 'REPLY_ROOT_DRAIN_TIMEOUT');
      parsed = parse();
      if (parsed.status === 'RESOLVED' || captureError || parsed.reason === 'ROOT_IDENTITY_CONFLICT') break;
    }
  } catch (error) {
    captureError ??= error.message || 'REPLY_ROOT_CAPTURE_FAILED';
    if (captureError === 'REPLY_ROOT_NAVIGATION_TIMEOUT' && !wc.isDestroyed()) wc.stop();
  } finally {
    try { await timed(Promise.allSettled([...pending]), Math.min(8000, remaining()), 'REPLY_ROOT_DRAIN_TIMEOUT'); } catch { captureError ??= 'REPLY_ROOT_DRAIN_TIMEOUT'; }
    closing = true;
    if (!wc.isDestroyed()) { wc.debugger.removeListener('message', onMessage); if (wc.debugger.isAttached()) wc.debugger.detach(); }
  }
  parsed = parse();
  // Persist supported observations even on a partial capture; the relation parser never guesses membership.
  if (parsed.observations.length) await onObservations(parsed.observations.map(observation => ({ ...observation, provenance: {
    ...observation.provenance, method: 'REPLY_ROOT_CAPTURE', locator: JSON.stringify({ relation: observation.provenance.locator, inputs: origins }),
  } })));
  Object.assign(receipt, { status: parsed.status, root: parsed.root, candidate_found: parsed.candidate_found, proof: parsed.proof, observed_count: parsed.observations.length, elapsed_ms: Date.now() - start });
  if (captureError === 'ACCOUNT_BARRIER') { receipt.status = 'INACCESSIBLE'; receipt.stop_reason = captureError; }
  else if (receipt.stop_reason === 'NAVIGATION_CHANGED') receipt.status = 'RETRYABLE_ERROR';
  else if (parsed.status === 'RESOLVED') receipt.stop_reason = captureError ?? parsed.reason;
  else if (captureError) { receipt.status = 'RETRYABLE_ERROR'; receipt.stop_reason = captureError; }
  else if (!['USER_STOP', 'TIME_BUDGET', 'NAVIGATION_CHANGED'].includes(receipt.stop_reason)) receipt.stop_reason = parsed.reason;
  return receipt;
}
