import { createHash } from 'node:crypto';
import { setImmediate as settle } from 'node:timers/promises';
import { createResponseObserverManager } from './response-observer.js';
import { ReplayObserverTarget } from './replay-observer-target.js';
import type { ObserverOwner } from '../../application/ports/response-observer.js';

export async function runObserverReplay(value: unknown) {
  const data = value as { version?: unknown; bodies?: unknown; frames?: unknown } | null;
  if (!data || data.version !== 1 || !Array.isArray(data.bodies) || data.bodies.length < 1 || data.bodies.length > 256 ||
    !Array.isArray(data.frames) || data.frames.length > 512) throw new Error('REPLAY_FIXTURE_INVALID');
  const target = new ReplayObserverTarget(1), ids = new Set<string>();
  let totalInputBytes = 0;
  for (const raw of data.bodies) {
    if (!raw || typeof raw !== 'object') throw new Error('REPLAY_FIXTURE_INVALID');
    const body = raw as Record<string, unknown>;
    if (typeof body.requestId !== 'string' || body.requestId.length > 256 || ids.has(body.requestId) ||
      typeof body.body !== 'string' || body.body.length > 256 * 1024 || typeof body.base64Encoded !== 'boolean') throw new Error('REPLAY_FIXTURE_INVALID');
    totalInputBytes += Buffer.byteLength(body.body); if (totalInputBytes > 2 * 1024 * 1024) throw new Error('REPLAY_FIXTURE_TOO_LARGE');
    ids.add(body.requestId); target.setBody(body.requestId, { body: body.body, base64Encoded: body.base64Encoded });
  }
  const owner: ObserverOwner = { profileId: 'csd-11111111-1111-4111-8111-111111111111', webContentsId: 1, viewGeneration: 1 };
  const manager = createResponseObserverManager({ resolveOwned: candidate => JSON.stringify(candidate) === JSON.stringify(owner) ? target : null,
    urlAllowed: input => { const url = new URL(input); return url.origin === 'http://fixture.invalid' && url.pathname === '/capture'; },
    limits: { maxRunMs: 2000 } });
  try {
    const handle = await manager.attach(owner, 'REPLAY');
    for (const raw of data.frames) {
      if (!raw || typeof raw !== 'object') throw new Error('REPLAY_FIXTURE_INVALID');
      const frame = raw as Record<string, unknown>;
      if (typeof frame.method !== 'string' || !['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished',
        'Network.loadingFailed', 'Network.requestServedFromCache'].includes(frame.method)) throw new Error('REPLAY_FIXTURE_INVALID');
      target.emitMessage(frame.method, frame.params);
    }
    const captures: { bytes: number; sha256: string; status: number; captureMode: 'REPLAY' }[] = [], errors: string[] = [];
    while (captures.length < ids.size) {
      const read = await handle.read(250);
      if (read.kind !== 'EVENT') break;
      if (read.event.kind === 'ERROR') { errors.push(read.event.code); break; }
      if (read.event.kind === 'BODY') captures.push({ bytes: read.event.body.byteLength,
        sha256: createHash('sha256').update(read.event.body).digest('hex'), status: read.event.status, captureMode: 'REPLAY' });
    }
    handle.stop(); await settle();
    return { mode: 'REPLAY', result: errors.length ? 'ERROR' : captures.length === ids.size ? 'CAPTURED' : 'INCOMPLETE',
      captures, errors, stats: handle.snapshot(), verifiedValidUniquePosts: 0,
      limitations: ['Replay is synthetic transport evidence, not a live source or parser result', 'No URL, headers or body is exported'] };
  } finally { manager.stopAll(); }
}
